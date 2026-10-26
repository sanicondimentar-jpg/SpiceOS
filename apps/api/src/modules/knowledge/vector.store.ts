import { Injectable, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../shared/config/env';

export const KNOWLEDGE_COLLECTION = 'spiceos_knowledge';

export interface ChunkPayload {
  tenant_id: string;
  source_id: string;
  source_type: string;
  ref_id: string;
  title: string;
  roles: string[]; // vacío = visible para todos los roles de la empresa
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Una colección con índice por tenant_id (patrón multitenant recomendado por Qdrant).
 * Toda búsqueda lleva filtro obligatorio de empresa y de roles.
 */
@Injectable()
export class VectorStore implements OnModuleInit {
  private readonly client = new QdrantClient({ url: env().QDRANT_URL, checkCompatibility: false });

  async onModuleInit() {
    const { exists } = await this.client.collectionExists(KNOWLEDGE_COLLECTION).catch(() => ({ exists: true }));
    if (exists) return;
    await this.client.createCollection(KNOWLEDGE_COLLECTION, {
      vectors: { size: env().EMBEDDINGS_DIM, distance: 'Cosine' },
      hnsw_config: { payload_m: 16, m: 0 }, // grafo por tenant
    });
    await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, { field_name: 'tenant_id', field_schema: { type: 'keyword', is_tenant: true } });
    await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, { field_name: 'source_type', field_schema: 'keyword' });
    await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, { field_name: 'source_id', field_schema: 'keyword' });
    await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, { field_name: 'roles', field_schema: 'keyword' });
  }

  async upsert(points: { id: string; vector: number[]; payload: ChunkPayload }[]) {
    for (let i = 0; i < points.length; i += 128) {
      await this.client.upsert(KNOWLEDGE_COLLECTION, { wait: true, points: points.slice(i, i + 128) as never });
    }
  }

  async deleteBySource(tenantId: string, sourceId: string) {
    await this.client.delete(KNOWLEDGE_COLLECTION, {
      wait: true,
      filter: { must: [{ key: 'tenant_id', match: { value: tenantId } }, { key: 'source_id', match: { value: sourceId } }] },
    });
  }

  async search(
    tenantId: string,
    role: string,
    vector: number[],
    limit: number,
    sourceTypes?: string[],
  ): Promise<(ChunkPayload & { score: number })[]> {
    const must: Record<string, unknown>[] = [{ key: 'tenant_id', match: { value: tenantId } }];
    if (sourceTypes?.length) must.push({ key: 'source_type', match: { any: sourceTypes } });
    const res = await this.client.query(KNOWLEDGE_COLLECTION, {
      query: vector,
      limit,
      with_payload: true,
      score_threshold: 0.35,
      filter: {
        must,
        should: [{ is_empty: { key: 'roles' } }, { key: 'roles', match: { any: [role] } }],
      } as never,
    });
    return res.points.map((r) => ({ score: r.score, ...(r.payload as unknown as ChunkPayload) }));
  }
}
