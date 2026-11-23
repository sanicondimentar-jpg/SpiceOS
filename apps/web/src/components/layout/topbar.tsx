'use client';

import Link from 'next/link';
import { Bell, LogOut, Menu, Search, Sparkles } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/hooks';
import { useAlerts } from '@/lib/automation';

export function Topbar({ onCopilot, onMenu }: { onCopilot: () => void; onMenu: () => void }) {
  const { data: me } = useMe();
  const { data: alerts } = useAlerts();
  const urgent = alerts?.items.filter((a) => a.severity !== 'low').length ?? 0;
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-card px-4 print:hidden">
      <Button variant="ghost" size="icon" aria-label="Menú" className="md:hidden" onClick={onMenu}>
        <Menu className="h-5 w-5" />
      </Button>
      <button
        onClick={onCopilot}
        className="flex h-9 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-left text-sm text-muted-foreground md:max-w-md"
      >
        <Search className="h-4 w-4" />
        Buscar o preguntarle al copiloto…
        <kbd className="ml-auto rounded border px-1.5 text-[10px]">⌘K</kbd>
      </button>
      <Button variant="secondary" size="sm" onClick={onCopilot}>
        <Sparkles className="h-4 w-4" /> Copiloto
      </Button>
      <Button asChild variant="ghost" size="icon" className="relative" title="Avisos">
        <Link href="/automation" aria-label={urgent ? `Avisos: ${urgent} para revisar` : 'Avisos'}>
          <Bell className="h-4 w-4" />
          {!!urgent && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {urgent > 99 ? '99+' : urgent}
            </span>
          )}
        </Link>
      </Button>
      <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-semibold" title={me?.user.fullName}>
        {me?.user.fullName?.slice(0, 2).toUpperCase() ?? '··'}
      </div>
      <Button variant="ghost" size="icon" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => void signOut({ callbackUrl: '/login' })}>
        <LogOut className="h-4 w-4" />
      </Button>
    </header>
  );
}
