# Producción

SpiceOS corre en un único servidor con Docker Compose. Caddy atiende HTTPS (certificados de Let's Encrypt automáticos) y reparte:

- `https://APP_DOMAIN` → la web; `https://APP_DOMAIN/api/*` → la API.
- `https://AUTH_DOMAIN` → Keycloak (login con segundo factor).

Postgres, Redis, RabbitMQ y Qdrant no publican puertos. MinIO no se instala todavía: la API aún no guarda archivos. La base se copia todos los días en `/opt/spiceos/infra/prod/backups` (14 días). El stack de observabilidad (Grafana, Prometheus, Loki, Tempo) no se instala acá para no gastar memoria.

## Puesta en marcha (una sola vez)

1. **Clave de despliegue.** En tu computadora:
   `ssh-keygen -t ed25519 -f spiceos-deploy -N "" -C spiceos-deploy`
   Genera `spiceos-deploy` (privada) y `spiceos-deploy.pub` (pública).
2. **Servidor.** Ubuntu 24.04, mínimo 2 vCPU / 4 GB (por ejemplo DigitalOcean Basic de 4 GB); se agranda cuando haga falta. Al crearlo:
   cargar `spiceos-deploy.pub` como clave SSH, pegar el contenido de `cloud-init.yml` en *Cloud config* y activar los backups del proveedor.
3. **DNS.** Dos registros `A` hacia la IP del servidor: `APP_DOMAIN` y `AUTH_DOMAIN` (por ejemplo `sistema.saboracasa.com.ar` y `auth.saboracasa.com.ar`).
4. **GitHub → Settings → Secrets and variables → Actions.**
   - *Variables*: `SSH_HOST` (IP del servidor), `APP_DOMAIN`, `AUTH_DOMAIN`, `ADMIN_EMAIL` (el mail con el que vas a entrar), `COMPANY_CUIT`.
   - *Secrets*: `SSH_PRIVATE_KEY` (contenido de `spiceos-deploy`), `ADMIN_INITIAL_PASSWORD` (contraseña provisoria del primer ingreso) y, si querés el copiloto, `ANTHROPIC_API_KEY` y `VOYAGE_API_KEY`.
5. **Actions → Deploy → Run workflow.** Al terminar, entrar a `https://APP_DOMAIN` con `ADMIN_EMAIL` y la contraseña provisoria: Keycloak pide cambiarla y configurar el código de verificación (Google Authenticator o similar).

Desde ahí cada merge a `main` que pase CI se despliega solo.

## Qué hace `deploy.sh`

1. La primera vez genera `.env` con contraseñas aleatorias. Ese archivo vive solo en el servidor (`/opt/spiceos/infra/prod/.env`, permisos 600); las contraseñas no pasan por GitHub.
2. Descarga las imágenes del commit, levanta las bases y corre las migraciones.
3. Reemplaza las contraseñas de desarrollo de los usuarios `spiceos_app` y `spiceos_system` de Postgres.
4. Configura Keycloak: URLs del cliente web, organización `sani-condimentar` y usuario administrador.
5. Carga los datos base de la empresa (roles, impuestos, depósito, embudo) **sin** productos de ejemplo.
6. Levanta API, worker, scheduler, web, Caddy y backups, y verifica `https://APP_DOMAIN/api/v1/health`.

Se puede volver a correr sin riesgo: no pisa datos ni contraseñas existentes.

## Operación

```bash
ssh root@SERVIDOR
cd /opt/spiceos/infra/prod
docker compose ps                     # estado
docker compose logs -f api            # logs
grep KEYCLOAK_ADMIN_PASSWORD .env     # consola de Keycloak: https://AUTH_DOMAIN/admin
# restaurar la base desde un backup
docker compose exec -T postgres pg_restore -U spiceos -d spiceos --clean < backups/spiceos-AAAAMMDD-HHMM.dump
```
