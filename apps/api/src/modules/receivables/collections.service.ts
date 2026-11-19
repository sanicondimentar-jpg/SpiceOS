import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  paymentBucket,
  type CollectionSettingsInput,
  type CollectionsSummary,
  type CreateCustomerChargeInput,
  type CreateCustomerPaymentInput,
  type CustomerAccountStatement,
  type CustomerBalance,
  type CustomerChargeRow,
  type CustomerPaymentMethod,
  type CustomerPaymentRow,
  type OverdueDebt,
  type UpdateCustomerChargeInput,
} from '@spiceos/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { round2 } from '../../shared/domain/money';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork, type UowScope } from '../../shared/unit-of-work';
import { checkProof, type ProofFile } from '../purchasing/supplier-accounts.service';
import { addDays, allocate, allocateParts, asDate, chargeStatus, daysBetween, isoDay, termsFor, todayAr, type OpenCharge } from './collection-math';

export const DEFAULT_SETTINGS = {
  termsDays: 30,
  remindersEnabled: true,
  daysBefore: 10,
  notifyPhone: null as string | null,
  ownerTemplate: null as string | null,
  customerTemplate: null as string | null,
  templateLang: 'es_AR',
};
export type Settings = typeof DEFAULT_SETTINGS;

const CHARGE_INCLUDE = {
  allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } },
  order: { select: { id: true, number: true, withInvoice: true } },
  notices: { select: { kind: true, status: true, createdAt: true, error: true }, orderBy: { createdAt: 'asc' as const } },
};

type ChargeWithAllocs = { id: string; date: Date; dueDate: Date; total: unknown; cancelledAt: Date | null; allocations: { amount: unknown }[] };

const paidOf = (c: { allocations: { amount: unknown }[] }) => round2(c.allocations.reduce((s, a) => s + Number(a.amount), 0));
const balanceOf = (c: ChargeWithAllocs) => (c.cancelledAt ? 0 : round2(Number(c.total) - paidOf(c)));

/**
 * Cobranza a clientes. Cada pedido entregado queda como deuda del cliente con vencimiento
 * (plazo de la ficha o 30 días). Los cobros, en efectivo o en cuenta, se imputan a las deudas;
 * lo que sobra queda a cuenta y se usa solo en la próxima deuda.
 */
@Injectable()
export class CollectionsService {
  constructor(private readonly uow: UnitOfWork) {}

  // ---------------------------------------------------------------- configuración

  async settings(tx: Tx): Promise<Settings> {
    const s = await tx.collectionSettings.findFirst();
    if (!s) return { ...DEFAULT_SETTINGS };
    return {
      termsDays: s.termsDays,
      remindersEnabled: s.remindersEnabled,
      daysBefore: s.daysBefore,
      notifyPhone: s.notifyPhone,
      ownerTemplate: s.ownerTemplate,
      customerTemplate: s.customerTemplate,
      templateLang: s.templateLang,
    };
  }

  getSettings() {
    return this.uow.read((tx) => this.settings(tx));
  }

  saveSettings(input: CollectionSettingsInput) {
    const ctx = RequestContextStore.get();
    const data = {
      ...input,
      notifyPhone: input.notifyPhone?.trim() || null,
      ownerTemplate: input.ownerTemplate?.trim() || null,
      customerTemplate: input.customerTemplate?.trim() || null,
    };
    if (data.notifyPhone && data.notifyPhone.replace(/\D/g, '').length < 10) throw new BusinessRuleError('El teléfono para avisos tiene que tener código de área (por ejemplo 11 1234-5678)');
    return this.uow.run(async (tx, scope) => {
      await tx.collectionSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
      scope.auditLog({ action: 'collection_settings.update', entityType: 'collection_settings', entityId: ctx.tenantId, after: data });
      return this.settings(tx);
    });
  }

  // ---------------------------------------------------------------- consultas

