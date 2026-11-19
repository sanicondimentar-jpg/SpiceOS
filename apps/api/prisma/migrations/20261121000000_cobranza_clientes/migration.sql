-- Cobranza a clientes: lo que debe cada cliente (pedidos entregados o deudas cargadas a mano),
-- cobros en efectivo o en cuenta con comprobante, qué deudas cubre cada cobro y avisos por WhatsApp.

CREATE TABLE "customer_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    CONSTRAINT "customer_charges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_charges_order_id_key" ON "customer_charges"("order_id");
CREATE INDEX "customer_charges_tenant_id_customer_id_date_idx" ON "customer_charges"("tenant_id", "customer_id", "date");
CREATE INDEX "customer_charges_tenant_id_due_date_idx" ON "customer_charges"("tenant_id", "due_date");
ALTER TABLE "customer_charges" ADD CONSTRAINT "customer_charges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_charges" ADD CONSTRAINT "customer_charges_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "group_id" UUID,
    "date" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "collected_by" TEXT,
    "proof" BYTEA,
    "proof_type" TEXT,
    "proof_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_payments_tenant_id_customer_id_date_idx" ON "customer_payments"("tenant_id", "customer_id", "date");
CREATE INDEX "customer_payments_tenant_id_date_idx" ON "customer_payments"("tenant_id", "date");
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_payment_allocations" (
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "customer_payment_allocations_pkey" PRIMARY KEY ("payment_id","charge_id")
);
CREATE INDEX "customer_payment_allocations_charge_id_idx" ON "customer_payment_allocations"("charge_id");
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "customer_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "collection_notices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "to_phone" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collection_notices_charge_id_kind_key" ON "collection_notices"("charge_id", "kind");
ALTER TABLE "collection_notices" ADD CONSTRAINT "collection_notices_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "customer_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "collection_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "terms_days" INTEGER NOT NULL DEFAULT 30,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "days_before" INTEGER NOT NULL DEFAULT 10,
    "notify_phone" TEXT,
    "owner_template" TEXT,
    "customer_template" TEXT,
    "template_lang" TEXT NOT NULL DEFAULT 'es_AR',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collection_settings_tenant_id_key" ON "collection_settings"("tenant_id");

-- Los pedidos que ya estaban entregados pasan a la cuenta del cliente: fecha de entrega + 30 días
-- (o el plazo de la ficha si tiene uno).
INSERT INTO "customer_charges" ("id", "tenant_id", "customer_id", "order_id", "date", "due_date", "total", "description", "source")
SELECT gen_random_uuid(), o."tenant_id", o."customer_id", o."id", d."day",
       d."day" + (CASE WHEN c."payment_terms_days" > 0 THEN c."payment_terms_days" ELSE 30 END),
       o."total" + o."tax_total", 'Pedido ' || o."number", 'ORDER'
FROM "sales_orders" o
JOIN "customers" c ON c."id" = o."customer_id"
CROSS JOIN LATERAL (
  SELECT COALESCE(
    (SELECT min(h."changed_at") FROM "order_status_history" h WHERE h."order_id" = o."id" AND h."to" = 'DELIVERED'),
    o."updated_at"
  ) AT TIME ZONE 'America/Argentina/Buenos_Aires' AS ts
) t
CROSS JOIN LATERAL (SELECT t.ts::date AS "day") d
WHERE o."status" IN ('DELIVERED', 'INVOICED') AND o."total" + o."tax_total" > 0;

ALTER TABLE "customer_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_charges" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_charges" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customer_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_payments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customer_payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_payment_allocations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "collection_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_notices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "collection_notices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "collection_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "collection_settings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
