'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Boxes, FileText, Tags, Upload, LayoutDashboard, MessageCircle, Package, Settings, ShoppingCart, Truck, Users, Wallet, Workflow, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/hooks';

const NAV = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/inbox', label: 'WhatsApp', icon: MessageCircle, perm: 'messaging.conversation.read' },
  { href: '/customers', label: 'Clientes', icon: Users, perm: 'crm.customer.read' },
  { href: '/sales', label: 'Ventas', icon: Target, perm: 'sales.opportunity.read' },
  { href: '/orders', label: 'Pedidos', icon: ShoppingCart, perm: 'orders.order.read' },
  { href: '/products', label: 'Productos', icon: Package, perm: 'catalog.product.read' },
  { href: '/price-lists', label: 'Listas de precios', icon: Tags, perm: 'catalog.product.read' },
  { href: '/inventory', label: 'Inventario', icon: Boxes, perm: 'inventory.stock.read' },
  { href: '/logistics', label: 'Logística', icon: Truck, perm: 'orders.order.read' },
  { href: '/receivables', label: 'Cobranza', icon: Wallet, perm: 'receivables.account.read' },
  { href: '/documents', label: 'Documentos', icon: FileText, perm: 'documents.document.read' },
  { href: '/automation', label: 'Automatizaciones', icon: Workflow, perm: 'automation.rule.read' },
  { href: '/analytics', label: 'Inteligencia', icon: BarChart3, perm: 'analytics.executive.read' },
  { href: '/imports', label: 'Importar', icon: Upload, perm: 'crm.customer.write' },
  { href: '/settings', label: 'Configuración', icon: Settings, perm: 'core.settings.manage' },
];

/** El menú se arma con los permisos del usuario: lo que no puede usar, no lo ve. */
export function Sidebar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const items = NAV.filter((i) => !i.perm || me?.permissions.includes(i.perm));
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">S</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">SpiceOS</div>
          <div className="text-xs text-muted-foreground">{me?.company.tradeName ?? me?.company.legalName ?? '…'}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
                active && 'bg-primary/10 font-medium text-primary',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
