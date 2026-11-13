#!/usr/bin/env bash
# Vigila la API: si deja de responder 3 minutos seguidos, reinicia api, worker y scheduler.
# Pasó del 5/11 al 10/11 de 2026: la API quedó colgada ("unhealthy") y Docker no la reinicia sola;
# mientras tanto la web no pudo registrar pedidos. deploy.sh lo instala en cron (cada minuto).
set -uo pipefail
cd "$(dirname "$0")"

STATE=/var/lib/spiceos-watchdog.fails
LOG=/var/log/spiceos-watchdog.log
MAX_FAILS=3

id=$(docker compose ps -q api 2>/dev/null)
[ -n "$id" ] || exit 0 # sin API levantada (por ejemplo, en pleno despliegue): nada que vigilar

# Recién arrancada: le damos 5 minutos antes de juzgarla.
started=$(docker inspect -f '{{.State.StartedAt}}' "$id" 2>/dev/null)
if [ -n "$started" ] && [ $(( $(date +%s) - $(date -d "$started" +%s) )) -lt 300 ]; then
  echo 0 > "$STATE"; exit 0
fi

if timeout 20 docker compose exec -T api wget -qO- -T 10 http://localhost:4000/api/v1/health >/dev/null 2>&1; then
  echo 0 > "$STATE"; exit 0
fi

fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$STATE"
echo "$(date -Is) la API no responde ($fails/$MAX_FAILS)" >> "$LOG"
if [ "$fails" -ge "$MAX_FAILS" ]; then
  echo "$(date -Is) reiniciando api, worker y scheduler" >> "$LOG"
  docker compose restart api worker scheduler >> "$LOG" 2>&1
  echo 0 > "$STATE"
fi
