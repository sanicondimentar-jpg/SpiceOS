-- Productos recomendados por tipo de cliente (minorista y rubros mayoristas). Los usan la web
-- (al elegir "compro por mayor/por menor" y el rubro) y el asistente de WhatsApp.
-- Sin fila para un tipo de cliente se usa la lista por defecto del código (catalog/domain/recommendations.ts).
CREATE TABLE "recommendation_lists" (
    "tenant_id" UUID NOT NULL,
    "segment" TEXT NOT NULL,
    "skus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recommendation_lists_pkey" PRIMARY KEY ("tenant_id","segment")
);

ALTER TABLE "recommendation_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recommendation_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recommendation_lists" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
