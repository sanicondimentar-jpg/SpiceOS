-- Presentaciones que se venden por unidad (frascos, cápsulas) no llevan peso.
ALTER TABLE "product_variants" ALTER COLUMN "net_weight_kg" DROP NOT NULL;
