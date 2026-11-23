// Permisos "<modulo>.<recurso>.<accion>". Se sincronizan con la tabla `permissions` en el seed.
export const PERMISSIONS = {
  crm: {
    customerRead: 'crm.customer.read',
    customerWrite: 'crm.customer.write',
    customerDelete: 'crm.customer.delete',
  },
  sales: {
    opportunityRead: 'sales.opportunity.read',
    opportunityWrite: 'sales.opportunity.write',
    quoteRead: 'sales.quote.read',
    quoteWrite: 'sales.quote.write',
    quoteApprove: 'sales.quote.approve',
  },
  catalog: { read: 'catalog.product.read', write: 'catalog.product.write', costRead: 'catalog.cost.read' },
  orders: { read: 'orders.order.read', write: 'orders.order.write', confirm: 'orders.order.confirm' },
  inventory: { read: 'inventory.stock.read', adjust: 'inventory.stock.adjust' },
  purchasing: { read: 'purchasing.order.read', write: 'purchasing.order.write' },
  receivables: { read: 'receivables.account.read', write: 'receivables.payment.write' },
  invoicing: { read: 'invoicing.invoice.read', issue: 'invoicing.invoice.issue' },
  documents: { read: 'documents.document.read', write: 'documents.document.write' },
  messaging: { read: 'messaging.conversation.read', send: 'messaging.message.send' },
  automation: { read: 'automation.rule.read', write: 'automation.rule.write' },
  copilot: { use: 'copilot.chat.use' },
  analytics: { executive: 'analytics.executive.read' },
  ai: { give: 'ai.order.give', read: 'ai.order.read' },
  admin: { users: 'core.user.manage', settings: 'core.settings.manage', audit: 'core.audit.read' },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type PermissionKey = Leaves<typeof PERMISSIONS>;

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group) as PermissionKey[],
);

/** Cómo se muestra cada permiso en Configuración → Usuarios y permisos. */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'crm.customer.read': 'Ver clientes',
  'crm.customer.write': 'Crear y editar clientes',
  'crm.customer.delete': 'Borrar clientes',
  'sales.opportunity.read': 'Ver oportunidades de venta',
  'sales.opportunity.write': 'Crear y editar oportunidades',
  'sales.quote.read': 'Ver presupuestos',
  'sales.quote.write': 'Armar presupuestos',
  'sales.quote.approve': 'Aprobar presupuestos con descuento',
  'catalog.product.read': 'Ver productos y listas de precios',
  'catalog.product.write': 'Editar productos y precios',
  'catalog.cost.read': 'Ver costos y márgenes',
  'orders.order.read': 'Ver pedidos',
  'orders.order.write': 'Cargar pedidos y moverlos de etapa',
  'orders.order.confirm': 'Confirmar y cancelar pedidos',
  'inventory.stock.read': 'Ver stock',
  'inventory.stock.adjust': 'Ajustar stock e ingresar mercadería',
  'purchasing.order.read': 'Ver compras y proveedores',
  'purchasing.order.write': 'Cargar compras y pagos a proveedores',
  'receivables.account.read': 'Ver cobranza y deudas de clientes',
  'receivables.payment.write': 'Registrar cobros',
  'invoicing.invoice.read': 'Ver facturas',
  'invoicing.invoice.issue': 'Facturar',
  'documents.document.read': 'Ver documentos',
  'documents.document.write': 'Subir documentos',
  'messaging.conversation.read': 'Ver chats de WhatsApp',
  'messaging.message.send': 'Responder por WhatsApp y pausar el asistente',
  'automation.rule.read': 'Ver automatizaciones',
  'automation.rule.write': 'Editar automatizaciones',
  'copilot.chat.use': 'Usar el copiloto',
  'analytics.executive.read': 'Ver inteligencia (indicadores)',
  'core.user.manage': 'Administrar usuarios, roles y permisos',
  'core.settings.manage': 'Cambiar la configuración',
  'core.audit.read': 'Ver el registro de auditoría',
  'ai.order.give': 'Dar órdenes a la IA por WhatsApp',
  'ai.order.read': 'Ver "Órdenes a la IA"',
};

/** Grupos de permisos como se muestran en pantalla (por área de la empresa). */
export const PERMISSION_GROUPS: { label: string; prefix: string[] }[] = [
  { label: 'Clientes y ventas', prefix: ['crm.', 'sales.'] },
  { label: 'Pedidos', prefix: ['orders.'] },
  { label: 'Productos y precios', prefix: ['catalog.'] },
  { label: 'Stock y compras', prefix: ['inventory.', 'purchasing.'] },
  { label: 'Cobranza y facturación', prefix: ['receivables.', 'invoicing.'] },
  { label: 'WhatsApp', prefix: ['messaging.'] },
  { label: 'IA', prefix: ['ai.', 'copilot.'] },
  { label: 'Documentos, automatizaciones e indicadores', prefix: ['documents.', 'automation.', 'analytics.'] },
  { label: 'Administración', prefix: ['core.'] },
];
