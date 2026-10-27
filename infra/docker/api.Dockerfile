# syntax=docker/dockerfile:1.7
FROM node:22.22-alpine AS base
# Prisma necesita OpenSSL en Alpine.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
# "@spiceos/api..." construye también los paquetes del workspace de los que depende (contracts).
# El cliente de Prisma se genera dentro de /out porque deploy instala un @prisma/client nuevo.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @spiceos/api exec prisma generate \
 && pnpm --filter "@spiceos/api..." build \
 && pnpm --filter @spiceos/api deploy --legacy --prod /out \
 && cd /out && /repo/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out .
USER app
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
