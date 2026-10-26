import { startTelemetry } from './shared/observability/otel';
startTelemetry('spiceos-worker');

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/** Proceso worker: consumidores de RabbitMQ (reglas, IA, ingesta RAG, proyecciones) y relay del outbox. */
async function bootstrap() {
  process.env.SPICEOS_PROCESS = 'worker';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}
void bootstrap();
