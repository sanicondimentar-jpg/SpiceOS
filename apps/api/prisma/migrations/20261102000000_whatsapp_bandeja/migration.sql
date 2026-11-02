-- WhatsApp: la cuenta se carga desde Configuración (sin variables en el servidor) y bandeja de chats.
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN "verify_token" TEXT,
  ADD COLUMN "encrypted_app_secret" BYTEA,
  ADD COLUMN "verified_name" TEXT,
  ADD COLUMN "connected_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX "whatsapp_accounts_verify_token_key" ON "whatsapp_accounts"("verify_token");

ALTER TABLE "conversations" ADD COLUMN "unread_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "messages" ADD COLUMN "error" TEXT;
