-- Combos: un producto con su propio SKU que se vende en una sola línea (pedido y factura) y que,
-- al reservarse y despacharse, descuenta stock de cada sobre que lo compone.
CREATE TABLE "kit_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kit_variant_id" UUID NOT NULL,
    "component_variant_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    CONSTRAINT "kit_components_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kit_components_tenant_id_kit_variant_id_component_variant_i_key" ON "kit_components"("tenant_id", "kit_variant_id", "component_variant_id");
CREATE INDEX "kit_components_kit_variant_id_idx" ON "kit_components"("kit_variant_id");
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_kit_variant_id_fkey" FOREIGN KEY ("kit_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_component_variant_id_fkey" FOREIGN KEY ("component_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kit_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kit_components" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kit_components" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Combo Esencial (Nacho, 19/11/2026): un sobre de 25 g de cada uno, $10.000.
-- Combo Chef (antes "Combo básico"): 10 sobres de pimienta negra, pimentón, orégano y ají, $41.000.
-- Se crean solo en las empresas que tienen todos los sobres.
CREATE TEMP TABLE "_combo_def" ("code" TEXT, "name" TEXT, "presentation" TEXT, "weight" DECIMAL, "price" DECIMAL, "component" TEXT, "qty" DECIMAL);
INSERT INTO "_combo_def" VALUES
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '179-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '159-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '60-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '41-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '373-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '105-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '330-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '329-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '50-U', 1),
  ('COMBO-ESENCIAL', 'Combo Esencial', '10 sobres de 25 g', 0.25, 10000, '48-U', 1),
  ('COMBO-CHEF', 'Combo Chef', '40 sobres de 25 g', 1, 41000, '179-U', 10),
  ('COMBO-CHEF', 'Combo Chef', '40 sobres de 25 g', 1, 41000, '41-U', 10),
  ('COMBO-CHEF', 'Combo Chef', '40 sobres de 25 g', 1, 41000, '141-U', 10),
  ('COMBO-CHEF', 'Combo Chef', '40 sobres de 25 g', 1, 41000, '60-U', 10);

CREATE TEMP TABLE "_combo_tenant" AS
SELECT DISTINCT c."id" AS "tenant_id", d."code", d."name", d."presentation", d."weight", d."price"
FROM "companies" c
CROSS JOIN "_combo_def" d
WHERE NOT EXISTS (
  SELECT 1 FROM "_combo_def" d2
  WHERE d2."code" = d."code"
    AND NOT EXISTS (SELECT 1 FROM "product_variants" v WHERE v."tenant_id" = c."id" AND v."sku" = d2."component")
);

INSERT INTO "products" ("id", "tenant_id", "code", "name", "description", "updated_at")
SELECT gen_random_uuid(), t."tenant_id", t."code", t."name", 'Combo de sobres: al venderse descuenta el stock de cada sobre.', now()
FROM "_combo_tenant" t
ON CONFLICT ("tenant_id", "code") DO NOTHING;

INSERT INTO "product_variants" ("id", "tenant_id", "product_id", "sku", "name", "net_weight_kg", "current_cost", "updated_at")
SELECT gen_random_uuid(), t."tenant_id", p."id", t."code", t."presentation", t."weight",
       coalesce((SELECT sum(v."current_cost" * d."qty") FROM "_combo_def" d JOIN "product_variants" v ON v."tenant_id" = t."tenant_id" AND v."sku" = d."component" WHERE d."code" = t."code"), 0),
       now()
FROM "_combo_tenant" t
JOIN "products" p ON p."tenant_id" = t."tenant_id" AND p."code" = t."code"
ON CONFLICT ("tenant_id", "sku") DO NOTHING;

INSERT INTO "kit_components" ("id", "tenant_id", "kit_variant_id", "component_variant_id", "quantity")
SELECT gen_random_uuid(), t."tenant_id", k."id", c."id", d."qty"
FROM "_combo_tenant" t
JOIN "_combo_def" d ON d."code" = t."code"
JOIN "product_variants" k ON k."tenant_id" = t."tenant_id" AND k."sku" = t."code"
JOIN "product_variants" c ON c."tenant_id" = t."tenant_id" AND c."sku" = d."component"
ON CONFLICT DO NOTHING;

-- Mismo precio en las listas Minorista y Mayorista (se cambia desde Listas de precios).
INSERT INTO "price_list_items" ("id", "price_list_id", "variant_id", "price", "min_quantity", "updated_at")
SELECT gen_random_uuid(), pl."id", k."id", t."price", 1, now()
FROM "_combo_tenant" t
JOIN "product_variants" k ON k."tenant_id" = t."tenant_id" AND k."sku" = t."code"
JOIN "price_lists" pl ON pl."tenant_id" = t."tenant_id" AND lower(pl."name") IN ('minorista', 'mayorista')
ON CONFLICT ("price_list_id", "variant_id", "min_quantity") DO NOTHING;

DROP TABLE "_combo_tenant";
DROP TABLE "_combo_def";