  /** Resumen de la pantalla Cobranza: cobrado en efectivo y en cuenta en el período, saldos por cliente. */
  summary(from?: string, to?: string): Promise<CollectionsSummary> {
    const today = todayAr();
    const toDay = to ?? today;
    const fromDay = from ?? `${today.slice(0, 8)}01`;
    return this.uow.read(async (tx) => {
      const settings = await this.settings(tx);
      const balances = await this.balances(tx, settings);
      const payments = await tx.customerPayment.findMany({
        where: { cancelledAt: null, date: { gte: asDate(fromDay), lte: asDate(toDay) } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: PAYMENT_INCLUDE,
      });
      const users = await this.userNames(tx, payments.map((p) => p.createdBy));
      const byDay = new Map<string, { cash: number; account: number }>();
      let cash = 0;
      let account = 0;
      for (const p of payments) {
        const k = isoDay(p.date);
        const e = byDay.get(k) ?? { cash: 0, account: 0 };
        if (paymentBucket(p.method) === 'CASH') {
          e.cash = round2(e.cash + Number(p.amount));
          cash += Number(p.amount);
        } else {
          e.account = round2(e.account + Number(p.amount));
          account += Number(p.amount);
        }
        byDay.set(k, e);
      }
      return {
        from: fromDay,
        to: toDay,
        collected: { cash: round2(cash), account: round2(account), total: round2(cash + account) },
        byDay: [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, v]) => ({ date, ...v })),
        receivable: round2(balances.reduce((s, b) => s + Math.max(0, b.balance), 0)),
        overdue: round2(balances.reduce((s, b) => s + b.overdue, 0)),
        dueSoon: round2(balances.reduce((s, b) => s + b.dueSoon, 0)),
        daysBefore: settings.daysBefore,
        customers: balances.filter((b) => Math.abs(b.balance) > 0.005 || b.openCharges > 0),
        payments: payments.map((p) => ({ ...paymentRow(p, users), customerId: p.customerId, customer: p.customer.tradeName ?? p.customer.legalName })),
      };
    });
  }

  /** Saldo de cada cliente con movimientos. */
  private async balances(tx: Tx, settings: Settings, customerIds?: string[]): Promise<CustomerBalance[]> {
    const where = { cancelledAt: null, ...(customerIds && { customerId: { in: customerIds } }) };
    const [charges, payments] = await Promise.all([
      tx.customerCharge.findMany({ where, include: { allocations: CHARGE_INCLUDE.allocations } }),
      tx.customerPayment.groupBy({ by: ['customerId'], where, _sum: { amount: true }, _max: { date: true } }),
    ]);
    const ids = [...new Set([...charges.map((c) => c.customerId), ...payments.map((p) => p.customerId)])];
    if (!ids.length) return [];
    const customers = await tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, legalName: true, tradeName: true, phone: true } });
    const today = asDate(todayAr());
    const soon = addDays(today, settings.daysBefore);
    const acc = new Map<string, { charged: number; overdue: number; dueSoon: number; oldest: Date | null; open: number }>();
    for (const c of charges) {
      const e = acc.get(c.customerId) ?? { charged: 0, overdue: 0, dueSoon: 0, oldest: null, open: 0 };
      e.charged += Number(c.total);
      const bal = balanceOf(c);
      if (bal > 0.005) {
        e.open += 1;
        if (c.dueDate < today) e.overdue += bal;
        else if (c.dueDate <= soon) e.dueSoon += bal;
        if (!e.oldest || c.dueDate < e.oldest) e.oldest = c.dueDate;
      }
      acc.set(c.customerId, e);
    }
    const paid = new Map(payments.map((p) => [p.customerId, { amount: Number(p._sum.amount ?? 0), last: p._max.date }]));
    return customers
      .map((c) => {
        const e = acc.get(c.id) ?? { charged: 0, overdue: 0, dueSoon: 0, oldest: null, open: 0 };
        const p = paid.get(c.id);
        return {
          customerId: c.id,
          code: c.code,
          name: c.tradeName ?? c.legalName,
          phone: c.phone,
          balance: round2(e.charged - (p?.amount ?? 0)),
          overdue: round2(e.overdue),
          dueSoon: round2(e.dueSoon),
          oldestDueDate: e.oldest ? isoDay(e.oldest) : null,
          maxDaysOverdue: e.oldest && e.oldest < today ? daysBetween(e.oldest, today) : 0,
          openCharges: e.open,
          lastPaymentAt: p?.last ? isoDay(p.last) : null,
        };
      })
      .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance || a.name.localeCompare(b.name));
  }

  /** Cuenta corriente de un cliente: deudas, cobros y saldo. */
  statement(customerId: string): Promise<CustomerAccountStatement> {
    return this.uow.read(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId },
        select: { id: true, code: true, legalName: true, tradeName: true, phone: true, paymentTermsDays: true },
      });
      if (!customer) throw new NotFoundError('Cliente', customerId);
      const settings = await this.settings(tx);
      const [charges, payments] = await Promise.all([
        tx.customerCharge.findMany({ where: { customerId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: CHARGE_INCLUDE }),
        tx.customerPayment.findMany({ where: { customerId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: PAYMENT_INCLUDE }),
      ]);
      const orderIds = charges.map((c) => c.orderId).filter((x): x is string => !!x);
      const invoices = orderIds.length
        ? await tx.invoice.findMany({
            where: { orderId: { in: orderIds }, status: { not: 'CANCELLED' }, NOT: { type: { startsWith: 'NC' } } },
            select: { orderId: true, type: true, pointOfSale: true, number: true },
          })
        : [];
      const invoiceByOrder = new Map(invoices.map((i) => [i.orderId!, `Factura ${i.type} ${String(i.pointOfSale).padStart(5, '0')}-${String(i.number).padStart(8, '0')}`]));
      const users = await this.userNames(tx, payments.map((p) => p.createdBy));
      const today = asDate(todayAr());
      const chargeRows: CustomerChargeRow[] = charges.map((c) => {
        const total = Number(c.total);
        const paid = paidOf(c);
        const cancelled = !!c.cancelledAt;
        const balance = balanceOf(c);
        return {
          id: c.id,
          date: isoDay(c.date),
          dueDate: isoDay(c.dueDate),
          total,
          paid,
          balance,
          status: chargeStatus(total, paid, cancelled),
          daysOverdue: balance > 0.005 ? daysBetween(c.dueDate, today) : null,
          source: c.source === 'ORDER' ? 'ORDER' : 'MANUAL',
          description: c.description,
          order: c.order ? { id: c.order.id, number: c.order.number, withInvoice: c.order.withInvoice, invoice: invoiceByOrder.get(c.order.id) ?? null } : null,
          notices: c.notices.map((n) => ({ kind: n.kind, status: n.status, at: n.createdAt.toISOString(), error: n.error })),
        };
      });
      const paymentRows = payments.map((p) => paymentRow(p, users));
      const [balance] = await this.balances(tx, settings, [customerId]);
      const active = paymentRows.filter((p) => !p.cancelled);
      return {
        ...(balance ?? {
          customerId,
          code: customer.code,
          name: customer.tradeName ?? customer.legalName,
          phone: customer.phone,
          balance: 0,
          overdue: 0,
          dueSoon: 0,
          oldestDueDate: null,
          maxDaysOverdue: 0,
          openCharges: 0,
          lastPaymentAt: null,
        }),
        charged: round2(chargeRows.filter((c) => c.status !== 'CANCELLED').reduce((s, c) => s + c.total, 0)),
        paid: round2(active.reduce((s, p) => s + p.amount, 0)),
        credit: round2(active.reduce((s, p) => s + p.unallocated, 0)),
        termsDays: termsFor(customer.paymentTermsDays, settings.termsDays),
        charges: chargeRows,
        payments: paymentRows,
      };
    });
  }

  /** Deuda vencida de un cliente (null si no tiene): avisa al armar pedidos y frena la entrega. */
  async overdueDebt(tx: Tx, customerId: string): Promise<OverdueDebt | null> {
    return (await this.overdueByCustomer(tx, [customerId])).get(customerId) ?? null;
  }

  async overdueByCustomer(tx: Tx, customerIds: string[]): Promise<Map<string, OverdueDebt>> {
    const out = new Map<string, OverdueDebt>();
    if (!customerIds.length) return out;
    const today = asDate(todayAr());
    const charges = await tx.customerCharge.findMany({
      where: { customerId: { in: [...new Set(customerIds)] }, cancelledAt: null, dueDate: { lt: today } },
      include: { allocations: CHARGE_INCLUDE.allocations },
    });
    for (const c of charges) {
      const bal = balanceOf(c);
      if (bal <= 0.005) continue;
      const e = out.get(c.customerId);
      const oldest = !e || isoDay(c.dueDate) < e.oldestDueDate ? isoDay(c.dueDate) : e.oldestDueDate;
      out.set(c.customerId, {
        amount: round2((e?.amount ?? 0) + bal),
        oldestDueDate: oldest,
        maxDaysOverdue: daysBetween(asDate(oldest), today),
      });
    }
    return out;
  }

  /** Cobro de un pedido para mostrarlo en el pedido. */
  async orderCollection(tx: Tx, orderId: string) {
    const [charge, prepaid] = await Promise.all([
      tx.customerCharge.findFirst({ where: { orderId }, include: { allocations: CHARGE_INCLUDE.allocations } }),
      tx.customerPayment.findMany({ where: { orderId, cancelledAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }),
    ]);
    const today = asDate(todayAr());
    const unallocated = round2(prepaid.reduce((s, p) => s + Number(p.amount) - paidOf(p), 0));
    if (!charge) return { charge: null, prepaid: unallocated };
    const total = Number(charge.total);
    const paid = paidOf(charge);
    const balance = balanceOf(charge);
    return {
      charge: {
        id: charge.id,
        total,
        paid,
        balance,
        dueDate: isoDay(charge.dueDate),
        status: chargeStatus(total, paid, !!charge.cancelledAt),
        daysOverdue: balance > 0.005 ? daysBetween(charge.dueDate, today) : null,
      },
      prepaid: unallocated,
    };
  }

  // ---------------------------------------------------------------- deudas

  /**
   * Al entregar un pedido queda la deuda en la cuenta del cliente. Si ya había cobros a cuenta
   * (por ejemplo pagó por transferencia antes de recibirlo), se usan para cubrirla.
   */
  async chargeDeliveredOrder(tx: Tx, scope: UowScope, orderId: string) {
    if (await tx.customerCharge.findFirst({ where: { orderId }, select: { id: true } })) return;
    const order = await tx.salesOrder.findFirst({
      where: { id: orderId },
      select: { id: true, number: true, customerId: true, total: true, taxTotal: true, customer: { select: { paymentTermsDays: true } } },
    });
    if (!order) return;
    const total = round2(Number(order.total) + Number(order.taxTotal));
    if (total <= 0) return;
    const settings = await this.settings(tx);
    const date = asDate(todayAr());
    const charge = await tx.customerCharge.create({
      data: {
        tenantId: RequestContextStore.get().tenantId,
        customerId: order.customerId,
        orderId,
        date,
        dueDate: addDays(date, termsFor(order.customer.paymentTermsDays, settings.termsDays)),
        total,
        description: `Pedido ${order.number}`,
        source: 'ORDER',
        createdBy: RequestContextStore.get().userId,
      },
    });
    scope.auditLog({ action: 'customer_charge.create', entityType: 'customer_charge', entityId: charge.id, after: { orderId, total, dueDate: isoDay(charge.dueDate) } });
    await this.applyCredit(tx, order.customerId, orderId);
  }

  /** Usa los cobros sin imputar del cliente en sus deudas abiertas (primero los cobrados para `orderId`). */
  private async applyCredit(tx: Tx, customerId: string, preferOrderId?: string) {
    const payments = await tx.customerPayment.findMany({
      where: { customerId, cancelledAt: null },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, amount: true, orderId: true, allocations: { select: { amount: true } } },
    });
    const withCredit = payments
      .map((p) => ({ id: p.id, orderId: p.orderId, left: round2(Number(p.amount) - paidOf(p)) }))
      .filter((p) => p.left > 0.005)
      .sort((a, b) => Number(b.orderId === preferOrderId) - Number(a.orderId === preferOrderId));
    if (!withCredit.length) return;
    const open = await this.openCharges(tx, customerId);
    // Lo cobrado para un pedido va primero a ese pedido.
    const ordered = preferOrderId ? (await this.chargeIdForOrder(tx, preferOrderId)) : null;
    const tenantId = RequestContextStore.get().tenantId;
    for (const p of withCredit) {
      const targets = p.orderId && ordered && p.orderId === preferOrderId ? [...open.filter((c) => c.id === ordered), ...open.filter((c) => c.id !== ordered)] : open;
      const { allocations } = p.orderId && ordered && p.orderId === preferOrderId ? allocateInOrder(p.left, targets) : allocate(p.left, targets);
      for (const a of allocations) {
        await tx.customerPaymentAllocation.upsert({
          where: { paymentId_chargeId: { paymentId: p.id, chargeId: a.chargeId } },
          create: { tenantId, paymentId: p.id, chargeId: a.chargeId, amount: a.amount },
          update: { amount: { increment: a.amount } },
        });
        const c = open.find((x) => x.id === a.chargeId)!;
        c.balance = round2(c.balance - a.amount);
      }
    }
  }

  private async chargeIdForOrder(tx: Tx, orderId: string) {
    return (await tx.customerCharge.findFirst({ where: { orderId, cancelledAt: null }, select: { id: true } }))?.id ?? null;
  }

  private async openCharges(tx: Tx, customerId: string, ids?: string[]): Promise<OpenCharge[]> {
    const rows = await tx.customerCharge.findMany({
      where: { customerId, cancelledAt: null, ...(ids && { id: { in: ids } }) },
      include: { allocations: CHARGE_INCLUDE.allocations },
    });
    return rows.map((c) => ({ id: c.id, date: c.date, dueDate: c.dueDate, balance: balanceOf(c) })).filter((c) => c.balance > 0.005);
  }

  /** Deuda cargada a mano (lo que debía de antes del sistema). */
  createCharge(customerId: string, input: CreateCustomerChargeInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId }, select: { id: true, paymentTermsDays: true } });
      if (!customer) throw new NotFoundError('Cliente', customerId);
      const settings = await this.settings(tx);
      const date = asDate(input.date);
      const dueDate = input.dueDate ? asDate(input.dueDate) : addDays(date, termsFor(customer.paymentTermsDays, settings.termsDays));
      if (dueDate < date) throw new BusinessRuleError('El vencimiento no puede ser anterior a la fecha');
      const row = await tx.customerCharge.create({
        data: {
          tenantId: ctx.tenantId,
          customerId,
          date,
          dueDate,
          total: round2(input.total),
          description: input.description ?? null,
          source: 'MANUAL',
          createdBy: ctx.userId,
        },
      });
      scope.auditLog({ action: 'customer_charge.create', entityType: 'customer_charge', entityId: row.id, after: { customerId, ...input, dueDate: isoDay(dueDate) } });
      await this.applyCredit(tx, customerId);
      return { id: row.id };
    });
  }

  updateCharge(id: string, input: UpdateCustomerChargeInput) {
    return this.uow.run(async (tx, scope) => {
      const c = await tx.customerCharge.findFirst({ where: { id } });
      if (!c) throw new NotFoundError('Deuda', id);
      if (c.cancelledAt) throw new ConflictError('La deuda está anulada');
      if (input.dueDate && asDate(input.dueDate) < c.date) throw new BusinessRuleError('El vencimiento no puede ser anterior a la fecha');
      await tx.customerCharge.update({
        where: { id },
        data: {
          ...(input.dueDate && { dueDate: asDate(input.dueDate) }),
          ...(input.description !== undefined && { description: input.description || null }),
        },
      });
      // Si cambia el vencimiento, los avisos vuelven a mandarse con la fecha nueva.
      if (input.dueDate && input.dueDate !== isoDay(c.dueDate)) await tx.collectionNotice.deleteMany({ where: { chargeId: id } });
      scope.auditLog({ action: 'customer_charge.update', entityType: 'customer_charge', entityId: id, before: { dueDate: isoDay(c.dueDate), description: c.description }, after: input });
      return { id };
    });
  }

  /** Solo sin cobros imputados: primero hay que anular el cobro. */
  cancelCharge(id: string) {
    return this.uow.run(async (tx, scope) => {
      const c = await tx.customerCharge.findFirst({ where: { id }, include: { allocations: CHARGE_INCLUDE.allocations } });
      if (!c) throw new NotFoundError('Deuda', id);
      if (c.cancelledAt) return { id };
      if (c.allocations.length) throw new BusinessRuleError('La deuda tiene cobros: anulá primero el cobro');
      await tx.customerCharge.update({ where: { id }, data: { cancelledAt: new Date() } });
      scope.auditLog({ action: 'customer_charge.cancel', entityType: 'customer_charge', entityId: id });
      return { id };
    });
  }

  // ---------------------------------------------------------------- cobros

  /**
   * Registra un cobro: parte en efectivo y/o parte en cuenta (dos filas del mismo grupo, el comprobante
   * va con la parte en cuenta). Se imputa a las deudas elegidas; si no se elige ninguna, al pedido
   * indicado o a las deudas que vencen primero. Lo que sobra queda a cuenta.
   */
  createPayment(customerId: string, input: CreateCustomerPaymentInput, proof: ProofFile | null) {
    if (proof) checkProof(proof);
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId }, select: { id: true } });
      if (!customer) throw new NotFoundError('Cliente', customerId);
      if (input.orderId) {
        const o = await tx.salesOrder.findFirst({ where: { id: input.orderId }, select: { customerId: true, status: true } });
        if (!o) throw new NotFoundError('Pedido', input.orderId);
        if (o.customerId !== customerId) throw new BusinessRuleError('El pedido es de otro cliente');
        if (o.status === 'CANCELLED') throw new BusinessRuleError('El pedido está cancelado');
      }
      const ids = [...new Set(input.chargeIds)];
      let targets: OpenCharge[];
      if (ids.length) {
        const rows = await tx.customerCharge.findMany({ where: { id: { in: ids } }, include: { allocations: CHARGE_INCLUDE.allocations } });
        if (rows.length !== ids.length) throw new NotFoundError('Deuda', ids.find((i) => !rows.some((r) => r.id === i))!);
        for (const r of rows) {
          if (r.customerId !== customerId) throw new BusinessRuleError('Todas las deudas tienen que ser del mismo cliente');
          if (r.cancelledAt) throw new BusinessRuleError(`${r.description ?? 'La deuda'} está anulada`);
          if (balanceOf(r) <= 0.005) throw new BusinessRuleError(`${r.description ?? 'La deuda'} ya está cobrada`);
        }
        targets = rows.map((c) => ({ id: c.id, date: c.date, dueDate: c.dueDate, balance: balanceOf(c) }));
      } else if (input.orderId) {
        // Cobrado para un pedido: a ese pedido si ya se entregó; si no, queda a cuenta hasta que se entregue.
        const chargeId = await this.chargeIdForOrder(tx, input.orderId);
        targets = chargeId ? await this.openCharges(tx, customerId, [chargeId]) : [];
      } else {
        targets = await this.openCharges(tx, customerId);
      }

      const parts = [
        ...(input.cashAmount > 0 ? [{ key: 'CASH', amount: round2(input.cashAmount) }] : []),
        ...(input.accountAmount > 0 ? [{ key: input.accountMethod, amount: round2(input.accountAmount) }] : []),
      ];
      const split = allocateParts(parts, targets);
      const groupId = parts.length > 1 ? randomUUID() : null;
      const created: { id: string; method: string; amount: number; unallocated: number }[] = [];
      for (const [i, part] of split.entries()) {
        const method = parts[i]!.key as CustomerPaymentMethod;
        // El comprobante es de la transferencia: va con la parte en cuenta (o con la única que haya).
        const withProof = proof && (method !== 'CASH' || parts.length === 1);
        const row = await tx.customerPayment.create({
          data: {
            tenantId: ctx.tenantId,
            customerId,
            orderId: input.orderId ?? null,
            groupId,
            date: asDate(input.date),
            method,
            amount: parts[i]!.amount,
            reference: method === 'CASH' ? null : input.reference ?? null,
            notes: input.notes ?? null,
            collectedBy: input.collectedBy ?? null,
            proof: withProof ? proof.data : null,
            proofType: withProof ? proof.mimeType : null,
            proofName: withProof ? proof.name : null,
            createdBy: ctx.userId,
            allocations: { create: part.allocations.map((a) => ({ tenantId: ctx.tenantId, chargeId: a.chargeId, amount: a.amount })) },
          },
          select: { id: true },
        });
        created.push({ id: row.id, method, amount: parts[i]!.amount, unallocated: part.unallocated });
      }
      scope.auditLog({
        action: 'customer_payment.create',
        entityType: 'customer_payment',
        entityId: created[0]!.id,
        after: { customerId, date: input.date, cash: input.cashAmount, account: input.accountAmount, method: input.accountMethod, orderId: input.orderId, parts: created, proof: !!proof },
      });
      return { ids: created.map((c) => c.id), unallocated: round2(created.reduce((s, c) => s + c.unallocated, 0)) };
    });
  }

  attachProof(id: string, proof: ProofFile) {
    checkProof(proof);
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.customerPayment.updateMany({ where: { id }, data: { proof: proof.data, proofType: proof.mimeType, proofName: proof.name } });
      if (!count) throw new NotFoundError('Cobro', id);
      scope.auditLog({ action: 'customer_payment.proof', entityType: 'customer_payment', entityId: id, after: { name: proof.name } });
      return { id };
    });
  }

  async proof(id: string) {
    const row = await this.uow.read((tx) => tx.customerPayment.findFirst({ where: { id }, select: { proof: true, proofType: true, proofName: true } }));
    if (!row?.proof) throw new NotFoundError('Comprobante del cobro', id);
    return { data: Buffer.from(row.proof), mimeType: row.proofType ?? 'application/octet-stream', name: row.proofName ?? 'comprobante' };
  }

  /** Anular un cobro cargado por error: las deudas que cubría vuelven a quedar con saldo. */
  cancelPayment(id: string) {
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.customerPayment.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      if (!count) {
        if (!(await tx.customerPayment.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundError('Cobro', id);
        return { id };
      }
      scope.auditLog({ action: 'customer_payment.cancel', entityType: 'customer_payment', entityId: id });
      return { id };
    });
  }

  private async userNames(tx: Tx, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  }
}

