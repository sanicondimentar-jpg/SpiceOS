-- =============================================================================
-- Row Level Security multiempresa.
-- La app se conecta como spiceos_app (sin BYPASSRLS) y en cada transacción
-- ejecuta: SELECT set_config('app.tenant_id', '<uuid>', true)
-- Sin tenant configurado, ninguna fila es visible.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spiceos_app') THEN
    CREATE ROLE spiceos_app LOGIN PASSWORD 'change-me-app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO spiceos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spiceos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spiceos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spiceos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO spiceos_app;

-- La auditoría es append-only para la aplicación.
REVOKE UPDATE, DELETE ON "audit_logs" FROM spiceos_app;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activities" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_rules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branches" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "carriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carriers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "carriers" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "categories" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "certifications" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "commission_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commission_plans" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "commissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commissions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contacts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "copilot_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copilot_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "copilot_sessions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "cost_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_history" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customer_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_accounts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_addresses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_addresses" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_notes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customers" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deliveries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_versions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "drive_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drive_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drive_connections" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "drive_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drive_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drive_files" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "exchange_rates" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "knowledge_chunks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "knowledge_sources" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leads" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_entries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lots" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "opportunities" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_events" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipelines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "price_lists" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_variants" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_orders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "risk_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_assessments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "risk_assessments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_orders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_targets" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "segments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "segments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sequences" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "stock_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_items" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movements" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "suppliers" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_rates" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicles" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouses" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "whatsapp_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_accounts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- companies: cada empresa solo se ve a sí misma.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "companies" USING (id = app_current_tenant());

-- Rol de sistema para procesos multi-tenant (relay de outbox, scheduler que
-- recorre todas las empresas). Nunca se usa para atender requests HTTP.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spiceos_system') THEN
    CREATE ROLE spiceos_system LOGIN BYPASSRLS PASSWORD 'change-me-system';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO spiceos_system;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO spiceos_system;

-- Las tablas hijas sin tenant_id (líneas, historial) se protegen vía su cabecera:
-- solo se accede a ellas a través de repositorios que primero cargan la cabecera.

-- Índices de búsqueda difusa para el copiloto y el buscador global.
CREATE INDEX IF NOT EXISTS customers_name_trgm ON "customers" USING gin ("legal_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_name_trgm ON "products" USING gin ("name" gin_trgm_ops);
