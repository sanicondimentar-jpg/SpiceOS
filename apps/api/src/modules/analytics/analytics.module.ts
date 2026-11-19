import { Module } from '@nestjs/common';
import { AnalyticsAiTools, AnalyticsController } from './analytics.controller';
import { ExecutiveService } from './executive.service';
import { InsightsService } from './insights.service';

@Module({
  controllers: [AnalyticsController],
  providers: [ExecutiveService, InsightsService, AnalyticsAiTools],
})
export class AnalyticsModule {}
