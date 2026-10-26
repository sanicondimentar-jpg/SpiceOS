import { Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { EmbeddingsService } from './embeddings.service';
import { VectorStore } from './vector.store';

export interface RetrievedChunk {
  score: number;
  title: string;
  sourceType: string;
  refId: string;
  content: string;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: VectorStore,
  ) {}

  /** Búsqueda semántica con filtro obligatorio de empresa y rol; deduplica por fuente. */
  async search(query: string, limit = 8, sourceTypes?: string[]): Promise<RetrievedChunk[]> {
    const { tenantId, roleKey } = RequestContextStore.get();
    const [vector] = await this.embeddings.embed([query], 'query');
    const hits = await this.vectors.search(tenantId, roleKey, vector, limit * 3, sourceTypes);
    const perSource = new Map<string, number>();
    return hits
      .filter((h) => {
        const n = perSource.get(h.source_id) ?? 0;
        perSource.set(h.source_id, n + 1);
        return n < 3; // como mucho 3 fragmentos por documento
      })
      .slice(0, limit)
      .map((h) => ({ score: h.score, title: h.title, sourceType: h.source_type, refId: h.ref_id, content: h.content }));
  }
}
