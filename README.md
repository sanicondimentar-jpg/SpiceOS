# SpiceOS

Plataforma empresarial inteligente para distribuidoras de especias, condimentos e ingredientes alimenticios: CRM, ventas, productos, pedidos, inventario con lotes, compras, logística, cobranza, documentos, WhatsApp, conocimiento empresarial e IA en un solo sistema.

## Arquitectura en una línea

Monolito modular NestJS (DDD + Clean Architecture + CQRS) desplegado como tres procesos (`api`, `worker`, `scheduler`), eventos de dominio por outbox → RabbitMQ, PostgreSQL con Row Level Security por empresa, Qdrant para RAG, Keycloak para identidad y un copiloto que solo actúa mediante tools tipadas y auditadas. Ver `docs/adr/`.

## Estructura

```
apps/api        NestJS: módulos de negocio, copiloto, integraciones (Prisma en apps/api/prisma)
apps/web        Next.js App Router + Tailwind + componentes shadcn + TanStack Query
packages/contracts  Esquemas zod, permisos y catálogo de eventos compartidos
infra/          Docker Compose, Dockerfiles, Keycloak, observabilidad (OTel, Prometheus, Loki, Tempo, Grafana)
docs/adr        Decisiones de arquitectura
```

## Puesta en marcha local

Requisitos: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env            # completar claves: DATA_ENCRYPTION_KEY, ANTHROPIC_API_KEY, VOYAGE_API_KEY...
openssl rand -base64 32         # valor para DATA_ENCRYPTION_KEY
pnpm install
pnpm infra:up                   # Postgres, Redis, RabbitMQ, Qdrant, MinIO, Keycloak, observabilidad
pnpm --filter @spiceos/contracts build
pnpm --filter @spiceos/api exec prisma generate
DATABASE_URL=$MIGRATION_DATABASE_URL pnpm db:migrate   # migraciones + políticas RLS (usuario dueño)
pnpm db:seed                    # empresa demo, roles, catálogo, embudo y reglas de ejemplo
pnpm --filter @spiceos/api dev            # API en :4000 (OpenAPI en /api/docs)
pnpm --filter @spiceos/api dev:worker     # consumidores + relay del outbox
pnpm --filter @spiceos/api dev:scheduler  # reglas por horario + sync de Google Drive
pnpm --filter @spiceos/web dev            # web en :3000
```

En Keycloak (http://localhost:8080) crear la organización de la empresa, asignarle el usuario y poner su id en `SEED_KEYCLOAK_ORG_ID` antes del seed. El realm `spiceos` ya exige TOTP en el primer ingreso.

## Calidad

```bash
pnpm --filter @spiceos/api typecheck
pnpm --filter @spiceos/api test     # política de precios, FEFO, motor de reglas, chunking
pnpm build
```

## Copiloto: agregar una capacidad

```ts
@AiTool({
  name: 'inventory_expiring_lots',
  description: 'Lotes con stock que vencen dentro de N días…',
  input: z.object({ days: z.number().int().default(60) }),
  permissions: [PERMISSIONS.inventory.read],
  agents: ['inventory', 'commercial'],
})
expiringLots({ days }) { … }
```

El registro la descubre al arrancar, la filtra por permisos del usuario y la expone al modelo. Las escrituras quedan auditadas como `agent:<nombre>` en nombre del usuario.
