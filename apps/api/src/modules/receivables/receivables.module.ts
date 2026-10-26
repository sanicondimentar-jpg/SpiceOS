import { Module } from '@nestjs/common';
import { ReceivablesAiTools } from './receivables.tools';

@Module({ providers: [ReceivablesAiTools] })
export class ReceivablesModule {}
