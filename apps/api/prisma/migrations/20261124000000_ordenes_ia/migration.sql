-- Modo dueño: chats internos, registro de órdenes a la IA e indicaciones vigentes para el asistente de ventas.
ALTER TABLE "conversations" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ai_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "request" TEXT NOT NULL,
    "reply" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "pending_action" JSONB,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_orders_tenant_id_created_at_idx" ON "ai_orders"("tenant_id", "created_at");
CREATE INDEX "ai_orders_tenant_id_user_id_status_idx" ON "ai_orders"("tenant_id", "user_id", "status");

CREATE TABLE "ai_instructions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "until" DATE,
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    CONSTRAINT "ai_instructions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_instructions_tenant_id_revoked_at_idx" ON "ai_instructions"("tenant_id", "revoked_at");

ALTER TABLE "ai_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_orders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "ai_instructions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_instructions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_instructions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Los permisos se dan en el seed (corre en cada deploy). Si el rol "admin" se llamaba "Administrador", pasa a "Dueño".
UPDATE "roles" SET "name" = 'Dueño', "description" = 'Todos los permisos' WHERE "key" = 'admin' AND "name" = 'Administrador';
