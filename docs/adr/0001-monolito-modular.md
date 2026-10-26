# ADR 0001: Monolito modular con eventos

- Fecha: 2026-10-26
- Estado: aceptada

## Decisión
Un único código NestJS con un módulo por bounded context, desplegado como tres procesos (`api`, `worker`, `scheduler`). Los módulos se comunican por fachadas públicas (`*.facade.ts`) o por eventos de dominio publicados con outbox en RabbitMQ. Ningún módulo lee tablas de otro.

## Alternativas descartadas
- Microservicios desde el día 1: costo operativo y de consistencia desproporcionado para un equipo de 3 a 4 personas.
- Monolito sin límites: impide separar servicios cuando el volumen lo pida.

## Consecuencias
Separar un módulo en un servicio propio requiere mover su carpeta, su esquema y sus colas, sin reescribir el dominio.
