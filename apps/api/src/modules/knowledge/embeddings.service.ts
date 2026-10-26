import { Injectable } from '@nestjs/common';
import { env } from '../../shared/config/env';

/**
 * Embeddings vía Voyage AI (recomendado para Claude). Detrás de este puerto se puede
 * poner un modelo autoalojado si la empresa exige que nada salga de su infraestructura.
 */
@Injectable()
export class EmbeddingsService {
  readonly model = env().EMBEDDINGS_MODEL;
  readonly dimensions = env().EMBEDDINGS_DIM;

  async embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env().VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts.slice(i, i + 64), model: this.model, input_type: inputType }),
      });
      if (!res.ok) throw new Error(`Embeddings: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}
