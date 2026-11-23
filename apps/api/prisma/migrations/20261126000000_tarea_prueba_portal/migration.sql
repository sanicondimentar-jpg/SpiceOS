-- Tarea pendiente pedida por Nacho (23/11/2026): probar el portal mayorista con un cliente real
-- antes de mandar la guía a clientes nuevos. Queda en la tarjeta "Pendientes" de Inicio.
-- Se asigna al primer usuario Dueño (admin) de cada empresa.
INSERT INTO "tasks" ("id", "tenant_id", "title", "description", "assignee_id", "priority", "status", "origin", "created_by")
SELECT gen_random_uuid(), c."id",
  'Probar el portal mayorista con un cliente real',
  'Entrar a www.saboracasa.com.ar/mayoristas con el número de un cliente real (no el tuyo, que es dueño), mandar el código por WhatsApp y verificar que entra y ve sus precios. Recién después mandar la guía a clientes nuevos (está en Drive, carpeta "Clientes Mayoristas").',
  (SELECT m."user_id" FROM "memberships" m JOIN "roles" r ON r."id" = m."role_id"
    WHERE m."tenant_id" = c."id" AND r."key" = 'admin' AND m."is_active" ORDER BY m."created_at" LIMIT 1),
  'HIGH', 'OPEN', 'manual', 'migration'
FROM "companies" c
WHERE NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."tenant_id" = c."id" AND t."title" = 'Probar el portal mayorista con un cliente real');
