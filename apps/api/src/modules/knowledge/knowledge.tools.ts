import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { RetrievalService } from './retrieval.service';

@Injectable()
export class KnowledgeAiTools {
  constructor(private readonly retrieval: RetrievalService) {}

  @AiTool({
    name: 'knowledge_search',
    description:
      'Busca en el conocimiento de la empresa (fichas técnicas, certificados, análisis de laboratorio, manuales, catálogos, documentos de Google Drive). Usala para preguntas sobre especificaciones, alérgenos, vencimientos de certificados, procedimientos o políticas. Citá el título de cada fuente que uses.',
    input: z.object({
      query: z.string().describe('Pregunta o términos de búsqueda en español'),
      sourceTypes: z.array(z.enum(['drive', 'document', 'whatsapp', 'crm', 'product', 'manual'])).optional(),
      limit: z.number().int().min(1).max(15).default(8),
    }),
    permissions: [PERMISSIONS.documents.read],
  })
  search({ query, sourceTypes, limit }: { query: string; sourceTypes?: string[]; limit: number }) {
    return this.retrieval.search(query, limit, sourceTypes);
  }
}
