import { startTelemetry } from './shared/observability/otel';
startTelemetry('spiceos-scheduler');

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/** Proceso scheduler (una sola réplica): reglas por horario y sincronización de Google Drive. */
async function bootstrap() {
  process.env.SPICEOS_PROCESS = 'scheduler';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}
void bootstrap();