/** Imputa en el orden dado (el pedido para el que se cobró primero). */
function allocateInOrder(amount: number, charges: OpenCharge[]) {
  let left = round2(amount);
  const allocations: { chargeId: string; amount: number }[] = [];
  for (const c of charges) {
    if (left <= 0) break;
    const take = round2(Math.min(left, c.balance));
    if (take <= 0) continue;
    allocations.push({ chargeId: c.id, amount: take });
    left = round2(left - take);
  }
  return { allocations, unallocated: left };
}

const PAYMENT_INCLUDE = {
  customer: { select: { legalName: true, tradeName: true } },
  order: { select: { id: true, number: true } },
  allocations: { select: { amount: true, charge: { select: { id: true, date: true, description: true } } } },
};

function paymentRow(
  p: {
    id: string;
    groupId: string | null;
    date: Date;
    method: string;
    amount: unknown;
    reference: string | null;
    notes: string | null;
    collectedBy: string | null;
    proofType: string | null;
    proofName: string | null;
    createdBy: string | null;
    createdAt: Date;
    cancelledAt: Date | null;
    order: { id: string; number: string } | null;
    allocations: { amount: unknown; charge: { id: string; date: Date; description: string | null } }[];
  },
  users: Map<string, string>,
): CustomerPaymentRow {
  const amount = Number(p.amount);
  const allocated = p.allocations.reduce((s, a) => s + Number(a.amount), 0);
  return {
    id: p.id,
    groupId: p.groupId,
    date: isoDay(p.date),
    method: p.method as CustomerPaymentMethod,
    bucket: paymentBucket(p.method),
    amount,
    unallocated: p.cancelledAt ? 0 : round2(amount - allocated),
    reference: p.reference,
    notes: p.notes,
    collectedBy: p.collectedBy,
    hasProof: !!p.proofType,
    proofType: p.proofType,
    proofName: p.proofName,
    createdBy: p.createdBy ? users.get(p.createdBy) ?? null : null,
    createdAt: p.createdAt.toISOString(),
    cancelled: !!p.cancelledAt,
    order: p.order,
    allocations: p.allocations.map((a) => ({ chargeId: a.charge.id, date: isoDay(a.charge.date), label: a.charge.description ?? 'Deuda', amount: Number(a.amount) })),
  };
}
