-- Baja de productos pedida por Nacho el 18/11/2026. Es una baja (inactivos), no un borrado:
-- los pedidos, facturas y movimientos de stock que ya los usan quedan como estaban.
-- Dados de baja dejan de aparecer en la carga de pedidos, en la web (catálogo público)
-- y en la lista de precios en PDF. Se reactivan desde la ficha del producto.

-- Presentaciones puntuales (con sus sobres sueltos "-U").
UPDATE "product_variants" SET "is_active" = false, "updated_at" = now()
WHERE "sku" IN (
  '63', '63-U', '64', '64-U',        -- Albahaca en Hojas 25 g
  '92', '92-U',                      -- Coco Rallado 100 g
  '103', '103-U', '104', '104-U',    -- Comino Molido 50 g
  '115', '115-U',                    -- Especias Surtidas 25 g
  '20', '20-U', '22', '22-U',        -- Pimentón Flor Selecto 25 g
  '39', '39-U',                      -- Pimentón Seleccionado 100 g
  '157', '157-U'                     -- Pimienta Blanca Molida 100 g
);

-- Productos completos: Azafrán Español, Mezcla para Pesto y Nuez Moscada en Grano.
UPDATE "product_variants" SET "is_active" = false, "updated_at" = now()
WHERE "product_id" IN (
  SELECT "id" FROM "products" WHERE "code" IN ('AZAFRAN-ESPANOL', 'MEZCLA-PARA-PESTO', 'NUEZ-MOSCADA-EN-GRANO')
);
UPDATE "products" SET "is_active" = false, "updated_at" = now()
WHERE "code" IN ('AZAFRAN-ESPANOL', 'MEZCLA-PARA-PESTO', 'NUEZ-MOSCADA-EN-GRANO');
