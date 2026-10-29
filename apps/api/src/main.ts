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
  // Detrás de Caddy: la IP real del cliente viene en X-Forwarded-For (la usa el límite de pedidos).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // /public/* lo usa la web saboracasa desde otro dominio y sin credenciales; el resto, solo la app.
  const origins = config.CORS_ORIGINS.split(',');
  app.enableCors((req: { url?: string }, cb: (err: Error | null, options: { origin: boolean | string[]; credentials: boolean }) => void) =>
    cb(null, req.url?.startsWith('/api/v1/public/') ? { origin: true, credentials: false } : { origin: origins, credentials: true }),
  );
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
