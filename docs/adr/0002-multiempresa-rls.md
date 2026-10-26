# ADR 0002: Multiempresa con esquema compartido y Row Level Security

- Fecha: 2026-10-26
- Estado: aceptada

## Decisión
Todas las tablas de negocio tienen `tenant_id`. La aplicación se conecta como `spiceos_app` (sin BYPASSRLS) y fija `app.tenant_id` al inicio de cada transacción. Las políticas RLS impiden leer o escribir filas de otra empresa aunque el código tenga un error. Los procesos de sistema que recorren todas las empresas usan `spiceos_system`, nunca para requests HTTP.

El tenant sale del claim de organización del JWT de Keycloak; el header `x-spiceos-org` solo elige entre organizaciones del propio token.

## Verificado
Sin tenant fijado: 0 filas. Con otro tenant: 0 filas. Insertar con otro `tenant_id`: rechazado por la política. `DELETE` sobre `audit_logs`: permiso denegado.

## Alternativas descartadas
- Base por empresa: aislamiento físico pero costo y migraciones x N. Queda como opción para clientes que lo exijan (mismo esquema, *tenant router*).
- Schema por empresa: complica Prisma y las migraciones sin ventaja real sobre RLS.
