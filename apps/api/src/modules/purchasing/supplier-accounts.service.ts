import { Injectable } from '@nestjs/common';
import type {
  CreateSupplierPaymentInput,
  CreateSupplierPurchaseInput,
  SupplierAccountDetail,
  SupplierAccountSummary,
  SupplierPaymentMethod,
  SupplierPaymentRow,
  SupplierPurchaseRow,
  UpdateSupplierPurchaseInput,
} from '@spiceos/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { round2 } from '../../shared/domain/money';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { allocatePayment, purchaseStatus } from './supplier-allocation';

export interface ProofFile {
  data: Buffer;
  mimeType: string;
  name: string;
}

export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
const PROOF_TYPES = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

export function checkProof(file: ProofFile) {
  if (!PROOF_TYPES.test(file.mimeType)) throw new BusinessRuleError('El comprobante tiene que ser una foto o un PDF');
  if (file.data.length > PROOF_MAX_BYTES) throw new BusinessRuleError('El comprobante pesa más de 8 MB');
}

/** Cuenta corriente con proveedores: compras, pagos con comprobante y saldo. */
@Injectable()
export class SupplierAccountsService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Saldo de cada proveedor con movimientos (o activo). */
  list(): Promise<SupplierAccountSummary[]> {
    return this.uow.read(async (tx) => {
      const [suppliers, purchases, payments, allocs] = await Promise.all([
        tx.supplier.findMany({ orderBy: { legalName: 'asc' }, select: { id: true, code: true, legalName: true, isActive: true } }),
        tx.supplierPurchase.groupBy({ by: ['supplierId'], where: { cancelledAt: null }, _sum: { total: true } }),
        tx.supplierPayment.groupBy({ by: ['supplierId'], where: { cancelledAt: null }, _sum: { amount: true }, _max: { date: true } }),
        tx.supplierPaymentAllocation.findMany({ where: { payment: { cancelledAt: null } }, select: { purchaseId: true, amount: true } }),
      ]);
      const paidByPurchase = new Map<string, number>();
      for (const a of allocs) paidByPurchase.set(a.purchaseId, (paidByPurchase.get(a.purchaseId) ?? 0) + Number(a.amount));
      const open = await tx.supplierPurchase.findMany({ where: { cancelledAt: null }, select: { id: true, supplierId: true, total: true } });
      const unpaid = new Map<string, number>();
      for (const p of open) if (Number(p.total) - (paidByPurchase.get(p.id) ?? 0) > 0.005) unpaid.set(p.supplierId, (unpaid.get(p.supplierId) ?? 0) + 1);
      const bought = new Map(purchases.map((p) => [p.supplierId, Number(p._sum.total ?? 0)]));
      const paid = new Map(payments.map((p) => [p.supplierId, { amount: Number(p._sum.amount ?? 0), last: p._max.date }]));
      return suppliers
        .filter((s) => s.isActive || bought.has(s.id) || paid.has(s.id))
        .map((s) => {
          const purchased = round2(bought.get(s.id) ?? 0);
          const p = paid.get(s.id);
          const paidAmount = round2(p?.amount ?? 0);
          return {
            supplierId: s.id,
            code: s.code,
            name: s.legalName,
            purchased,
            paid: paidAmount,
            balance: round2(purchased - paidAmount),
            unpaidPurchases: unpaid.get(s.id) ?? 0,
            lastPaymentAt: p?.last ? day(p.last) : null,
          };
        });
    });
  }

  get(supplierId: string): Promise<SupplierAccountDetail> {
    return this.uow.read(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId }, select: { id: true, code: true, legalName: true } });
      if (!supplier) throw new NotFoundError('Proveedor', supplierId);
      const [purchases, payments] = await Promise.all([
        tx.supplierPurchase.findMany({
          where: { supplierId },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
        }),
        tx.supplierPayment.findMany({
          where: { supplierId },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true, date: true, method: true, amount: true, reference: true, notes: true, proofType: true, proofName: true,
            createdBy: true, createdAt: true, cancelledAt: true,
            allocations: { select: { amount: true, purchase: { select: { id: true, date: true, reference: true } } } },
          },
        }),
      ]);
      const receiptIds = purchases.map((p) => p.pendingReceiptId).filter((x): x is string => !!x);
      const withImage = new Set(
        receiptIds.length
          ? (await tx.pendingReceipt.findMany({ where: { id: { in: receiptIds }, image: { not: null } }, select: { id: true } })).map((r) => r.id)
          : [],
      );
      const userIds = [...new Set(payments.map((p) => p.createdBy).filter((x): x is string => !!x))];
      const users = new Map(
        userIds.length ? (await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]) : [],
      );

      const purchaseRows: SupplierPurchaseRow[] = purchases.map((p) => {
        const total = Number(p.total);
        const paid = round2(p.allocations.reduce((s, a) => s + Number(a.amount), 0));
        const cancelled = !!p.cancelledAt;
        return {
          id: p.id,
          date: day(p.date),
          reference: p.reference,
          total,
          paid,
          balance: cancelled ? 0 : round2(total - paid),
          status: purchaseStatus(total, paid, cancelled),
          source: p.source === 'RECEIPT' ? 'RECEIPT' : 'MANUAL',
          notes: p.notes,
          hasReceiptImage: !!p.pendingReceiptId && withImage.has(p.pendingReceiptId),
          pendingReceiptId: p.pendingReceiptId,
        };
      });
      const paymentRows: SupplierPaymentRow[] = payments.map((p) => {
        const amount = Number(p.amount);
        const allocated = p.allocations.reduce((s, a) => s + Number(a.amount), 0);
        return {
          id: p.id,
          date: day(p.date),
          method: p.method as SupplierPaymentMethod,
          amount,
          unallocated: round2(amount - allocated),
          reference: p.reference,
          notes: p.notes,
          hasProof: !!p.proofType,
          proofType: p.proofType,
          proofName: p.proofName,
          createdBy: p.createdBy ? users.get(p.createdBy) ?? null : null,
          createdAt: p.createdAt.toISOString(),
          cancelled: !!p.cancelledAt,
          allocations: p.allocations.map((a) => ({ purchaseId: a.purchase.id, date: day(a.purchase.date), reference: a.purchase.reference, amount: Number(a.amount) })),
        };
      });
      const purchased = round2(purchaseRows.filter((p) => p.status !== 'CANCELLED').reduce((s, p) => s + p.total, 0));
      const active = paymentRows.filter((p) => !p.cancelled);
      const paid = round2(active.reduce((s, p) => s + p.amount, 0));
      const last = active.map((p) => p.date).sort().at(-1) ?? null;
      return {
        supplierId: supplier.id,
        code: supplier.code,
        name: supplier.legalName,
        purchased,
        paid,
        balance: round2(purchased - paid),
        credit: round2(active.reduce((s, p) => s + p.unallocated, 0)),
        unpaidPurchases: purchaseRows.filter((p) => p.status === 'UNPAID' || p.status === 'PARTIAL').length,
        lastPaymentAt: last,
        purchases: purchaseRows,
        payments: paymentRows,
      };
    });
  }

  createPurchase(supplierId: string, input: CreateSupplierPurchaseInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.assertSupplier(tx, supplierId);
      const row = await tx.supplierPurchase.create({
        data: {
          tenantId: ctx.tenantId,
          supplierId,
          date: asDate(input.date),
          reference: input.reference ?? null,
          total: round2(input.total),
          notes: input.notes ?? null,
          source: 'MANUAL',
          createdBy: ctx.userId,
        },
      });
      scope.auditLog({ action: 'supplier_purchase.create', entityType: 'supplier_purchase', entityId: row.id, after: { supplierId, ...input } });
      return { id: row.id };
    });
  }

  updatePurchase(id: string, input: UpdateSupplierPurchaseInput) {
    return this.uow.run(async (tx, scope) => {
      const p = await tx.supplierPurchase.findFirst({ where: { id }, include: { allocations: { where: { payment: { cancelledAt: null } } } } });
      if (!p) throw new NotFoundError('Compra', id);
      if (p.cancelledAt) throw new ConflictError('La compra está anulada');
      const paid = p.allocations.reduce((s, a) => s + Number(a.amount), 0);
      if (input.total !== undefined && round2(input.total) + 0.005 < paid) {
        throw new BusinessRuleError(`Ya tiene pagos por $${round2(paid).toLocaleString('es-AR')}: el total no puede ser menor`);
      }
      await tx.supplierPurchase.update({
        where: { id },
        data: {
          ...(input.date && { date: asDate(input.date) }),
          ...(input.reference !== undefined && { reference: input.reference || null }),
          ...(input.total !== undefined && { total: round2(input.total) }),
          ...(input.notes !== undefined && { notes: input.notes || null }),
        },
      });
      scope.auditLog({ action: 'supplier_purchase.update', entityType: 'supplier_purchase', entityId: id, before: { total: Number(p.total), date: day(p.date), reference: p.reference }, after: input });
      return { id };
    });
  }

  /** Solo sin pagos: primero hay que anular el pago que la cubre. */
  cancelPurchase(id: string) {
    return this.uow.run(async (tx, scope) => {
      const p = await tx.supplierPurchase.findFirst({ where: { id }, include: { allocations: { where: { payment: { cancelledAt: null } } } } });
      if (!p) throw new NotFoundError('Compra', id);
      if (p.cancelledAt) return { id };
      if (p.allocations.length) throw new BusinessRuleError('La compra tiene pagos: anulá primero el pago');
      await tx.supplierPurchase.update({ where: { id }, data: { cancelledAt: new Date() } });
      scope.auditLog({ action: 'supplier_purchase.cancel', entityType: 'supplier_purchase', entityId: id });
      return { id };
    });
  }

  /** Un pago con su comprobante; puede cubrir varias compras del proveedor (de la más vieja a la más nueva). */
  createPayment(supplierId: string, input: CreateSupplierPaymentInput, proof: ProofFile | null) {
    if (proof) checkProof(proof);
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.assertSupplier(tx, supplierId);
      const ids = [...new Set(input.purchaseIds)];
      const purchases = ids.length
        ? await tx.supplierPurchase.findMany({
            where: { id: { in: ids } },
            include: { allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
          })
        : [];
      if (purchases.length !== ids.length) throw new NotFoundError('Compra', ids.find((i) => !purchases.some((p) => p.id === i))!);
      for (const p of purchases) {
        if (p.supplierId !== supplierId) throw new BusinessRuleError('Todas las compras tienen que ser del mismo proveedor');
        if (p.cancelledAt) throw new BusinessRuleError(`La compra ${p.reference ?? day(p.date)} está anulada`);
      }
      const open = purchases.map((p) => ({ id: p.id, date: p.date, balance: round2(Number(p.total) - p.allocations.reduce((s, a) => s + Number(a.amount), 0)) }));
      const paidAlready = open.find((p) => p.balance <= 0.005);
      if (paidAlready) {
        const p = purchases.find((x) => x.id === paidAlready.id)!;
        throw new BusinessRuleError(`La compra ${p.reference ?? day(p.date)} ya está pagada`);
      }
      const { allocations, unallocated } = allocatePayment(input.amount, open);
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId: ctx.tenantId,
          supplierId,
          date: asDate(input.date),
          method: input.method,
          amount: round2(input.amount),
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          proof: proof?.data ?? null,
          proofType: proof?.mimeType ?? null,
          proofName: proof?.name ?? null,
          createdBy: ctx.userId,
          allocations: { create: allocations.map((a) => ({ tenantId: ctx.tenantId, purchaseId: a.purchaseId, amount: a.amount })) },
        },
        select: { id: true },
      });
      scope.auditLog({
        action: 'supplier_payment.create',
        entityType: 'supplier_payment',
        entityId: payment.id,
        after: { supplierId, date: input.date, method: input.method, amount: input.amount, reference: input.reference, allocations, unallocated, proof: !!proof },
      });
      return { id: payment.id, allocations, unallocated };
    });
  }

  attachProof(id: string, proof: ProofFile) {
    checkProof(proof);
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.supplierPayment.updateMany({ where: { id }, data: { proof: proof.data, proofType: proof.mimeType, proofName: proof.name } });
      if (!count) throw new NotFoundError('Pago', id);
      scope.auditLog({ action: 'supplier_payment.proof', entityType: 'supplier_payment', entityId: id, after: { name: proof.name } });
      return { id };
    });
  }

  async proof(id: string): Promise<{ data: Buffer; mimeType: string; name: string }> {
    const row = await this.uow.read((tx) => tx.supplierPayment.findFirst({ where: { id }, select: { proof: true, proofType: true, proofName: true } }));
    if (!row?.proof) throw new NotFoundError('Comprobante del pago', id);
    return { data: Buffer.from(row.proof), mimeType: row.proofType ?? 'application/octet-stream', name: row.proofName ?? 'comprobante' };
  }

  /** Anular un pago (cargado por error): las compras que cubría vuelven a quedar con saldo. */
  cancelPayment(id: string) {
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.supplierPayment.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      if (!count) {
        if (!(await tx.supplierPayment.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundError('Pago', id);
        return { id };
      }
      scope.auditLog({ action: 'supplier_payment.cancel', entityType: 'supplier_payment', entityId: id });
      return { id };
    });
  }

  private async assertSupplier(tx: Tx, id: string) {
    if (!(await tx.supplier.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundError('Proveedor', id);
  }
}
