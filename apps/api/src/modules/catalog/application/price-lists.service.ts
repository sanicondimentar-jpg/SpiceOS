import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type PriceItemsInput, type PriceListInput, type RepriceInput } from '@spiceos/contracts';
import { DomainEvent } from '../../../shared/domain/domain-event';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import type { Tx } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { UnitOfWork, UowScope } from '../../../shared/unit-of-work';
import { marginPct, minPriceForMargin, priceFromCost } from '../domain/pricing';

@Injectable()
export class PriceListsService {
  constructor(private readonly uow: UnitOfWork) {}

  list() {
    return this.uow.read((tx) =>
      tx.priceList.findMany({
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { items: true, customers: true } } },
      }),
    );
  }

  /** Precios de la lista con costo, margen y alerta de margen bajo por presentación. */
  items(priceListId: string) {
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    return this.uow.read(async (tx) => {
      const list = await this.findList(tx, priceListId);
      const items = await tx.priceListItem.findMany({
        where: { priceListId },
        orderBy: [{ variant: { sku: 'asc' } }, { minQuantity: 'asc' }],
        include: { variant: { select: { sku: true, name: true, currentCost: true, minMarginPct: true, product: { select: { name: true } } } } },
      });
      return {
        ...list,
        items: items.map((i) => {
          const price = Number(i.price);
          const cost = Number(i.variant.currentCost);
          const margin = marginPct(price, cost);
          return {
            variantId: i.variantId,
            sku: i.variant.sku,
            name: `${i.variant.product.name} ${i.variant.name}`,
            minQuantity: Number(i.minQuantity),
            price,
            updatedAt: i.updatedAt,
            ...(canSeeCost && {
              cost,
              marginPct: margin,
              belowMinMargin: margin !== null && margin < Number(i.variant.minMarginPct),
            }),
          };
        }),
      };
    });
  }

  create(input: PriceListInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      if (await tx.priceList.findFirst({ where: { name: input.name }, select: { id: true } })) {
        throw new ConflictError(`Ya existe la lista ${input.name}`);
      }
      if (input.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const list = await tx.priceList.create({
        data: {
          ...input,
          tenantId: ctx.tenantId,
          validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
          validTo: input.validTo ? new Date(input.validTo) : undefined,
        },
      });
      scope.auditLog({ action: 'price_list.create', entityType: 'price_list', entityId: list.id, after: input });
      return list;
    });
  }

  /** Alta o cambio de precios. Los precios por debajo del margen mínimo se aceptan pero se informan. */
  upsertItems(priceListId: string, input: PriceItemsInput, reason: 'manual' | 'import' = 'manual') {
    return this.uow.run((tx, scope) => this.writeItems(tx, scope, priceListId, input.items, reason));
  }

  async writeItems(
    tx: Tx,
    scope: UowScope,
    priceListId: string,
    items: PriceItemsInput['items'],
    reason: 'manual' | 'import' | 'reprice',
  ) {
    await this.findList(tx, priceListId);
    const ids = [...new Set(items.map((i) => i.variantId))];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids } },
      select: { id: true, sku: true, currentCost: true, minMarginPct: true },
    });
    if (variants.length !== ids.length) throw new BusinessRuleError('Hay presentaciones inexistentes en la lista');
    const byId = new Map(variants.map((v) => [v.id, v]));

    const before = await tx.priceListItem.findMany({ where: { priceListId, variantId: { in: ids } } });
    for (const item of items) {
      await tx.priceListItem.upsert({
        where: { priceListId_variantId_minQuantity: { priceListId, variantId: item.variantId, minQuantity: item.minQuantity } },
        create: { priceListId, variantId: item.variantId, minQuantity: item.minQuantity, price: item.price },
        update: { price: item.price },
      });
    }
    const warnings = items
      .filter((i) => {
        const v = byId.get(i.variantId)!;
        return i.price < minPriceForMargin(Number(v.currentCost), Number(v.minMarginPct));
      })
      .map((i) => `${byId.get(i.variantId)!.sku}${i.minQuantity > 1 ? ` (desde ${i.minQuantity})` : ''}: el precio queda debajo del margen mínimo`);

    scope.emit(new DomainEvent('price_list.updated', 'price_list', priceListId, { priceListId, variantIds: ids, reason }));
    scope.auditLog({
      action: 'price_list.items',
      entityType: 'price_list',
      entityId: priceListId,
      before: before.map((b) => ({ variantId: b.variantId, minQuantity: Number(b.minQuantity), price: Number(b.price) })),
      after: items,
    });
    return { updated: items.length, warnings };
  }

  /** Recalcula precios unitarios (cantidad mínima 1) como costo × factor. dryRun devuelve la vista previa sin guardar. */
  reprice(priceListId: string, input: RepriceInput) {
    const run = async (tx: Tx, scope?: UowScope) => {
      await this.findList(tx, priceListId);
      const variants = await tx.productVariant.findMany({
        where: { isActive: true, currentCost: { gt: 0 }, ...(input.variantIds?.length && { id: { in: input.variantIds } }) },
        select: {
          id: true, sku: true, name: true, currentCost: true, minMarginPct: true, product: { select: { name: true } },
          priceListItems: { where: { priceListId, minQuantity: 1 }, select: { price: true } },
        },
        orderBy: { sku: 'asc' },
      });
      const changes = variants
        .map((v) => {
          const cost = Number(v.currentCost);
          const current = v.priceListItems[0] ? Number(v.priceListItems[0].price) : null;
          const next = priceFromCost(cost, input.factor, input.roundTo);
          return {
            variantId: v.id,
            sku: v.sku,
            name: `${v.product.name} ${v.name}`,
            cost,
            currentPrice: current,
            newPrice: next,
            changePct: current ? Math.round(((next - current) / current) * 10000) / 100 : null,
            marginPct: marginPct(next, cost),
            belowMinMargin: (marginPct(next, cost) ?? 0) < Number(v.minMarginPct),
          };
        })
        .filter((c) => c.currentPrice !== c.newPrice);

      if (!input.dryRun && changes.length && scope) {
        await this.writeItems(tx, scope, priceListId, changes.map((c) => ({ variantId: c.variantId, price: c.newPrice, minQuantity: 1 })), 'reprice');
      }
      return { dryRun: input.dryRun, factor: input.factor, roundTo: input.roundTo, changes };
    };
    return input.dryRun ? this.uow.read((tx) => run(tx)) : this.uow.run((tx, scope) => run(tx, scope));
  }

  private async findList(tx: Tx, id: string) {
    const list = await tx.priceList.findFirst({ where: { id } });
    if (!list) throw new NotFoundError('Lista de precios', id);
    return list;
  }
}
