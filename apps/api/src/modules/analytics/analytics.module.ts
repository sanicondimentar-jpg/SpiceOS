import { Module } from '@nestjs/common';
import { AnalyticsAiTools, AnalyticsController } from './analytics.controller';
import { ExecutiveService } from './executive.service';

@Module({
  controllers: [AnalyticsController],
  providers: [ExecutiveService, AnalyticsAiTools],
})
export class AnalyticsModule {}
