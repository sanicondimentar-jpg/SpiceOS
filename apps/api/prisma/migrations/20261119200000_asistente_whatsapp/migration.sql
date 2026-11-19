-- Asistente de ventas por WhatsApp (IA). Arranca apagado.
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN "assistant_mode" TEXT NOT NULL DEFAULT 'OFF',
  ADD COLUMN "assistant_test_phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "assistant_min_order" DECIMAL(18,2) NOT NULL DEFAULT 50000,
  ADD COLUMN "assistant_notes" TEXT;

ALTER TABLE "conversations"
  ADD COLUMN "assistant_paused_until" TIMESTAMPTZ,
  ADD COLUMN "assistant_handoff" TEXT,
  ADD COLUMN "assistant_handoff_at" TIMESTAMPTZ;

ALTER TABLE "sales_orders" ADD COLUMN "conversation_id" UUID;
CREATE INDEX "sales_orders_tenant_id_conversation_id_idx" ON "sales_orders"("tenant_id", "conversation_id");
