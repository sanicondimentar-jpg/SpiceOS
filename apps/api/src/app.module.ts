import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { SharedModule } from './shared/shared.module';
import { AiModule } from './shared/ai/ai.module';
import { AuthMiddleware } from './shared/auth/auth.middleware';
import { PermissionsGuard } from './shared/auth/permissions.guard';
import { DomainErrorFilter } from './shared/http/domain-error.filter';
import { CoreModule } from './modules/core/core.module';
import { CrmModule } from './modules/crm/crm.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SalesModule } from './modules/sales/sales.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { AutomationModule } from './modules/automation/automation.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ImportsModule } from './modules/imports/imports.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    ScheduleModule.forRoot(),
    SharedModule,
    AiModule,
    CoreModule,
    CrmModule,
    CatalogModule,
    SalesModule,
    OrdersModule,
    InventoryModule,
    ReceivablesModule,
    DocumentsModule,
    MessagingModule,
    KnowledgeModule,
    CopilotModule,
    AutomationModule,
    TasksModule,
    AnalyticsModule,
    ImportsModule,
    PurchasingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
