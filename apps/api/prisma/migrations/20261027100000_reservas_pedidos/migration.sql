-- Stock reservado por línea de pedido y lote (se libera al cancelar, se descuenta al despachar).
CREATE TABLE "order_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "lot_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_allocations_order_line_id_idx" ON "order_allocations"("order_line_id");

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_allocations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- El índice único (depósito, variante, lote) no impide duplicados cuando el lote es NULL.
CREATE UNIQUE INDEX "stock_items_sin_lote_key" ON "stock_items"("warehouse_id", "variant_id") WHERE "lot_id" IS NULL;

-- Saldo nunca negativo ni con más reservado que existente.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_saldo_check" CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");

-- El rol de procesos de sistema (worker, scheduler) no tiene privilegios por defecto sobre tablas nuevas.
GRANT SELECT, INSERT, UPDATE ON "order_allocations" TO spiceos_system;
