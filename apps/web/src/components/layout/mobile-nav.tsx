'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Menu, MessageCircle, ShoppingCart, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/hooks';
import { useUnreadChats } from '@/lib/messaging';
import { useOrders } from '@/lib/orders';

const ITEMS = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/inbox', label: 'WhatsApp', icon: MessageCircle, perm: 'messaging.conversation.read' },
  { href: '/orders', label: 'Pedidos', icon: ShoppingCart, perm: 'orders.order.read' },
  { href: '/customers', label: 'Clientes', icon: Users, perm: 'crm.customer.read' },
  { href: '/receivables', label: 'Cobranza', icon: Wallet, perm: 'receivables.account.read' },
];

/**
 * Barra de abajo en el celular, al alcance del pulgar: las pantallas de todos los días según los
 * permisos del usuario, y "Más" para el menú completo.
 */
export function MobileNav({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const can = (perm?: string) => !perm || !!me?.permissions.includes(perm);
  const items = ITEMS.filter((i) => can(i.perm)).slice(0, 4);
  const { data: chats } = useUnreadChats(can('messaging.conversation.read'));
  const { data: pending } = useOrders({ status: 'PENDING_REVIEW', q: '' }, can('orders.order.read'));
  const badge = (href: string) => (href === '/inbox' ? chats?.unread : href === '/orders' ? pending?.length : 0) || 0;

  return (
    <nav
      className="flex shrink-0 border-t bg-card md:hidden print:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Accesos rápidos"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const n = badge(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground', active && 'font-medium text-primary')}
          >
            <Icon className="h-5 w-5" />
            {label}
            {n > 0 && (
              <span className="absolute right-[calc(50%-1.25rem)] top-1 min-w-[1.1rem] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground">
                {n > 99 ? '99+' : n}
              </span>
            )}
          </Link>
        );
      })}
      <button onClick={onMenu} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
        <Menu className="h-5 w-5" />
        Más
      </button>
    </nav>
  );
}
