import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  type CategoryInput,
  type CreateProductInput,
  type ProductListQuery,
  type UpdateCostInput,
  type UpdateProductInput,
  type UpdateVariantInput,
  type VariantInput,
} from '@spiceos/contracts';
import { DomainEvent } from '../../../shared/domain/domain-event';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import type { Tx } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { UnitOfWork, UowScope } from '../../../shared/unit-of-work';
import { changePct, marginPct, slugify } from '../domain/pricing';

const variantSelect = {
  id: true, sku: true, gtin: true, name: true, unit: true, netWeightKg: true, currentCost: true,
  minMarginPct: true, minStock: true, reorderPoint: true, isActive: true,
} satisfies Prisma.ProductVariantSelect;
type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>;

/** Productos y presentaciones. El costo solo se muestra a quien tiene catalog.cost.read. */
@Injectable()
export class ProductsService {
  constructor(private readonly uow: UnitOfWork) {}

  list(query: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(!query.includeInactive && { isActive: true }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { code: { contains: query.q, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
        ],
      }),
    };
    return this.uow.read(async (tx) => {
      const defaultList = await tx.priceList.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });
      const [items, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            category: { select: { id: true, name: true } },
            variants: {
              where: query.includeInactive ? {} : { isActive: true },
              orderBy: { netWeightKg: 'asc' },
              select: {
                ...variantSelect,
                priceListItems: defaultList
                  ? { where: { priceListId: defaultList.id, minQuantity: 1 }, select: { price: true } }
                  : false,
              },
            },
          },
        }),
        tx.product.count({ where }),
      ]);
      return {
        items: items.map((p) => ({
          ...p,
          variants: p.variants.map((v) => this.presentVariant(v, (v as { priceListItems?: { price: unknown }[] }).priceListItems?.[0]?.price)),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        priceList: defaultList,
      };
    });
  }

  get(id: string) {
    return this.uow.read(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, deletedAt: null },
        include: {
          category: { select: { id: true, name: true } },
          certifications: { include: { certification: true }, orderBy: { validUntil: 'asc' } },
          variants: {
            orderBy: { netWeightKg: 'asc' },
            select: {
              ...variantSelect,
              priceListItems: {
                orderBy: [{ priceListId: 'asc' }, { minQuantity: 'asc' }],
                select: { price: true, minQuantity: true, priceList: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
      if (!product) throw new NotFoundError('Producto', id);
      const canSeeCost = this.canSeeCost();
      return {
        ...product,
        variants: product.variants.map((v) => ({
          ...this.presentVariant(v),
          prices: v.priceListItems.map((i) => ({
            priceListId: i.priceList.id,
            priceList: i.priceList.name,
            minQuantity: Number(i.minQuantity),
            price: Number(i.price),
            marginPct: canSeeCost ? marginPct(Number(i.price), Number(v.currentCost)) : undefined,
          })),
        })),
      };
    });
  }

  create(input: CreateProductInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      if (await tx.product.findFirst({ where: { code: input.code }, select: { id: true } })) {
        throw new ConflictError(`Ya existe un producto con código ${input.code}`);
      }
      await this.assertSkusFree(tx, input.variants.map((v) => v.sku));
      const { variants, ...data } = input;
      const product = await tx.product.create({ data: { ...data, tenantId: ctx.tenantId } });
      for (const v of variants) await this.insertVariant(tx, scope, product.id, v, 'manual');
      scope.emit(new DomainEvent('product.created', 'product', product.id, { productId: product.id, code: product.code, name: product.name }));
      scope.auditLog({ action: 'product.create', entityType: 'product', entityId: product.id, after: input });
      return { id: product.id, code: product.code };
    });
  }

  update(id: string, input: UpdateProductInput) {
    return this.uow.run(async (tx, scope) => {
      const before = await tx.product.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError('Producto', id);
      const after = await tx.product.update({ where: { id }, data: input });
      scope.emit(new DomainEvent('product.updated', 'product', id, { productId: id, changes: Object.keys(input) }));
      scope.auditLog({ action: 'product.update', entityType: 'product', entityId: id, before, after });
      return { id };
    });
  }

  addVariant(productId: string, input: VariantInput) {
    return this.uow.run(async (tx, scope) => {
      const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
      if (!product) throw new NotFoundError('Producto', productId);
      await this.assertSkusFree(tx, [input.sku]);
      const variant = await this.insertVariant(tx, scope, productId, input, 'manual');
      scope.emit(new DomainEvent('product.updated', 'product', productId, { productId, variantAdded: variant.id }));
      scope.auditLog({ action: 'variant.create', entityType: 'product_variant', entityId: variant.id, after: input });
      return { id: variant.id, sku: variant.sku };
    });
  }

  updateVariant(variantId: string, input: UpdateVariantInput) {
    return this.uow.run(async (tx, scope) => {
      const before = await tx.productVariant.findFirst({ where: { id: variantId } });
      if (!before) throw new NotFoundError('Presentación', variantId);
      const after = await tx.productVariant.update({ where: { id: variantId }, data: input });
      scope.emit(new DomainEvent('product.updated', 'product', before.productId, { productId: before.productId, variantId, changes: Object.keys(input) }));
      scope.auditLog({ action: 'variant.update', entityType: 'product_variant', entityId: variantId, before, after });
      return { id: variantId };
    });
  }

  /** Cambia el costo vigente, guarda historial y avisa (pricing/automatizaciones recalculan márgenes). */
  updateCost(variantId: string, input: UpdateCostInput) {
    return this.uow.run((tx, scope) => this.applyCost(tx, scope, variantId, input.cost, input.source));
  }

  /** Reutilizado por la importación de productos dentro de su propia transacción. */
  async applyCost(tx: Tx, scope: UowScope, variantId: string, cost: number, source: string) {
    const ctx = RequestContextStore.get();
    const variant = await tx.productVariant.findFirst({ where: { id: variantId }, select: { id: true, sku: true, productId: true, currentCost: true } });
    if (!variant) throw new NotFoundError('Presentación', variantId);
    const previous = Number(variant.currentCost);
    if (previous === cost) return { variantId, cost, changed: false };
    await tx.productVariant.update({ where: { id: variantId }, data: { currentCost: cost } });
    await tx.costHistory.create({ data: { tenantId: ctx.tenantId, variantId, cost, source, createdBy: ctx.userId } });
    scope.emit(
      new DomainEvent('product.cost_changed', 'product', variant.productId, {
        productId: variant.productId, variantId, sku: variant.sku, previousCost: previous, cost,
        changePct: changePct(previous, cost), source,
      }),
    );
    scope.auditLog({ action: 'variant.cost', entityType: 'product_variant', entityId: variantId, before: { cost: previous }, after: { cost, source } });
    return { variantId, cost, changed: true };
  }

  costHistory(variantId: string) {
    return this.uow.read((tx) =>
      tx.costHistory.findMany({ where: { variantId }, orderBy: { validFrom: 'desc' }, take: 100 }),
    );
  }

  listCategories() {
    return this.uow.read((tx) =>
      tx.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }),
    );
  }

  createCategory(input: CategoryInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const slug = slugify(input.name);
      if (await tx.category.findFirst({ where: { slug }, select: { id: true } })) {
        throw new ConflictError(`Ya existe la categoría ${input.name}`);
      }
      const category = await tx.category.create({ data: { ...input, slug, tenantId: ctx.tenantId } });
      scope.auditLog({ action: 'category.create', entityType: 'category', entityId: category.id, after: input });
      return category;
    });
  }

  async insertVariant(tx: Tx, scope: UowScope, productId: string, v: VariantInput, source: string) {
    const ctx = RequestContextStore.get();
    const { cost, ...data } = v;
    const variant = await tx.productVariant.create({ data: { ...data, productId, tenantId: ctx.tenantId, currentCost: cost } });
    if (cost > 0) await tx.costHistory.create({ data: { tenantId: ctx.tenantId, variantId: variant.id, cost, source, createdBy: ctx.userId } });
    return variant;
  }

  private async assertSkusFree(tx: Tx, skus: string[]) {
    if (new Set(skus).size !== skus.length) throw new BusinessRuleError('Hay SKU repetidos en el producto');
    const taken = await tx.productVariant.findMany({ where: { sku: { in: skus } }, select: { sku: true } });
    if (taken.length) throw new ConflictError(`SKU ya usado: ${taken.map((t) => t.sku).join(', ')}`);
  }

  private canSeeCost() {
    return RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
  }

  private presentVariant(v: VariantRow, listPrice?: unknown) {
    const canSeeCost = this.canSeeCost();
    const cost = Number(v.currentCost);
    const price = listPrice == null ? null : Number(listPrice);
    return {
      id: v.id,
      sku: v.sku,
      gtin: v.gtin,
      name: v.name,
      unit: v.unit,
      isActive: v.isActive,
      netWeightKg: v.netWeightKg == null ? null : Number(v.netWeightKg),
      minStock: Number(v.minStock),
      reorderPoint: Number(v.reorderPoint),
      minMarginPct: Number(v.minMarginPct),
      currentCost: canSeeCost ? cost : undefined,
      ...(listPrice !== undefined && { listPrice: price, marginPct: canSeeCost ? marginPct(price, cost) : undefined }),
    };
  }
}
