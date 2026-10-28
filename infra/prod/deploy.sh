#!/usr/bin/env bash
# Despliega (o actualiza) SpiceOS en este servidor. Es idempotente: se puede correr las veces que haga falta.
# Lo invoca el workflow "Deploy" de GitHub Actions con estas variables:
#   IMAGE_PREFIX, IMAGE_TAG, APP_DOMAIN, AUTH_DOMAIN, ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD
#   y opcionales ANTHROPIC_API_KEY, VOYAGE_API_KEY, COMPANY_CUIT.
set -euo pipefail
cd "$(dirname "$0")"

: "${IMAGE_PREFIX:?}" "${IMAGE_TAG:?}" "${APP_DOMAIN:?}" "${AUTH_DOMAIN:?}" "${ADMIN_EMAIL:?}"

log() { printf '\n==> %s\n' "$*"; }
rand() { openssl rand -hex 24; }

# Escribe CLAVE=valor en .env, reemplazando la línea si ya existe.
set_env() {
  local key=$1 value=$2
  touch .env
  KEY="$key" VALUE="$value" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' .env > .env.tmp && mv .env.tmp .env
}
get_env() { grep -m1 "^$1=" .env | cut -d= -f2-; }

# --- 1. Secretos: se generan una sola vez en el servidor y nunca salen de acá ---
if [ ! -f .env ]; then
  log "Generando secretos (.env)"
  umask 077
  PG=$(rand); APP=$(rand); SYS=$(rand); RMQ=$(rand)
  cat > .env <<ENV
NODE_ENV=production
POSTGRES_USER=spiceos
POSTGRES_PASSWORD=$PG
POSTGRES_DB=spiceos
DATABASE_URL=postgresql://spiceos_app:$APP@postgres:5432/spiceos
MIGRATION_DATABASE_URL=postgresql://spiceos:$PG@postgres:5432/spiceos
SYSTEM_DATABASE_URL=postgresql://spiceos_system:$SYS@postgres:5432/spiceos
SPICEOS_APP_DB_PASSWORD=$APP
SPICEOS_SYSTEM_DB_PASSWORD=$SYS
REDIS_URL=redis://redis:6379
RABBITMQ_DEFAULT_USER=spiceos
RABBITMQ_DEFAULT_PASS=$RMQ
RABBITMQ_URL=amqp://spiceos:$RMQ@rabbitmq:5672
QDRANT_URL=http://qdrant:6333
S3_ENDPOINT=http://minio:9000
S3_BUCKET=spiceos
S3_ACCESS_KEY=spiceos
S3_SECRET_KEY=$(rand)
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$(rand)
KEYCLOAK_AUDIENCE=spiceos-api
KEYCLOAK_WEB_CLIENT_ID=spiceos-web
KEYCLOAK_WEB_CLIENT_SECRET=$(rand)
NEXTAUTH_SECRET=$(openssl rand -base64 32)
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
AI_MODEL=claude-opus-5-5
EMBEDDINGS_PROVIDER=voyage
EMBEDDINGS_MODEL=voyage-3.5
EMBEDDINGS_DIM=1024
API_PORT=4000
ENV
fi

# Valores que vienen del workflow: se actualizan en cada despliegue.
set_env IMAGE_PREFIX "$IMAGE_PREFIX"
set_env IMAGE_TAG "$IMAGE_TAG"
set_env APP_DOMAIN "$APP_DOMAIN"
set_env AUTH_DOMAIN "$AUTH_DOMAIN"
set_env KEYCLOAK_ISSUER "https://$AUTH_DOMAIN/realms/spiceos"
set_env NEXTAUTH_URL "https://$APP_DOMAIN"
set_env CORS_ORIGINS "https://$APP_DOMAIN"
set_env GOOGLE_REDIRECT_URI "https://$APP_DOMAIN/api/v1/integrations/google-drive/callback"
[ -n "${ANTHROPIC_API_KEY:-}" ] && set_env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
[ -n "${VOYAGE_API_KEY:-}" ] && set_env VOYAGE_API_KEY "$VOYAGE_API_KEY"
chmod 600 .env
mkdir -p backups

dc() { docker compose "$@"; }

log "Descargando imágenes $IMAGE_TAG"
dc --profile tools pull --quiet

log "Levantando servicios de base"
dc up -d --wait postgres redis rabbitmq qdrant

log "Migraciones"
dc --profile tools run --rm -e DATABASE_URL="$(get_env MIGRATION_DATABASE_URL)" tools \
  ./node_modules/.bin/prisma migrate deploy

