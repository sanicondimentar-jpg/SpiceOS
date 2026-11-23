'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Bot, Boxes, ClipboardList, FileText, Tags, Upload, LayoutDashboard, Menu, MessageCircle, Package, Receipt, Settings, ShoppingCart, Truck, Users, Wallet, Workflow, Target,
} from 'lucide-react';
import { InstallAppButton } from './pwa';
import { usePendingReceipts } from '@/lib/receipts';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/hooks';
import { useOrders } from '@/lib/orders';
import { useUnreadChats } from '@/lib/messaging';

export const NAV = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/inbox', label: 'WhatsApp', icon: MessageCircle, perm: 'messaging.conversation.read' },
  { href: '/customers', label: 'Clientes', icon: Users, perm: 'crm.customer.read' },
  { href: '/sales', label: 'Ventas', icon: Target, perm: 'sales.opportunity.read' },
  { href: '/orders', label: 'Pedidos', icon: ShoppingCart, perm: 'orders.order.read' },
  { href: '/products', label: 'Productos', icon: Package, perm: 'catalog.product.read' },
  { href: '/price-lists', label: 'Listas de precios', icon: Tags, perm: 'catalog.product.read' },
  { href: '/inventory', label: 'Inventario', icon: Boxes, perm: 'inventory.stock.read' },
  { href: '/purchases', label: 'Compras', icon: ClipboardList, perm: 'purchasing.order.read' },
  { href: '/logistics', label: 'Logística', icon: Truck, perm: 'orders.order.read' },
  { href: '/invoices', label: 'Facturas', icon: Receipt, perm: 'invoicing.invoice.read' },
  { href: '/receivables', label: 'Cobranza', icon: Wallet, perm: 'receivables.account.read' },
  { href: '/documents', label: 'Documentos', icon: FileText, perm: 'documents.document.read' },
  { href: '/automation', label: 'Automatizaciones', icon: Workflow, perm: 'automation.rule.read' },
  { href: '/analytics', label: 'Inteligencia', icon: BarChart3, perm: 'analytics.executive.read' },
  { href: '/ai-orders', label: 'Órdenes a la IA', icon: Bot, perm: 'ai.order.read' },
  { href: '/imports', label: 'Importar', icon: Upload, perm: 'crm.customer.write' },
  { href: '/settings', label: 'Configuración', icon: Settings, perm: 'core.settings.manage' },
];

/**
 * El menú se arma con los permisos del usuario: lo que no puede usar, no lo ve.
 * En el celular queda oculto y se abre como panel con el botón de la barra superior.
 */
type Badge = { count: number; label: string; tone: 'primary' | 'warning' };
const BADGE_TONE = { primary: 'bg-primary text-primary-foreground', warning: 'bg-warning text-white' };

/** Menú según los permisos del usuario y los avisos (chats sin leer, pedidos web por revisar, remitos por confirmar). */
export function useNav() {
  const { data: me } = useMe();
  const items = NAV.filter((i) => !i.perm || me?.permissions.includes(i.perm));
  const { data: pending } = useOrders({ status: 'PENDING_REVIEW', q: '' }, !!me?.permissions.includes('orders.order.read'));
  const { data: receipts } = usePendingReceipts(!!me?.permissions.includes('inventory.stock.read'));
  const { data: chats } = useUnreadChats(!!me?.permissions.includes('messaging.conversation.read'));
  const badges: Record<string, Badge | undefined> = {
    '/inbox': chats?.unread ? { count: chats.unread, label: `${chats.unread} mensajes sin leer`, tone: 'primary' } : undefined,
    '/inventory': receipts?.length ? { count: receipts.length, label: `${receipts.length} remitos por confirmar`, tone: 'warning' } : undefined,
    '/orders': pending?.length ? { count: pending.length, label: `${pending.length} por revisar`, tone: 'warning' } : undefined,
  };
  return { me, items, badges };
}

export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { me, items, badges } = useNav();
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'w-60 shrink-0 flex-col border-r bg-card print:hidden',
          mobileOpen ? 'fixed inset-y-0 left-0 z-50 flex pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl' : 'hidden',
          'md:static md:z-auto md:flex md:shadow-none',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" className="h-8 w-8" />
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
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground md:py-2 hover:bg-accent hover:text-foreground',
                  active && 'bg-primary/10 font-medium text-primary',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {badges[href] && (
                  <span className={cn('ml-auto rounded-full px-1.5 text-xs font-semibold', BADGE_TONE[badges[href]!.tone])} aria-label={badges[href]!.label}>{badges[href]!.count}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <InstallAppButton />
      </aside>
    </>
  );
}

/** Accesos de la barra de abajo en el celular, en orden de prioridad; se muestran los 4 primeros que el usuario puede usar. */
const TABS = ['/', '/orders', '/inbox', '/inventory', '/customers'];
const TAB_LABEL: Record<string, string> = { '/': 'Inicio' };

/**
 * Barra de abajo en el celular (como en una app): lo que más se usa en la calle o el depósito a un toque,
 * con los avisos. "Más" abre el menú completo.
 */
export function BottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { items, badges } = useNav();
  const tabs = TABS.map((h) => items.find((i) => i.href === h)).filter((i): i is (typeof NAV)[number] => !!i).slice(0, 4);
  const inTabs = tabs.some(({ href }) => (href === '/' ? pathname === '/' : pathname.startsWith(href)));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      aria-label="Accesos rápidos"
    >
      <div className="grid h-16 grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const badge = badges[href];
          return (
            <Link
              key={href}
              href={href}
              className={cn('flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground', active && 'font-medium text-primary')}
              aria-current={active ? 'page' : undefined}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge && (
                  <span className={cn('absolute -right-2.5 -top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full px-1 text-[10px] font-semibold', BADGE_TONE[badge.tone])} aria-label={badge.label}>
                    {badge.count > 99 ? '99+' : badge.count}
                  </span>
                )}
              </span>
              {TAB_LABEL[href] ?? label}
            </Link>
          );
        })}
        <button
          onClick={onMore}
          className={cn('flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground', !inTabs && 'font-medium text-primary')}
        >
          <Menu className="h-5 w-5" />
          Más
        </button>
      </div>
    </nav>
  );
}
