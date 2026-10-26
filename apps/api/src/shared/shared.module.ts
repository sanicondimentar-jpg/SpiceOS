import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { EventBusService } from './messaging/event-bus.service';
import { EncryptionService } from './crypto/encryption.service';
import { AuthMiddleware } from './auth/auth.middleware';
import { HealthController } from './http/health.controller';
import { UnitOfWork } from './unit-of-work';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [AuditService, OutboxService, OutboxRelayService, EventBusService, EncryptionService, AuthMiddleware, UnitOfWork],
  exports: [AuditService, OutboxService, EventBusService, EncryptionService, AuthMiddleware, UnitOfWork],
})
export class SharedModule {}
