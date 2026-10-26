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
  receivables: { read: 'receivables.account.read', write: 'receivables.payment.write' },
  documents: { read: 'documents.document.read', write: 'documents.document.write' },
  messaging: { read: 'messaging.conversation.read', send: 'messaging.message.send' },
  automation: { read: 'automation.rule.read', write: 'automation.rule.write' },
  copilot: { use: 'copilot.chat.use' },
  analytics: { executive: 'analytics.executive.read' },
  admin: { users: 'core.user.manage', settings: 'core.settings.manage', audit: 'core.audit.read' },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type PermissionKey = Leaves<typeof PERMISSIONS>;

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group) as PermissionKey[],
);
