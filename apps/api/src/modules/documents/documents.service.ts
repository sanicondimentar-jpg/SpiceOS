import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentKind } from '@prisma/client';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { RequestContextStore } from '../../shared/tenancy/request-context';

class DocEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

export interface NewVersionInput {
  documentId?: string;
  title: string;
  kind: DocumentKind;
  mimeType: string;
  content: Buffer;
  extractedText: string | null;
  storageKey?: string;
  driveRevisionId?: string;
  entityType?: string;
  entityId?: string;
  validUntil?: Date;
}

/** Versionado documental: cada cambio de contenido crea una versión nueva; la anterior queda en el historial. */
@Injectable()
export class DocumentsService {
  constructor(private readonly uow: UnitOfWork) {}

  addVersion(input: NewVersionInput): Promise<{ documentId: string; versionId: string; versionNo: number } | null> {
    const ctx = RequestContextStore.get();
    const checksum = createHash('sha256').update(input.content).digest('hex');
    return this.uow.run(async (tx, scope) => {
      const documentId = input.documentId ?? randomUUID();
      const doc = await tx.document.upsert({
        where: { id: documentId },
        create: {
          id: documentId,
          tenantId: ctx.tenantId,
          title: input.title,
          kind: input.kind,
          entityType: input.entityType,
          entityId: input.entityId,
          validUntil: input.validUntil,
        },
        update: { title: input.title },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      });
      const last = doc.versions[0];
      if (last?.checksum === checksum) return null; // sin cambios de contenido

      const versionNo = (last?.versionNo ?? 0) + 1;
      const version = await tx.documentVersion.create({
        data: {
          tenantId: ctx.tenantId,
          documentId,
          versionNo,
          storageKey: input.storageKey,
          driveRevisionId: input.driveRevisionId,
          mimeType: input.mimeType,
          checksum,
          extractedText: input.extractedText,
          createdBy: ctx.actor,
        },
      });
      await tx.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });
      const events = new DocEvents();
      events.emit(new DomainEvent('document.version_created', 'document', documentId, { documentId, versionId: version.id, versionNo }));
      scope.track(events);
      scope.auditLog({ action: 'document.version', entityType: 'document', entityId: documentId, after: { versionNo, checksum } });
      return { documentId, versionId: version.id, versionNo };
    });
  }
}
