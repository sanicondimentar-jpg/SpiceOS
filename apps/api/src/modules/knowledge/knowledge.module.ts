import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { IngestionService } from './ingestion.service';
import { KnowledgeConsumer } from './knowledge.consumer';
import { KnowledgeAiTools } from './knowledge.tools';
import { RetrievalService } from './retrieval.service';
import { VectorStore } from './vector.store';

@Module({
  providers: [EmbeddingsService, VectorStore, IngestionService, RetrievalService, KnowledgeConsumer, KnowledgeAiTools],
  exports: [IngestionService, RetrievalService],
})
export class KnowledgeModule {}
