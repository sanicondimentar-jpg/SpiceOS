import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WebOrderInput, WebOrderTracking, WebOrderTrackingInput } from '@spiceos/contracts';
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

/** Cómo ve el cliente cada estado: en su idioma y sin los pasos internos. */
const TRACKING_STEP: Record<string, { step: WebOrderTracking['step']; label: string; detail: string }> = {
  PENDING_REVIEW: { step: 'received', label: 'Recibido', detail: 'Recibimos tu pedido y lo estamos revisando.' },
  DRAFT: { step: 'received', label: 'Recibido', detail: 'Recibimos tu pedido y lo estamos revisando.' },
  CONFIRMED: { step: 'confirmed', label: 'Confirmado', detail: 'Tu pedido está confirmado. Pronto empezamos a prepararlo.' },
  PICKING: { step: 'preparing', label: 'En preparación', detail: 'Estamos armando tu pedido.' },
  READY: { step: 'ready', label: 'Listo', detail: 'Tu pedido está listo para la entrega.' },
  DISPATCHED: { step: 'shipped', label: 'En camino', detail: 'Tu pedido salió para la entrega.' },
  DELIVERED: { step: 'delivered', label: 'Entregado', detail: 'Tu pedido fue entregado. ¡Gracias por tu compra!' },
  INVOICED: { step: 'delivered', label: 'Entregado', detail: 'Tu pedido fue entregado. ¡Gracias por tu compra!' },
  CANCELLED: { step: 'cancelled', label: 'Cancelado', detail: 'El pedido fue cancelado. Si tenés dudas, escribinos por WhatsApp.' },
};

/** Últimos 8 dígitos: alcanza para comparar teléfonos escritos con o sin 0, 15, +54 o 9. */
const phoneKey = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').slice(-8);

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
    const ctx = await this.context(orgAlias);
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BusinessRuleError('Indicá un teléfono válido');

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

  /**
   * Seguimiento público: el cliente consulta con el número de pedido y su teléfono.
   * Si el teléfono no coincide responde lo mismo que si el pedido no existiera.
   */
  async track(orgAlias: string, input: WebOrderTrackingInput): Promise<WebOrderTracking> {
    const ctx = await this.context(orgAlias);
    const numbers = [...new Set([input.number.trim().toUpperCase(), normalizeOrderNumber(input.number)])];
    return RequestContextStore.run(ctx, () =>
      this.uow.run(async (tx) => {
        const o = await tx.salesOrder.findFirst({
          where: { number: { in: numbers } },
          select: {
            number: true,
            status: true,
            createdAt: true,
            total: true,
            contactPhone: true,
            customer: { select: { phone: true } },
            lines: {
              orderBy: { variant: { sku: 'asc' } },
              select: { quantity: true, variant: { select: { sku: true, name: true, product: { select: { name: true } } } } },
            },
            statusHistory: { orderBy: { changedAt: 'asc' }, select: { to: true, changedAt: true } },
          },
        });
        const key = phoneKey(input.phone);
        const owns = o && key.length === 8 && [o.contactPhone, o.customer.phone].some((p) => phoneKey(p) === key);
        if (!o || !owns) throw new NotFoundError('Pedido', input.number);

        const current = TRACKING_STEP[o.status];
        // Fecha en que llegó a cada paso que ve el cliente (la primera vez).
        const reached = new Map<string, Date>();
        for (const h of o.statusHistory) {
          const step = TRACKING_STEP[h.to].step;
          if (!reached.has(step)) reached.set(step, h.changedAt);
        }
        return {
          number: o.number,
          step: current.step,
          label: current.label,
          detail: current.detail,
          createdAt: o.createdAt.toISOString(),
          history: [...reached].map(([step, at]) => ({ step: step as WebOrderTracking['step'], at: at.toISOString() })),
          total: Number(o.total),
          lines: o.lines.map((l) => ({
            sku: l.variant.sku,
            description: `${l.variant.product.name} ${l.variant.name}`.trim(),
            quantity: Number(l.quantity),
          })),
        };
      }),
    );
  }

  private async context(orgAlias: string): Promise<RequestContext> {
    const company = await this.system.company.findUnique({ where: { keycloakOrgId: orgAlias }, select: { id: true, status: true } });
    if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Empresa', orgAlias);
    return {
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
  }
}

/** Acepta "PED-00000012", "ped 12" o "12" y lo deja como se guarda: PED-00000012. */
export function normalizeOrderNumber(raw: string) {
  const digits = raw.replace(/\D/g, '');
  return digits ? `PED-${digits.slice(-8).padStart(8, '0')}` : raw.trim().toUpperCase();
}
