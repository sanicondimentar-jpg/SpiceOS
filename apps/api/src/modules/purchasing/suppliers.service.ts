import { Injectable } from '@nestjs/common';
import type { CreateSupplierInput, SupplierProductsInput, UpdateSupplierInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';

/** Proveedores y qué presentaciones compra la empresa a cada uno (una presentación puede tener varios). */
@Injectable()
export class SuppliersService {
  constructor(private readonly uow: UnitOfWork) {}

  list() {
    return this.uow.read(async (tx) => {
      const rows = await tx.supplier.findMany({ orderBy: { legalName: 'asc' }, include: { _count: { select: { products: true } } } });
      return rows.map((s) => ({
        id: s.id,
        code: s.code,
        legalName: s.legalName,
        taxId: s.taxId,
        phone: s.phone,
        email: s.email,
        leadTimeDays: s.leadTimeDays,
        isActive: s.isActive,
        products: s._count.products,
      }));
    });
  }

  create(input: CreateSupplierInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      if (await tx.supplier.findFirst({ where: { code: input.code }, select: { id: true } })) throw new ConflictError(`Ya existe un proveedor con código ${input.code}`);
      const s = await tx.supplier.create({ data: { ...input, tenantId: ctx.tenantId, country: 'AR' } });
      scope.auditLog({ action: 'supplier.create', entityType: 'supplier', entityId: s.id, after: input });
      return { id: s.id };
    });
  }

  update(id: string, input: UpdateSupplierInput) {
    return this.uow.run(async (tx, scope) => {
      const s = await tx.supplier.findFirst({ where: { id } });
      if (!s) throw new NotFoundError('Proveedor', id);
      await tx.supplier.update({ where: { id }, data: input });
      scope.auditLog({ action: 'supplier.update', entityType: 'supplier', entityId: id, before: s, after: input });
      return { id };
    });
  }

  /** Asigna o quita presentaciones por SKU. Si es el preferido, deja de serlo el anterior. */
  setProducts(id: string, input: SupplierProductsInput) {
    return this.uow.run(async (tx, scope) => {
      if (!(await tx.supplier.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundError('Proveedor', id);
      const variants = await tx.productVariant.findMany({ where: { sku: { in: input.skus } }, select: { id: true, sku: true, currentCost: true } });
      const unknown = input.skus.filter((sku) => !variants.some((v) => v.sku === sku));
      if (unknown.length) throw new BusinessRuleError(`No existen los SKU: ${unknown.slice(0, 10).join(', ')}`);
      for (const v of variants) {
        if (input.remove) {
          await tx.supplierProduct.deleteMany({ where: { supplierId: id, variantId: v.id } });
          continue;
        }
        if (input.preferred) await tx.supplierProduct.updateMany({ where: { variantId: v.id, supplierId: { not: id } }, data: { isPreferred: false } });
        await tx.supplierProduct.upsert({
          where: { supplierId_variantId: { supplierId: id, variantId: v.id } },
          create: { supplierId: id, variantId: v.id, supplierSku: v.sku, lastCost: Number(v.currentCost) || null, isPreferred: input.preferred },
          update: { isPreferred: input.preferred },
        });
      }
      scope.auditLog({ action: input.remove ? 'supplier.products_removed' : 'supplier.products_assigned', entityType: 'supplier', entityId: id, after: { skus: input.skus, preferred: input.preferred } });
      return { count: variants.length };
    });
  }
}
