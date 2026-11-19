-- Remitos de compra leídos con IA: por WhatsApp (solo teléfonos autorizados del proveedor) o con clave de acceso.
ALTER TABLE "suppliers" ADD COLUMN "receipt_phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "pending_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "supplier_id" UUID,
    "sender" TEXT,
    "message_id" UUID,
    "reference" TEXT,
    "document_date" DATE,
    "note" TEXT,
    "reading" JSONB NOT NULL,
    "image" BYTEA,
    "image_type" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ,
    CONSTRAINT "pending_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pending_receipts_tenant_id_message_id_key" ON "pending_receipts"("tenant_id", "message_id");
CREATE INDEX "pending_receipts_tenant_id_status_created_at_idx" ON "pending_receipts"("tenant_id", "status", "created_at");
ALTER TABLE "pending_receipts" ADD CONSTRAINT "pending_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'receipts',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

ALTER TABLE "pending_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pending_receipts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- El login con clave de acceso la busca antes de conocer la empresa (cliente de sistema, sin RLS).
GRANT SELECT, UPDATE ON "api_keys" TO spiceos_system;
