import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AiToolRegistry } from './ai-tool.registry';
import { LlmService } from './llm.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [AiToolRegistry, LlmService],
  exports: [AiToolRegistry, LlmService],
})
export class AiModule {}
