import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { chunkText } from './chunker';
import { EmbeddingsService } from './embeddings.service';
import { VectorStore } from './vector.store';

export interface KnowledgeInput {
  type: 'drive' | 'document' | 'whatsapp' | 'crm' | 'product' | 'order' | 'manual';
  refId: string;
  title: string;
  text: string;
  roles?: string[];
  versionId?: string;
  metadata?: Record<string, unknown>;
}

/** Documento → extracción (ya hecha) → chunks → embeddings → Qdrant + registro en PostgreSQL. */
@Injectable()
export class IngestionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: VectorStore,
  ) {}

  async ingest(input: KnowledgeInput): Promise<{ chunks: number; skipped: boolean }> {
    const { tenantId } = RequestContextStore.get();
    const hash = createHash('sha256').update(input.text).digest('hex');
    const roles = input.roles ?? [];

    const source = await this.uow.run(async (tx) => {
      const existing = await tx.knowledgeSource.findUnique({
        where: { tenantId_type_refId: { tenantId, type: input.type, refId: input.refId } },
      });
      if (existing?.hash === hash && existing.status === 'INDEXED') return null;
      return tx.knowledgeSource.upsert({
        where: { tenantId_type_refId: { tenantId, type: input.type, refId: input.refId } },
        create: { tenantId, type: input.type, refId: input.refId, title: input.title, hash, acl: { roles }, status: 'INDEXING' },
        update: { title: input.title, hash, acl: { roles }, status: 'INDEXING' },
      });
    });
    if (!source) return { chunks: 0, skipped: true };

    const chunks = chunkText(input.text, 500, 60, `${input.title}`);
    const vectors = await this.embeddings.embed(chunks.map((c) => c.content), 'document');

    await this.vectors.deleteBySource(tenantId, source.id);
    const rows = chunks.map((c) => ({ id: randomUUID(), ...c }));
    await this.vectors.upsert(
      rows.map((c, i) => ({
        id: c.id,
        vector: vectors[i],
        payload: {
          tenant_id: tenantId,
          source_id: source.id,
          source_type: input.type,
          ref_id: input.refId,
          title: input.title,
          roles,
          content: c.content,
          metadata: { ordinal: c.ordinal, ...(input.metadata ?? {}) },
        },
      })),
    );

    await this.uow.run(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });
      await tx.knowledgeChunk.createMany({
        data: rows.map((c) => ({
          id: c.id,
          tenantId,
          sourceId: source.id,
          versionId: input.versionId,
          ordinal: c.ordinal,
          content: c.content,
          tokenCount: c.tokenCount,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          embeddingModel: this.embeddings.model,
        })),
      });
      await tx.knowledgeSource.update({ where: { id: source.id }, data: { status: 'INDEXED', indexedAt: new Date() } });
      if (input.versionId) await tx.documentVersion.update({ where: { id: input.versionId }, data: { indexedAt: new Date() } });
    });
    return { chunks: rows.length, skipped: false };
  }
}
