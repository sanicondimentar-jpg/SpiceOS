# syntax=docker/dockerfile:1.7
FROM node:22.22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
# Next.js fija las variables NEXT_PUBLIC_* al compilar. En producción la API se sirve
# en el mismo dominio bajo /api, así que alcanza con una ruta relativa.
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm --filter "@spiceos/web..." build

FROM node:22.22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
