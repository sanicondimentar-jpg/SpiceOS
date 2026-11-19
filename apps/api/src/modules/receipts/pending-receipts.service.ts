import { Injectable } from '@nestjs/common';
import type { ConfirmPendingReceiptInput, PendingReceiptDetail, PendingReceiptSource, PendingReceiptSummary, ReceiptReading } from '@spiceos/contracts';
import type { Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { InventoryService } from '../inventory/inventory.service';
import { ReceiptReaderService, type ReceiptFile } from './receipt-reader.service';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

// Todo menos la imagen, que se baja aparte.
const ROW = {
  id: true,
  source: true,
  status: true,
  supplierId: true,
  sender: true,
  reference: true,
  documentDate: true,
  note: true,
  reading: true,
  imageType: true,
  createdAt: true,
  supplier: { select: { id: true, legalName: true } },
} satisfies Prisma.PendingReceiptSelect;
type Row = Prisma.PendingReceiptGetPayload<{ select: typeof ROW }>;

/**
 * Remitos que llegaron de afuera (WhatsApp de un proveedor autorizado o una integración con clave)
 * y esperan que alguien los revise. Nunca suman stock solos: el ingreso se registra al confirmar.
 */
@Injectable()
export class PendingReceiptsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly reader: ReceiptReaderService,
    private readonly inventory: InventoryService,
  ) {}

  async create(input: {
    source: PendingReceiptSource;
    file: ReceiptFile;
    supplierId?: string | null;
    supplierCode?: string;
    sender?: string | null;
    messageId?: string | null;
    note?: string | null;
  }): Promise<{ id: string; reading: ReceiptReading }> {
    const ctx = RequestContextStore.get();
    let supplierId = input.supplierId ?? null;
    if (input.supplierCode) {
      const s = await this.uow.read((tx) => tx.supplier.findFirst({ where: { code: input.supplierCode }, select: { id: true } }));
      if (!s) throw new BusinessRuleError(`No existe el proveedor con código ${input.supplierCode}`);
      supplierId = s.id;
    }
    const reading = await this.reader.read(input.file);
    return this.uow.run(async (tx, scope) => {
      const row = await tx.pendingReceipt.create({
        data: {
          tenantId: ctx.tenantId,
          source: input.source,
          supplierId,
          sender: input.sender ?? null,
          messageId: input.messageId ?? null,
          reference: reading.reference,
          documentDate: reading.documentDate ? new Date(`${reading.documentDate}T00:00:00Z`) : null,
          note: input.note ?? null,
          reading: reading as unknown as Prisma.InputJsonValue,
          image: input.file.data,
          imageType: input.file.mediaType,
          createdBy: ctx.userId === SYSTEM_USER ? null : ctx.userId,
        },
      });
      scope.auditLog({ action: 'pending_receipt.create', entityType: 'pending_receipt', entityId: row.id, after: { source: input.source, sender: input.sender, reference: reading.reference, lines: reading.lines.length } });
      return { id: row.id, reading };
    });
  }

  list(status: 'PENDING' | 'ALL' = 'PENDING'): Promise<PendingReceiptSummary[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.pendingReceipt.findMany({
        where: status === 'PENDING' ? { status: 'PENDING' } : {},
        select: ROW,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map(summary);
    });
  }

  async get(id: string): Promise<PendingReceiptDetail> {
    const row = await this.find(id);
    return { ...summary(row), note: row.note, hasImage: !!row.imageType, reading: row.reading as unknown as ReceiptReading };
  }

  async image(id: string): Promise<{ data: Buffer; mimeType: string }> {
    const row = await this.uow.read((tx) => tx.pendingReceipt.findFirst({ where: { id }, select: { image: true, imageType: true } }));
    if (!row?.image) throw new NotFoundError('Imagen del remito', id);
    return { data: Buffer.from(row.image), mimeType: row.imageType ?? 'application/octet-stream' };
  }

  discard(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.pendingReceipt.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DISCARDED', resolvedBy: ctx.userId, resolvedAt: new Date() } });
      if (!count) throw new ConflictError('Ese remito ya no está por confirmar');
      scope.auditLog({ action: 'pending_receipt.discard', entityType: 'pending_receipt', entityId: id });
      return { id };
    });
  }

  /** Registra el ingreso revisado y marca el remito como confirmado (si el ingreso falla, vuelve a quedar pendiente). */
  async confirm(id: string, input: ConfirmPendingReceiptInput) {
    const ctx = RequestContextStore.get();
    const row = await this.find(id);
    const claimed = await this.uow.run((tx) =>
      tx.pendingReceipt.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CONFIRMED', resolvedBy: ctx.userId, resolvedAt: new Date() } }),
    );
    if (!claimed.count) throw new ConflictError('Ese remito ya no está por confirmar');
    try {
      const result = await this.inventory.receive(
        {
          ...input,
          supplierId: input.supplierId ?? row.supplierId ?? undefined,
          documentDate: input.documentDate ?? (row.documentDate ? row.documentDate.toISOString().slice(0, 10) : undefined),
        },
        'Ingreso de mercadería',
        { pendingReceiptId: id },
      );
      return { id, ...result };
    } catch (e) {
      await this.uow.run((tx) => tx.pendingReceipt.updateMany({ where: { id }, data: { status: 'PENDING', resolvedBy: null, resolvedAt: null } }));
      throw e;
    }
  }

  private async find(id: string): Promise<Row> {
    const row = await this.uow.read((tx) => tx.pendingReceipt.findFirst({ where: { id }, select: ROW }));
    if (!row) throw new NotFoundError('Remito por confirmar', id);
    return row;
  }
}

function summary(r: Row): PendingReceiptSummary {
  const reading = r.reading as unknown as ReceiptReading;
  return {
    id: r.id,
    source: r.source as PendingReceiptSource,
    status: r.status as PendingReceiptSummary['status'],
    supplier: r.supplier ? { id: r.supplier.id, name: r.supplier.legalName } : null,
    sender: r.sender,
    reference: r.reference,
    documentDate: r.documentDate ? r.documentDate.toISOString().slice(0, 10) : null,
    lines: reading.lines?.length ?? 0,
    unmatched: reading.unmatched?.length ?? 0,
    createdAt: r.createdAt.toISOString(),
  };
}
