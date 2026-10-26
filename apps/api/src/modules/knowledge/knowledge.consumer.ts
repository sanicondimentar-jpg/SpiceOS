import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { UnitOfWork } from '../../shared/unit-of-work';
import { isWorker } from '../../shared/process-role';
import { IngestionService } from './ingestion.service';

/** Mantiene el índice de conocimiento al día a partir de eventos de todos los módulos. */
@Injectable()
export class KnowledgeConsumer implements OnApplicationBootstrap {
  constructor(
    private readonly bus: EventBusService,
    private readonly uow: UnitOfWork,
    private readonly ingestion: IngestionService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('knowledge.ingestion', ['document.version_created'], async (event) => {
      const { versionId } = event.payload as { versionId: string };
      const version = await this.uow.read((tx) =>
        tx.documentVersion.findUniqueOrThrow({ where: { id: versionId }, include: { document: true } }),
      );
      if (!version.extractedText) return;
      const doc = version.document;
      await this.ingestion.ingest({
        type: 'document',
        refId: doc.id,
        title: doc.title,
        text: version.extractedText,
        roles: doc.visibility === 'ROLE_RESTRICTED' ? doc.allowedRoles : [],
        versionId: version.id,
        metadata: { kind: doc.kind, entityType: doc.entityType, entityId: doc.entityId, version: version.versionNo },
      });
    });
  }
}
