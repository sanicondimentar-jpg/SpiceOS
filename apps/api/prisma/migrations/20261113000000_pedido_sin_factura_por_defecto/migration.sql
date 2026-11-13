-- Los pedidos nuevos vienen marcados "sin factura"; facturar es opcional (botón Facturar en el pedido).
-- Los pedidos existentes quedan como estaban.
ALTER TABLE "sales_orders" ALTER COLUMN "with_invoice" SET DEFAULT false;
