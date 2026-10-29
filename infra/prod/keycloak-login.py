#!/usr/bin/env python3
"""Duración de la sesión y frecuencia del segundo factor en Keycloak. Lo llama deploy.sh; es idempotente.

- La sesión de la web se cierra tras 2 horas sin uso (sesión del cliente spiceos-web en Keycloak).
- El inicio de sesión usa niveles de autenticación (LoA) de Keycloak:
    nivel 1, contraseña: se vuelve a pedir si pasaron más de 2 horas desde que se ingresó.
    nivel 2, código del authenticator: se pide la primera vez y después cada 7 días.
  El cliente spiceos-web pide siempre el nivel 2, así que cada ingreso pasa por los dos niveles
  y Keycloak saltea los que siguen vigentes en la sesión del navegador.
- Para que el navegador recuerde esa sesión, la sesión de Keycloak dura 7 días ("Recordarme" activado).
"""
import json
import subprocess
import sys

REALM = "spiceos"
CLIENT = "spiceos-web"
FLOW = "spiceos-navegador"
APP_IDLE = 2 * 3600
PASSWORD_MAX_AGE = 2 * 3600
OTP_MAX_AGE = 7 * 24 * 3600
SSO_SESSION = 7 * 24 * 3600

# (flujo padre, paso, requisito, nivel y vigencia en segundos si es una condición de nivel)
STEPS = [
    (FLOW, {"provider": "auth-cookie"}, "ALTERNATIVE", None),
    (FLOW, {"flow": f"{FLOW}-ingreso"}, "ALTERNATIVE", None),
    (f"{FLOW}-ingreso", {"flow": f"{FLOW}-contrasena"}, "CONDITIONAL", None),
    (f"{FLOW}-contrasena", {"provider": "conditional-level-of-authentication"}, "REQUIRED", (1, PASSWORD_MAX_AGE)),
    (f"{FLOW}-contrasena", {"provider": "auth-username-password-form"}, "REQUIRED", None),
    (f"{FLOW}-ingreso", {"flow": f"{FLOW}-authenticator"}, "CONDITIONAL", None),
    (f"{FLOW}-authenticator", {"provider": "conditional-level-of-authentication"}, "REQUIRED", (2, OTP_MAX_AGE)),
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
        config = {"loa-condition-level": str(level), "loa-max-age": str(max_age)}
        if execution.get("authenticationConfig"):
            current = kc("get", f"authentication/config/{execution['authenticationConfig']}")
            if current.get("config") != config:
                kc("update", f"authentication/config/{current['id']}", body={**current, "config": config})
        else:
            kc("create", f"authentication/executions/{execution['id']}/config",
               body={"alias": f"{parent}-nivel-{level}", "config": config})


def main():
    kc("update", f"realms/{REALM}",
       "-s", "rememberMe=true",
       "-s", f"ssoSessionIdleTimeout={SSO_SESSION}", "-s", f"ssoSessionMaxLifespan={SSO_SESSION}",
       "-s", f"ssoSessionIdleTimeoutRememberMe={SSO_SESSION}", "-s", f"ssoSessionMaxLifespanRememberMe={SSO_SESSION}")

    client = kc("get", "clients", "-q", f"clientId={CLIENT}")[0]
    kc("update", f"clients/{client['id']}",
       "-s", f'attributes."client.session.idle.timeout"={APP_IDLE}',
       "-s", 'attributes."default.acr.values"=2')

    if not any(f["alias"] == FLOW for f in kc("get", "authentication/flows")):
        kc("create", "authentication/flows", body={
            "alias": FLOW, "providerId": "basic-flow", "topLevel": True, "builtIn": False,
            "description": "Contraseña cada 2 horas y authenticator cada 7 días",
        })
    for step in STEPS:
        ensure_step(*step)

    kc("update", f"realms/{REALM}", "-s", f"browserFlow={FLOW}")
    print(f"Keycloak: sesión de la web {APP_IDLE // 3600} h sin uso, contraseña cada {PASSWORD_MAX_AGE // 3600} h, "
          f"authenticator cada {OTP_MAX_AGE // 86400} días")


if __name__ == "__main__":
    main()
