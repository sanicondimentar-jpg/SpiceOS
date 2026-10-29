import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WebOrderInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { RequestContextStore, type RequestContext } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { CatalogFacade } from '../catalog/catalog.facade';
import { CrmFacade } from '../crm/crm.facade';
import { normalizePhone } from '../crm/domain/customer';
import { priceLines } from '../sales/quote-pricing';
import { orderTax } from './order-tax';

class OrderEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/** Lista de precios de cada modo de la web. */
const LIST_BY_MODE = { mayorista: 'Mayorista', minorista: 'Minorista' } as const;

/**
 * Pedidos que llegan de la web pública (saboracasa.com.ar). Se guardan pendientes de revisión,
 * sin reservar stock: alguien de la empresa los aprueba, los corrige o los descarta.
 * El cliente se busca por teléfono; si no existe se crea como prospecto.
 */
@Injectable()
export class WebOrdersService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly uow: UnitOfWork,
    private readonly crm: CrmFacade,
    private readonly catalog: CatalogFacade,
  ) {}

  async receive(orgAlias: string, input: WebOrderInput) {
    if (input.website) throw new BusinessRuleError('No se pudo registrar el pedido');
    const company = await this.system.company.findUnique({ where: { keycloakOrgId: orgAlias }, select: { id: true, status: true } });
    if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Empresa', orgAlias);
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BusinessRuleError('Indicá un teléfono válido');

    const ctx: RequestContext = {
      tenantId: company.id,
      userId: '00000000-0000-0000-0000-000000000000',
      actor: 'integration:web',
      actorType: 'INTEGRATION',
      roleKey: 'system',
      permissions: new Set(),
      branchScope: [],
      maxDiscount: 0,
      correlationId: randomUUID(),
    };
    return RequestContextStore.run(ctx, () =>
      this.uow.run(async (tx, scope) => {
        const branch =
          (await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } })) ??
          (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }));
        const warehouse = branch && (await tx.warehouse.findFirst({ where: { branchId: branch.id, isActive: true }, orderBy: { code: 'asc' }, select: { id: true } }));
        if (!branch || !warehouse) throw new BusinessRuleError('La empresa no tiene depósito configurado');

        const priceList = await tx.priceList.findFirst({ where: { name: { equals: LIST_BY_MODE[input.mode], mode: 'insensitive' } }, select: { id: true } });

        // Mismo SKU repetido en el carrito: se suma.
        const qtyBySku = new Map<string, number>();
        for (const l of input.lines) qtyBySku.set(l.sku, (qtyBySku.get(l.sku) ?? 0) + l.quantity);
        const variants = await tx.productVariant.findMany({ where: { sku: { in: [...qtyBySku.keys()] }, isActive: true }, select: { id: true, sku: true } });
        const unknown = [...qtyBySku.keys()].filter((sku) => !variants.some((v) => v.sku === sku));
        if (!variants.length) throw new BusinessRuleError('Ningún producto del pedido figura en el catálogo');

        const items = variants.map((v) => ({ variantId: v.id, quantity: qtyBySku.get(v.sku)!, discountPct: 0 }));
        const priced = await this.catalog.price(tx, items, priceList?.id ?? null);
        const noPrice = items.filter((i) => priced.get(i.variantId)!.listPrice == null);
        // Los que no tienen precio entran a $0 para que quien revisa los complete.
        const pricing = priceLines(
          items.map((i) => (noPrice.includes(i) ? { ...i, unitPrice: 0 } : i)),
          priced,
          100,
        );

        let customerId = await this.crm.findIdByPhone(tx, phone);
        const createdCustomer = !customerId;
        if (!customerId) customerId = (await this.crm.createWebProspect(tx, scope, { name: input.name, phone, priceListId: priceList?.id ?? null })).id;

        const notes = [
          input.notes,
          `Pedido web (${input.mode}) de ${input.name}, tel. ${input.phone}.`,
          unknown.length ? `Códigos que no están en el catálogo: ${unknown.map((s) => `${s} × ${qtyBySku.get(s)}`).join(', ')}.` : null,
          noPrice.length ? `Sin precio en la lista: ${noPrice.map((i) => priced.get(i.variantId)!.sku).join(', ')}.` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const id = randomUUID();
        const number = await nextNumber(tx, branch.id, 'order', 'PED-');
        await tx.salesOrder.create({
          data: {
            id,
            tenantId: ctx.tenantId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            number,
            customerId,
            status: 'PENDING_REVIEW',
            channel: 'web',
            subtotal: pricing.subtotal,
            discountTotal: pricing.discountTotal,
            total: pricing.total,
            withInvoice: true,
            taxTotal: orderTax(pricing.total, true).taxTotal,
            marginTotal: pricing.marginTotal,
            notes,
            contactName: input.name,
            contactPhone: phone,
            webTotal: input.total,
            createdCustomer,
            lines: {
              create: pricing.lines.map((l) => ({
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discountPct: l.discountPct,
                unitCost: l.unitCost,
                lineTotal: l.lineTotal,
              })),
            },
            statusHistory: { create: { to: 'PENDING_REVIEW', changedBy: ctx.actor, reason: 'Recibido desde la web' } },
          },
        });
        const events = new OrderEvents();
        events.emit(new DomainEvent('order.created', 'order', id, { orderId: id, number, customerId, total: pricing.total, channel: 'web' }));
        scope.track(events);
        scope.auditLog({ action: 'order.create', entityType: 'order', entityId: id, after: { number, total: pricing.total, channel: 'web' } });
        return { number, status: 'PENDING_REVIEW' as const, total: pricing.total };
      }),
    );
  }
}
