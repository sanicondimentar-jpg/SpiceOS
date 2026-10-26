# syntax=docker/dockerfile:1.7
FROM node:22.12-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @spiceos/api exec prisma generate \
 && pnpm --filter @spiceos/api build \
 && pnpm --filter @spiceos/api deploy --prod /out \
 && cp -r apps/api/dist /out/dist && cp -r apps/api/prisma /out/prisma \
 && cp -r apps/api/node_modules/.prisma /out/node_modules/.prisma

FROM node:22.12-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out .
USER app
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
