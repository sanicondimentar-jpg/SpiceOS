import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  SYSTEM_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string(),
  QDRANT_URL: z.string().url(),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().default('spiceos-api'),
  DATA_ENCRYPTION_KEY: z.string().min(40, 'DATA_ENCRYPTION_KEY: 32 bytes en base64'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  VOYAGE_API_KEY: z.string().optional(),
  EMBEDDINGS_MODEL: z.string().default('voyage-3.5'),
  EMBEDDINGS_DIM: z.coerce.number().default(1024),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default('v21.0'),
  STT_URL: z.string().url().optional(), // servicio de voz a texto autoalojado (faster-whisper)
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida el entorno una sola vez; el proceso no arranca con configuración inválida. */
export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
