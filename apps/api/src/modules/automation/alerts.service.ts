import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@spiceos/contracts';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { InsightsService } from '../analytics/insights.service';
import { CollectionsService } from '../receivables/collections.service';
import { ALERT_KINDS, resolveSettings, sortAlerts, type Alert, type AlertKind, type AlertSettings } from './alerts';

const KEY = 'automation.alerts';
const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const qty = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
const day = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
const fullDay = (d: Date) => `${day(d)}/${d.getUTCFullYear()}`;

/**
 * Avisos del día: el sistema revisa deuda vencida, stock bajo, lotes por vencer, pedidos web sin revisar,
 * presupuestos por vencer y clientes que dejaron de comprar. Se calculan al momento (cuando se resuelve
 * algo, el aviso desaparece solo). Cada uno se puede apagar o ajustar en Automatizaciones.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly insights: InsightsService,
    private readonly collections: CollectionsService,
  ) {}

  getSettings(): Promise<AlertSettings> {
    return this.uow.read(async (tx) => resolveSettings((await tx.setting.findFirst({ where: { key: KEY } }))?.value));
  }

  saveSettings(input: AlertSettings) {
    const ctx = RequestContextStore.get();
    const value = resolveSettings(input);
    return this.uow.run(async (tx, scope) => {
      await tx.setting.upsert({
        where: { tenantId_key: { tenantId: ctx.tenantId, key: KEY } },
        create: { tenantId: ctx.tenantId, key: KEY, value: value as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId },
        update: { value: value as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId },
      });
      scope.auditLog({ action: 'automation.alerts.update', entityType: 'setting', entityId: ctx.tenantId, after: value });
      return value;
    });
  }

  async alerts() {
    const settings = await this.getSettings();
    const perms = RequestContextStore.get().permissions;
    // Cada aviso se muestra solo a quien puede ver esa parte del sistema.
    const allowed: Record<AlertKind, boolean> = {
      overdueDebt: perms.has(PERMISSIONS.receivables.read),
      lowStock: perms.has(PERMISSIONS.inventory.read),
      expiring: perms.has(PERMISSIONS.inventory.read),
      webOrders: perms.has(PERMISSIONS.orders.read),
      staleQuotes: perms.has(PERMISSIONS.sales.quoteRead),
      lapsedCustomers: perms.has(PERMISSIONS.crm.customerRead) && perms.has(PERMISSIONS.analytics.executive),
      expiringDocs: perms.has(PERMISSIONS.documents.read),
    };
    const on = (k: AlertKind) => settings[k].enabled && allowed[k];
    const out: Alert[] = [];

    if (on('overdueDebt')) {
      const summary = await this.collections.summary();
      for (const c of summary.customers.filter((x) => x.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 15)) {
        out.push({
          kind: 'overdueDebt',
          severity: c.maxDaysOverdue > 15 ? 'high' : 'medium',
          title: `${c.name} debe ${money(c.overdue)} vencido`,
          detail: `Hace ${c.maxDaysOverdue} días${c.phone ? ` · ${c.phone}` : ''}`,
          link: `/customers/${c.customerId}`,
        });
      }
    }

    await this.uow.read(async (tx) => {
      if (on('lowStock')) {
        const rows = await tx.$queryRaw<{ product_id: string; sku: string; name: string; available: number; min: number }[]>`
          SELECT p.id AS product_id, v.sku, (p.name || ' ' || v.name) AS name,
                 coalesce(sum(s.on_hand - s.reserved), 0)::float AS available,
                 greatest(v.reorder_point, v.min_stock)::float AS min
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN stock_items s ON s.variant_id = v.id
          WHERE v.is_active AND p.is_active AND p.deleted_at IS NULL AND greatest(v.reorder_point, v.min_stock) > 0
          GROUP BY p.id, v.id
          HAVING coalesce(sum(s.on_hand - s.reserved), 0) <= greatest(v.reorder_point, v.min_stock)
          ORDER BY coalesce(sum(s.on_hand - s.reserved), 0) / greatest(v.reorder_point, v.min_stock), v.sku
          LIMIT 30`;
        for (const r of rows) {
          out.push({
            kind: 'lowStock',
            severity: r.available <= 0 ? 'high' : 'medium',
            title: r.available <= 0 ? `Sin stock: ${r.name}` : `Stock bajo: ${r.name}`,
            detail: `Quedan ${qty(r.available)} disponibles (mínimo ${qty(r.min)}) · ${r.sku}`,
            link: `/products/${r.product_id}`,
          });
        }
      }

      if (on('expiring')) {
        const days = settings.expiring.value!;
        const rows = await tx.$queryRaw<{ name: string; sku: string; code: string; expires_at: Date; on_hand: number; days_left: number }[]>`
          SELECT (p.name || ' ' || v.name) AS name, v.sku, l.code, l.expires_at,
                 sum(s.on_hand)::float AS on_hand, (l.expires_at - current_date)::int AS days_left
          FROM lots l
          JOIN product_variants v ON v.id = l.variant_id
          JOIN products p ON p.id = v.product_id
          JOIN stock_items s ON s.lot_id = l.id
          WHERE l.expires_at IS NOT NULL AND l.expires_at <= current_date + ${days}::int
          GROUP BY l.id, p.name, v.name, v.sku
          HAVING sum(s.on_hand) > 0
          ORDER BY l.expires_at
          LIMIT 30`;
        for (const r of rows) {
          out.push({
            kind: 'expiring',
            severity: r.days_left < 0 ? 'high' : r.days_left <= 15 ? 'medium' : 'low',
            title: r.days_left < 0 ? `Vencido: ${r.name}` : `Vence el ${day(r.expires_at)}: ${r.name}`,
            detail: `${qty(r.on_hand)} en stock · ${r.days_left < 0 ? `venció hace ${-r.days_left} días` : `faltan ${r.days_left} días`} · lote ${r.code}`,
            link: `/inventory?q=${encodeURIComponent(r.sku)}`,
          });
        }
      }

      if (on('webOrders')) {
        const hours = settings.webOrders.value!;
        const rows = await tx.salesOrder.findMany({
          where: { status: 'PENDING_REVIEW', createdAt: { lte: new Date(Date.now() - hours * 3_600_000) } },
          orderBy: { createdAt: 'asc' },
          take: 20,
          select: { id: true, number: true, createdAt: true, contactName: true, customer: { select: { legalName: true, tradeName: true } } },
        });
        for (const o of rows) {
          const h = Math.floor((Date.now() - o.createdAt.getTime()) / 3_600_000);
          out.push({
            kind: 'webOrders',
            severity: h >= 24 ? 'high' : 'medium',
            title: `Pedido sin revisar: ${o.customer.tradeName ?? o.customer.legalName ?? o.contactName}`,
            detail: `${o.number} · entró hace ${h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`}`,
            link: `/orders/${o.id}`,
          });
        }
      }

      if (on('staleQuotes')) {
        const days = settings.staleQuotes.value!;
        const rows = await tx.$queryRaw<{ id: string; number: string; customer: string; valid_until: Date; days_left: number; total: number }[]>`
          SELECT q.id, q.number, coalesce(c.trade_name, c.legal_name) AS customer, q.valid_until,
                 (q.valid_until - current_date)::int AS days_left, (q.total + q.tax_total)::float AS total
          FROM quotes q JOIN customers c ON c.id = q.customer_id
          WHERE q.status IN ('SENT', 'DRAFT') AND q.valid_until IS NOT NULL
            AND q.valid_until BETWEEN current_date AND current_date + ${days}::int
          ORDER BY q.valid_until
          LIMIT 20`;
        for (const q of rows) {
          out.push({
            kind: 'staleQuotes',
            severity: 'low',
            title: `Presupuesto sin respuesta: ${q.customer}`,
            detail: `${q.number} · ${money(q.total)} · vence ${q.days_left === 0 ? 'hoy' : `en ${q.days_left} días`}`,
            link: `/sales/quotes/${q.id}`,
          });
        }
      }

      if (on('expiringDocs')) {
        const days = settings.expiringDocs.value!;
        const rows = await tx.$queryRaw<{ id: string; title: string; valid_until: Date; days_left: number }[]>`
          SELECT d.id, d.title, d.valid_until, (d.valid_until - current_date)::int AS days_left
          FROM documents d
          WHERE d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= current_date + ${days}::int
          ORDER BY d.valid_until
          LIMIT 20`;
        for (const d of rows) {
          out.push({
            kind: 'expiringDocs',
            severity: d.days_left < 0 ? 'high' : d.days_left <= 7 ? 'medium' : 'low',
            title: d.days_left < 0 ? `Documento vencido: ${d.title}` : `Documento por vencer: ${d.title}`,
            detail: d.days_left < 0 ? `Venció el ${fullDay(d.valid_until)}` : `Vence el ${fullDay(d.valid_until)} (${d.days_left === 0 ? 'hoy' : `en ${d.days_left} días`})`,
            link: `/documents/${d.id}`,
          });
        }
      }
    });

    if (on('lapsedCustomers')) {
      for (const c of (await this.insights.lapsed()).slice(0, 10)) {
        out.push({
          kind: 'lapsedCustomers',
          severity: 'low',
          title: `${c.name} dejó de comprar`,
          detail: `Compraba ${c.usualEveryDays ? `cada ~${c.usualEveryDays} días` : 'una vez'}; último pedido hace ${c.daysSinceLastOrder} días`,
          link: `/customers/${c.customerId}`,
        });
      }
    }

    const items = sortAlerts(out);
    return {
      items,
      counts: Object.fromEntries(ALERT_KINDS.map((k) => [k, items.filter((a) => a.kind === k).length])) as Record<AlertKind, number>,
      settings,
      allowed,
    };
  }
}
