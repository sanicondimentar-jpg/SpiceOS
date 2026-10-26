# ADR 0003: La IA actúa solo a través de tools tipadas

- Fecha: 2026-10-26
- Estado: aceptada

## Decisión
El copiloto y los agentes no escriben SQL ni acceden a la base. Cada capacidad se expone con `@AiTool` sobre un método de un servicio de aplicación, con esquema zod, permisos requeridos y marca de escritura. El registro valida la entrada, re-chequea permisos y ejecuta en un contexto `agent:<nombre>` en nombre del usuario, por lo que la auditoría registra quién pidió y qué agente ejecutó. Las acciones que salen de la empresa (mensajes a clientes) requieren confirmación explícita.

## Consecuencias
Agregar una funcionalidad al copiloto es agregar un decorador. El modelo nunca ve datos que el usuario no podría ver en pantalla.
