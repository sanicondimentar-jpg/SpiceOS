-- Ficha del cliente: días y horario en que atiende o recibe pedidos (opcionales).
-- La dirección va en customer_addresses (la principal, is_default = true).
ALTER TABLE "customers" ADD COLUMN "delivery_days" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "customers" ADD COLUMN "delivery_hours" TEXT;
