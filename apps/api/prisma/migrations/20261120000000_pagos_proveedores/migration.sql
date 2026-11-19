-- Pagos a proveedores con comprobante: compras (lo que se debe), pagos y qué compras cubre cada pago.
CREATE TABLE "supplier_purchases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "total" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "pending_receipt_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    CONSTRAINT "supplier_purchases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_purchases_tenant_id_supplier_id_date_idx" ON "supplier_purchases"("tenant_id", "supplier_id", "date");
ALTER TABLE "supplier_purchases" ADD CONSTRAINT "supplier_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "proof" BYTEA,
    "proof_type" TEXT,
    "proof_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_payments_tenant_id_supplier_id_date_idx" ON "supplier_payments"("tenant_id", "supplier_id", "date");
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "supplier_payment_allocations" (
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("payment_id","purchase_id")
);
CREATE INDEX "supplier_payment_allocations_purchase_id_idx" ON "supplier_payment_allocations"("purchase_id");
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "supplier_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_purchases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_purchases" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "supplier_payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payment_allocations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
