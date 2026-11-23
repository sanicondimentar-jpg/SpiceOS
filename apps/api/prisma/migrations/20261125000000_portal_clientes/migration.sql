-- Portal de clientes mayoristas (www.saboracasa.com.ar/mayoristas).
-- El cliente entra mandando por WhatsApp el código que le muestra el portal: el número desde el que
-- escribe tiene que ser el de su ficha. No hay contraseñas.

CREATE TABLE "portal_login_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    -- Hash de la clave que guarda el navegador: cuando el código llega por WhatsApp pasa a ser la sesión.
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, OK, NOT_CUSTOMER
    "phone" TEXT,
    "customer_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_login_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "portal_login_requests_tenant_id_code_status_idx" ON "portal_login_requests"("tenant_id", "code", "status");

CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portal_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "portal_sessions_token_hash_key" ON "portal_sessions"("token_hash");
CREATE INDEX "portal_sessions_tenant_id_customer_id_idx" ON "portal_sessions"("tenant_id", "customer_id");

ALTER TABLE "portal_login_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_login_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_login_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "portal_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_sessions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
