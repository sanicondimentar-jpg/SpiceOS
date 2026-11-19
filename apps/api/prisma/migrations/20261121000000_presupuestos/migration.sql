-- Presupuestos: con o sin factura (igual que el pedido) y motivo cuando el cliente lo rechaza.
ALTER TABLE "quotes" ADD COLUMN "with_invoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "quotes" ADD COLUMN "reject_reason" TEXT;
