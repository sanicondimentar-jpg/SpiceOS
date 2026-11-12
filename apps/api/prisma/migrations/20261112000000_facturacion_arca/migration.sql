-- Facturación electrónica con ARCA (web services): datos fiscales del emisor y facturas emitidas.
CREATE TYPE "FiscalCondition" AS ENUM ('MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO');
CREATE TYPE "ArcaEnvironment" AS ENUM ('TESTING', 'PRODUCTION');

CREATE TABLE "fiscal_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_condition" "FiscalCondition" NOT NULL DEFAULT 'MONOTRIBUTO',
    "cuit" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "gross_income_id" TEXT,
    "activity_start" DATE,
    "point_of_sale" INTEGER,
    "environment" "ArcaEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "annual_cap" DECIMAL(18,2),
    "monotributo_category" TEXT,
    "encrypted_private_key" BYTEA,
    "csr" TEXT,
    "certificate" TEXT,
    "certificate_expires_at" TIMESTAMPTZ,
    "encrypted_ticket" BYTEA,
    "ticket_expires_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "fiscal_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fiscal_settings_tenant_id_key" ON "fiscal_settings"("tenant_id");

ALTER TABLE "fiscal_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal_settings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "invoices"
  ADD COLUMN "arca_type" INTEGER,
  ADD COLUMN "issuer_condition" TEXT,
  ADD COLUMN "receiver_name" TEXT,
  ADD COLUMN "receiver_doc_type" INTEGER,
  ADD COLUMN "receiver_doc_number" TEXT,
  ADD COLUMN "receiver_condition" TEXT,
  ADD COLUMN "receiver_address" TEXT,
  ADD COLUMN "net" DECIMAL(18,2),
  ADD COLUMN "vat" DECIMAL(18,2),
  ADD COLUMN "cae_due_date" DATE,
  ADD COLUMN "testing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lines" JSONB,
  ADD COLUMN "related_invoice_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "created_by" UUID;
CREATE INDEX "invoices_tenant_id_order_id_idx" ON "invoices"("tenant_id", "order_id");

-- La empresa factura como monotributista (Factura C): no se suma IVA a ningún pedido.
-- Los pedidos que ya tenían el 21 % calculado pasan a cobrarse al precio de lista.
UPDATE "sales_orders" SET "tax_total" = 0 WHERE "tax_total" <> 0;