# La migración de RLS crea los usuarios de la app con contraseñas de desarrollo; acá se reemplazan.
dc exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$(get_env POSTGRES_USER)" -d "$(get_env POSTGRES_DB)" \
  -c "ALTER ROLE spiceos_app PASSWORD '$(get_env SPICEOS_APP_DB_PASSWORD)'" \
  -c "ALTER ROLE spiceos_system PASSWORD '$(get_env SPICEOS_SYSTEM_DB_PASSWORD)'"

log "Keycloak"
dc up -d keycloak caddy
kc() { dc exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }
for i in $(seq 1 60); do
  if dc exec -T -e PW="$(get_env KEYCLOAK_ADMIN_PASSWORD)" keycloak bash -c \
    '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password "$PW"' >/dev/null 2>&1; then
    break
  fi
  [ "$i" = 60 ] && { echo "Keycloak no respondió"; exit 1; }
  sleep 5
done

CLIENT_ID=$(kc get clients -r spiceos -q clientId=spiceos-web --fields id --format csv --noquotes)
kc update "clients/$CLIENT_ID" -r spiceos \
  -s "redirectUris=[\"https://$APP_DOMAIN/*\"]" \
  -s "webOrigins=[\"https://$APP_DOMAIN\"]" \
  -s "secret=$(get_env KEYCLOAK_WEB_CLIENT_SECRET)"

ORG_ALIAS=sani-condimentar
ORG_ID=$(kc get organizations -r spiceos --fields id,alias --format csv --noquotes | awk -F, -v a="$ORG_ALIAS" '$2 == a { print $1 }')
if [ -z "$ORG_ID" ]; then
  kc create organizations -r spiceos -s name="Sani Condimentar" -s alias="$ORG_ALIAS" -s enabled=true \
    -s "domains=[{\"name\":\"${APP_DOMAIN#*.}\"}]"
  ORG_ID=$(kc get organizations -r spiceos --fields id,alias --format csv --noquotes | awk -F, -v a="$ORG_ALIAS" '$2 == a { print $1 }')
fi

USER_ID=$(kc get users -r spiceos -q email="$ADMIN_EMAIL" -q exact=true --fields id --format csv --noquotes)
if [ -z "$USER_ID" ]; then
  : "${ADMIN_INITIAL_PASSWORD:?Falta ADMIN_INITIAL_PASSWORD para crear el primer usuario}"
  log "Creando usuario administrador $ADMIN_EMAIL"
  kc create users -r spiceos -s username="$ADMIN_EMAIL" -s email="$ADMIN_EMAIL" -s enabled=true \
    -s emailVerified=true -s 'requiredActions=["UPDATE_PASSWORD","CONFIGURE_TOTP"]'
  USER_ID=$(kc get users -r spiceos -q email="$ADMIN_EMAIL" -q exact=true --fields id --format csv --noquotes)
  dc exec -T -e PW="$ADMIN_INITIAL_PASSWORD" -e UID_="$USER_ID" keycloak bash -c \
    '/opt/keycloak/bin/kcadm.sh set-password -r spiceos --userid "$UID_" --new-password "$PW" --temporary'
fi
kc create "organizations/$ORG_ID/members" -r spiceos -b "\"$USER_ID\"" >/dev/null 2>&1 || true # ya era miembro

log "Datos iniciales (empresa, roles, impuestos, depósito; sin productos de ejemplo)"
dc --profile tools run --rm \
  -e SEED_DEMO_DATA=false \
  -e SEED_KEYCLOAK_ORG_ID="$ORG_ALIAS" \
  -e SEED_ADMIN_KEYCLOAK_ID="$USER_ID" \
  -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e SEED_COMPANY_CUIT="${COMPANY_CUIT:-30-00000000-0}" \
  tools ./node_modules/.bin/ts-node --transpile-only prisma/seed.ts

log "Aplicación"
dc up -d --remove-orphans api worker scheduler web caddy backup
# rsync reemplaza el Caddyfile por un archivo nuevo y el contenedor sigue viendo el viejo: hay que reiniciarlo.
dc restart caddy

for i in $(seq 1 30); do
  if curl -fsS "https://$APP_DOMAIN/api/v1/health" >/dev/null 2>&1; then
    log "Listo: https://$APP_DOMAIN"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 10
done
echo "La API no respondió en https://$APP_DOMAIN/api/v1/health. Revisar: docker compose logs api caddy"
exit 1
