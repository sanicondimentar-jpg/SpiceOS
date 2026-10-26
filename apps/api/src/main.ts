import { startTelemetry } from './shared/observability/otel';
startTelemetry('spiceos-api');

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './shared/config/env';

async function bootstrap() {
  process.env.SPICEOS_PROCESS ??= 'api';
  const config = env();
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGINS.split(','), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // API First: el contrato OpenAPI se publica y de él se genera el cliente de la web.
  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('SpiceOS API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, openapi, { jsonDocumentUrl: 'api/openapi.json' });

  await app.listen(config.API_PORT);
}
void bootstrap();
