-- Pedidos con o sin factura: sin factura no se suma IVA.
ALTER TABLE "sales_orders" ADD COLUMN "with_invoice" BOOLEAN NOT NULL DEFAULT true;
