#!/usr/bin/env python3
"""Duración de la sesión y frecuencia del segundo factor en Keycloak. Lo llama deploy.sh; es idempotente.

- La sesión de la web se cierra tras 2 horas sin uso (sesión del cliente spiceos-web en Keycloak).
- El inicio de sesión usa niveles de autenticación (LoA) de Keycloak:
    nivel 2, contraseña: vigencia 0, así que se pide en cada ingreso (también después de cerrar sesión).
    nivel 1, código del authenticator: se pide la primera vez y después cada 7 días.
  El cliente spiceos-web pide siempre el nivel 2. La contraseña es el nivel alto a propósito: como su
  vigencia es 0 nunca queda guardada, y la cookie de Keycloak sola no alcanza para entrar.
- Para que el navegador recuerde esa sesión, la sesión de Keycloak dura 7 días ("Recordarme" activado).
"""
import json
import subprocess
import sys

REALM = "spiceos"
CLIENT = "spiceos-web"
FLOW = "spiceos-navegador"
APP_IDLE = 2 * 3600
PASSWORD_MAX_AGE = 0
OTP_MAX_AGE = 7 * 24 * 3600
SSO_SESSION = 7 * 24 * 3600

# (flujo padre, paso, requisito, nivel y vigencia en segundos si es una condición de nivel)
STEPS = [
    (FLOW, {"provider": "auth-cookie"}, "ALTERNATIVE", None),
    (FLOW, {"flow": f"{FLOW}-ingreso"}, "ALTERNATIVE", None),
    (f"{FLOW}-ingreso", {"flow": f"{FLOW}-contrasena"}, "CONDITIONAL", None),
    (f"{FLOW}-contrasena", {"provider": "conditional-level-of-authentication"}, "REQUIRED", (2, PASSWORD_MAX_AGE)),
    (f"{FLOW}-contrasena", {"provider": "auth-username-password-form"}, "REQUIRED", None),
    (f"{FLOW}-ingreso", {"flow": f"{FLOW}-authenticator"}, "CONDITIONAL", None),
    (f"{FLOW}-authenticator", {"provider": "conditional-level-of-authentication"}, "REQUIRED", (1, OTP_MAX_AGE)),
    (f"{FLOW}-authenticator", {"provider": "auth-otp-form"}, "REQUIRED", None),
]


def kc(*args, body=None):
    cmd = ["docker", "compose", "exec", "-T", "keycloak", "/opt/keycloak/bin/kcadm.sh", *args]
    if not args[1].startswith("realms/"):
        cmd += ["-r", REALM]
    if body is not None:
        cmd += ["-f", "-"]
    res = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"kcadm {' '.join(args)} falló: {res.stderr.strip() or res.stdout.strip()}")
    return json.loads(res.stdout) if args[0] == "get" else None


def children(flow):
    return [e for e in kc("get", f"authentication/flows/{flow}/executions") if e["level"] == 0]


def find(flow, step):
    for e in children(flow):
        if "flow" in step and e.get("authenticationFlow") and e["displayName"] == step["flow"]:
            return e
        if "provider" in step and not e.get("authenticationFlow") and e.get("providerId") == step["provider"]:
            return e
    return None


def ensure_step(parent, step, requirement, loa):
    execution = find(parent, step)
    if execution is None:
        if "flow" in step:
            kc("create", f"authentication/flows/{parent}/executions/flow",
               body={"alias": step["flow"], "type": "basic-flow", "description": ""})
        else:
            kc("create", f"authentication/flows/{parent}/executions/execution", body=step)
        execution = find(parent, step)
    if execution["requirement"] != requirement:
        # El PUT toma la representación completa: con campos de menos renombra o reordena el paso.
        kc("update", f"authentication/flows/{parent}/executions", body={**execution, "requirement": requirement})
    if loa:
        level, max_age = loa
        alias, config = f"{parent}-nivel-{level}", {"loa-condition-level": str(level), "loa-max-age": str(max_age)}
        if execution.get("authenticationConfig"):
            current = kc("get", f"authentication/config/{execution['authenticationConfig']}")
            if current.get("config") != config or current.get("alias") != alias:
                kc("update", f"authentication/config/{current['id']}", body={**current, "alias": alias, "config": config})
        else:
            kc("create", f"authentication/executions/{execution['id']}/config", body={"alias": alias, "config": config})


def main():
    kc("update", f"realms/{REALM}",
       "-s", "rememberMe=true",
       "-s", f"ssoSessionIdleTimeout={SSO_SESSION}", "-s", f"ssoSessionMaxLifespan={SSO_SESSION}",
       "-s", f"ssoSessionIdleTimeoutRememberMe={SSO_SESSION}", "-s", f"ssoSessionMaxLifespanRememberMe={SSO_SESSION}")

    client = kc("get", "clients", "-q", f"clientId={CLIENT}")[0]
    kc("update", f"clients/{client['id']}",
       "-s", f'attributes."client.session.idle.timeout"={APP_IDLE}')

    if not any(f["alias"] == FLOW for f in kc("get", "authentication/flows")):
        kc("create", "authentication/flows", body={
            "alias": FLOW, "providerId": "basic-flow", "topLevel": True, "builtIn": False,
            "description": "Contraseña en cada ingreso y authenticator cada 7 días",
        })
    for step in STEPS:
        ensure_step(*step)

    kc("update", f"realms/{REALM}", "-s", f"browserFlow={FLOW}")
    # Keycloak solo acepta el nivel por defecto si existe en el flujo asociado al realm: va después.
    kc("update", f"clients/{client['id']}", "-s", 'attributes."default.acr.values"=2')
    print(f"Keycloak: sesión de la web {APP_IDLE // 3600} h sin uso, contraseña en cada ingreso, "
          f"authenticator cada {OTP_MAX_AGE // 86400} días")


if __name__ == "__main__":
    main()
