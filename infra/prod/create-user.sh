#!/usr/bin/env bash
# Crea (o actualiza) un usuario de SpiceOS en producción: usuario en Keycloak, miembro de la
# organización y con su rol en la base. Lo invoca el workflow "Deploy" con la opción "Crear usuario".
#   USER_EMAIL, USER_NAME, USER_ROLE (admin | gerente | vendedor | deposito | cobranzas)
# Si el usuario es nuevo se le pone una contraseña temporal que se muestra una sola vez en el log;
# en el primer ingreso Keycloak le pide cambiarla y configurar el authenticator.
# Si ya existía, solo se actualizan el nombre y el rol (la contraseña no se toca).
set -euo pipefail
cd "$(dirname "$0")"

: "${USER_EMAIL:?Falta el email}" "${USER_NAME:?Falta el nombre}" "${USER_ROLE:?Falta el rol}"
USER_EMAIL=$(printf '%s' "$USER_EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)
case "$USER_ROLE" in admin|gerente|vendedor|deposito|cobranzas) ;; *) echo "Rol inválido: $USER_ROLE"; exit 1 ;; esac
[[ "$USER_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "Email inválido: $USER_EMAIL"; exit 1; }

get_env() { grep -m1 "^$1=" .env | cut -d= -f2-; }
dc() { docker compose "$@"; }
kc() { dc exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

dc exec -T -e PW="$(get_env KEYCLOAK_ADMIN_PASSWORD)" keycloak bash -c \
  '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password "$PW"' >/dev/null

FIRST=${USER_NAME%% *}
LAST=${USER_NAME#"$FIRST"}; LAST=${LAST# }

USER_ID=$(kc get users -r spiceos -q email="$USER_EMAIL" -q exact=true --fields id --format csv --noquotes)
TEMP_PW=""
if [ -z "$USER_ID" ]; then
  echo "Creando usuario $USER_EMAIL en Keycloak"
  kc create users -r spiceos -s username="$USER_EMAIL" -s email="$USER_EMAIL" -s enabled=true \
    -s emailVerified=true -s firstName="$FIRST" -s lastName="$LAST" \
    -s 'requiredActions=["UPDATE_PASSWORD","CONFIGURE_TOTP"]'
  USER_ID=$(kc get users -r spiceos -q email="$USER_EMAIL" -q exact=true --fields id --format csv --noquotes)
  TEMP_PW="Spice-$(openssl rand -hex 4)-$(openssl rand -hex 4)"
  dc exec -T -e PW="$TEMP_PW" -e UID_="$USER_ID" keycloak bash -c \
    '/opt/keycloak/bin/kcadm.sh set-password -r spiceos --userid "$UID_" --new-password "$PW" --temporary'
else
  echo "El usuario $USER_EMAIL ya existe en Keycloak: se actualizan nombre y rol"
  kc update "users/$USER_ID" -r spiceos -s firstName="$FIRST" -s lastName="$LAST"
fi

ORG_ID=$(kc get organizations -r spiceos --fields id,alias --format csv --noquotes | awk -F, '$2 == "sani-condimentar" { print $1 }')
[ -n "$ORG_ID" ] || { echo "No existe la organización sani-condimentar en Keycloak"; exit 1; }
kc create "organizations/$ORG_ID/members" -r spiceos -b "\"$USER_ID\"" >/dev/null 2>&1 || true # ya era miembro

# Base de datos: con el usuario dueño (no sujeto a RLS). Los valores van como variables de psql.
dc exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$(get_env POSTGRES_USER)" -d "$(get_env POSTGRES_DB)" \
  -v kid="$USER_ID" -v email="$USER_EMAIL" -v name="$USER_NAME" -v role="$USER_ROLE" <<'SQL'
INSERT INTO users (id, keycloak_id, email, full_name, updated_at)
VALUES (gen_random_uuid(), :'kid', :'email', :'name', now())
ON CONFLICT (email) DO UPDATE SET keycloak_id = EXCLUDED.keycloak_id, full_name = EXCLUDED.full_name,
  is_active = true, updated_at = now();

INSERT INTO memberships (id, tenant_id, user_id, role_id)
SELECT gen_random_uuid(), c.id, u.id, r.id
FROM companies c
JOIN roles r ON r.tenant_id = c.id AND r.key = :'role'
JOIN users u ON u.email = :'email'
WHERE c.keycloak_org_id = 'sani-condimentar'
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true;

SELECT u.email, u.full_name, r.name AS rol
FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
WHERE u.email = :'email';
SQL

if [ -n "$TEMP_PW" ]; then
  printf '\n==> Usuario creado. Entrar en https://%s con:\n    Usuario: %s\n    Contraseña temporal: %s\n' \
    "$(get_env APP_DOMAIN)" "$USER_EMAIL" "$TEMP_PW"
  printf '    En el primer ingreso pide elegir una contraseña nueva y configurar el authenticator.\n'
fi
