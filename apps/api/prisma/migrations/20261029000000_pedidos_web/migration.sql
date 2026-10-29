-- Pedidos de la web: entran pendientes de revisión hasta que alguien los aprueba o los descarta.
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_REVIEW' BEFORE 'DRAFT';

ALTER TABLE "sales_orders" ADD COLUMN "contact_name" TEXT,
ADD COLUMN "contact_phone" TEXT,
ADD COLUMN "created_customer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "web_total" DECIMAL(18,4);

-- Faltante al confirmar y la línea de la nota de pedido al proveedor que lo cubre.
ALTER TABLE "sales_order_lines" ADD COLUMN "backorder_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN "purchase_order_line_id" UUID;
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD COLUMN "notes" TEXT,
ADD COLUMN "sent_at" TIMESTAMPTZ,
ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Hoy toda la mercadería es de Especias 51: se crea el proveedor y se le asignan las
-- presentaciones existentes (los sueltos "-U" se compran como la caja de la que salen).
INSERT INTO "suppliers" ("id", "tenant_id", "code", "legal_name", "country")
SELECT gen_random_uuid(), c."id", 'ESP51', 'Especias 51', 'AR'
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "product_variants" v WHERE v."tenant_id" = c."id")
ON CONFLICT ("tenant_id", "code") DO NOTHING;

INSERT INTO "supplier_products" ("supplier_id", "variant_id", "supplier_sku", "last_cost", "is_preferred")
SELECT s."id", v."id", v."sku", NULLIF(v."current_cost", 0), true
FROM "product_variants" v
JOIN "suppliers" s ON s."tenant_id" = v."tenant_id" AND s."code" = 'ESP51'
WHERE v."sku" NOT LIKE '%-U'
ON CONFLICT DO NOTHING;
