import { Injectable } from '@nestjs/common';
import type { DocumentKind, Prisma } from '@prisma/client';
import type { CreateDocumentInput, DocumentEntity, DocumentSummary, UpdateDocumentInput } from '@spiceos/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { UnitOfWork } from '../../shared/unit-of-work';
import { IngestionService } from '../knowledge/ingestion.service';
import { DocumentsService } from './documents.service';
import { extractText } from './text-extractor';

export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif|gif)|text\/(plain|csv|markdown)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel)$/;

export interface UploadedDoc {
  data: Buffer;
  mimeType: string;
  name: string;
}

const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const splitTags = (s?: string) => [...new Set((s ?? '').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20);

function checkFile(file: UploadedDoc | null): asserts file is UploadedDoc {
  if (!file || !file.data.length) throw new BusinessRuleError('Elegí un archivo');
  if (!ALLOWED.test(file.mimeType)) throw new BusinessRuleError('Formato no admitido: subí un PDF, una foto, un Word, un Excel o un texto');
  if (file.data.length > DOCUMENT_MAX_BYTES) throw new BusinessRuleError('El archivo pesa más de 15 MB');
}

/** Lo que se extrae se indexa para el copiloto; si falla (PDF escaneado, archivo roto) el documento igual se guarda. */
async function textOf(file: UploadedDoc): Promise<string | null> {
  try {
    const text = (await extractText(file.data, file.mimeType))?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

/** Archivo de documentos: subir, ver, reemplazar por una versión nueva y dar de baja. */
@Injectable()
export class DocumentsLibraryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly versions: DocumentsService,
    private readonly knowledge: IngestionService,
  ) {}

  async list(filter: { kind?: string; q?: string; entityType?: string; entityId?: string }): Promise<DocumentSummary[]> {
    const where: Prisma.DocumentWhereInput = { deletedAt: null };
    if (filter.kind) where.kind = filter.kind as DocumentKind;
    if (filter.entityType && filter.entityId) Object.assign(where, { entityType: filter.entityType, entityId: filter.entityId });
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { tags: { has: q.toLowerCase() } }];
    }
    return this.uow.read(async (tx) => {
      const docs = await tx.document.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: 500, include: { driveFile: { select: { id: true } } } });
      return this.summaries(tx, docs);
    });
  }

  async get(id: string) {
    return this.uow.read(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, deletedAt: null }, include: { driveFile: { select: { id: true, webViewLink: true } } } });
      if (!doc) throw new NotFoundError('Documento', id);
      const [summary] = await this.summaries(tx, [doc]);
      const versions = await tx.documentVersion.findMany({
        where: { documentId: id },
        orderBy: { versionNo: 'desc' },
        select: { id: true, versionNo: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, createdBy: true, indexedAt: true },
      });
      return {
        ...summary,
        driveLink: doc.driveFile?.webViewLink ?? null,
        versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString(), indexedAt: v.indexedAt?.toISOString() ?? null })),
      };
    });
  }

  async create(input: CreateDocumentInput, file: UploadedDoc | null) {
    checkFile(file);
    if (input.entityType && input.entityId) await this.uow.read((tx) => this.assertEntity(tx, input.entityType!, input.entityId!));
    const res = await this.versions.addVersion({
      title: input.title,
      kind: input.kind,
      mimeType: file.mimeType,
      content: file.data,
      keepContent: true,
      fileName: file.name,
      extractedText: await textOf(file),
      entityType: input.entityType,
      entityId: input.entityId,
      validUntil: input.validUntil ? asDate(input.validUntil) : undefined,
      tags: splitTags(input.tags).map((t) => t.toLowerCase()),
    });
    return this.get(res!.documentId);
  }

  /** Reemplaza el archivo: la versión anterior queda en el historial. Si es el mismo archivo, no cambia nada. */
  async addVersion(id: string, file: UploadedDoc | null, validUntil?: string) {
    checkFile(file);
    const doc = await this.uow.read((tx) => tx.document.findFirst({ where: { id, deletedAt: null }, include: { driveFile: { select: { id: true } } } }));
    if (!doc) throw new NotFoundError('Documento', id);
    if (doc.driveFile) throw new BusinessRuleError('Este documento viene de Google Drive: se actualiza solo cuando cambia allá');
    const res = await this.versions.addVersion({
      documentId: id,
      title: doc.title,
      kind: doc.kind,
      mimeType: file.mimeType,
      content: file.data,
      keepContent: true,
      fileName: file.name,
      extractedText: await textOf(file),
    });
    if (validUntil) await this.update(id, { validUntil });
    return { ...(await this.get(id)), unchanged: !res };
  }

  update(id: string, input: UpdateDocumentInput) {
    return this.uow
      .run(async (tx, scope) => {
        const doc = await tx.document.findFirst({ where: { id, deletedAt: null } });
        if (!doc) throw new NotFoundError('Documento', id);
        const data: Prisma.DocumentUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.kind !== undefined) data.kind = input.kind;
        if (input.validUntil !== undefined) data.validUntil = input.validUntil ? asDate(input.validUntil) : null;
        if (input.tags !== undefined) data.tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
        if (input.entityType !== undefined || input.entityId !== undefined) {
          const type = input.entityType ?? null;
          const eid = input.entityId ?? null;
          if (!type !== !eid) throw new BusinessRuleError('Elegí a qué producto, proveedor o cliente corresponde');
          if (type && eid) await this.assertEntity(tx, type, eid);
          data.entityType = type;
          data.entityId = eid;
        }
        await tx.document.update({ where: { id }, data });
        scope.auditLog({ action: 'document.update', entityType: 'document', entityId: id, before: { title: doc.title, kind: doc.kind }, after: input });
      })
      .then(() => this.get(id));
  }

  async remove(id: string) {
    await this.uow.run(async (tx, scope) => {
      const doc = await tx.document.findFirst({ where: { id, deletedAt: null } });
      if (!doc) throw new NotFoundError('Documento', id);
      await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
      scope.auditLog({ action: 'document.delete', entityType: 'document', entityId: id, before: { title: doc.title } });
    });
    // Que el copiloto deje de citarlo. Si el índice no responde, el documento igual queda dado de baja.
    await this.knowledge.remove('document', id).catch(() => undefined);
    return { ok: true };
  }

  /** Archivo de una versión (por defecto, la actual). */
  async file(id: string, versionId?: string): Promise<UploadedDoc> {
    return this.uow.read(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, deletedAt: null } });
      if (!doc) throw new NotFoundError('Documento', id);
      const vid = versionId ?? doc.currentVersionId;
      const v = vid ? await tx.documentVersion.findFirst({ where: { id: vid, documentId: id } }) : null;
      if (!v?.content) throw new BusinessRuleError('Este documento no tiene el archivo guardado en SpiceOS (abrilo desde Google Drive)');
      return { data: Buffer.from(v.content), mimeType: v.mimeType, name: v.fileName ?? doc.title };
    });
  }

  private async assertEntity(tx: Tx, type: DocumentEntity | string, id: string) {
    const found =
      type === 'product'
        ? await tx.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
        : type === 'supplier'
          ? await tx.supplier.findFirst({ where: { id }, select: { id: true } })
          : type === 'customer'
            ? await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
            : null;
    if (!found) throw new BusinessRuleError('No encontré el producto, proveedor o cliente elegido');
  }

  private async summaries(
    tx: Tx,
    docs: (Prisma.DocumentGetPayload<object> & { driveFile: { id: string } | null })[],
  ): Promise<DocumentSummary[]> {
    const ids = (t: string) => [...new Set(docs.filter((d) => d.entityType === t && d.entityId).map((d) => d.entityId!))];
    const [products, suppliers, customers, versions] = await Promise.all([
      tx.product.findMany({ where: { id: { in: ids('product') } }, select: { id: true, name: true } }),
      tx.supplier.findMany({ where: { id: { in: ids('supplier') } }, select: { id: true, legalName: true } }),
      tx.customer.findMany({ where: { id: { in: ids('customer') } }, select: { id: true, legalName: true, tradeName: true } }),
      tx.documentVersion.findMany({
        where: { id: { in: docs.map((d) => d.currentVersionId).filter((x): x is string => !!x) } },
        select: { id: true, versionNo: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, extractedText: true, content: false },
      }),
    ]);
    // Saber si hay archivo sin traer los bytes.
    const withFile = new Set(
      versions.length
        ? (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM document_versions WHERE id = ANY(${versions.map((v) => v.id)}::uuid[]) AND content IS NOT NULL`).map((r) => r.id)
        : [],
    );
    const names = new Map<string, string>([
      ...products.map((p) => [p.id, p.name] as [string, string]),
      ...suppliers.map((s) => [s.id, s.legalName] as [string, string]),
      ...customers.map((c) => [c.id, c.tradeName ?? c.legalName] as [string, string]),
    ]);
    const byId = new Map(versions.map((v) => [v.id, v]));
    return docs.map((d) => {
      const v = d.currentVersionId ? byId.get(d.currentVersionId) : undefined;
      return {
        id: d.id,
        title: d.title,
        kind: d.kind,
        validUntil: day(d.validUntil),
        entityType: (d.entityType as DocumentEntity | null) ?? null,
        entityId: d.entityId,
        entityName: d.entityId ? (names.get(d.entityId) ?? null) : null,
        tags: d.tags,
        source: d.driveFile ? 'DRIVE' : 'UPLOAD',
        current: v
          ? {
              id: v.id,
              versionNo: v.versionNo,
              fileName: v.fileName,
              mimeType: v.mimeType,
              sizeBytes: v.sizeBytes,
              createdAt: v.createdAt.toISOString(),
              hasFile: withFile.has(v.id),
              searchable: !!v.extractedText,
            }
          : null,
        updatedAt: d.updatedAt.toISOString(),
      };
    });
  }
}
