'use client';

import { Bell, Menu, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/hooks';

export function Topbar({ onCopilot, onMenu }: { onCopilot: () => void; onMenu: () => void }) {
  const { data: me } = useMe();
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
      <Button variant="ghost" size="icon" aria-label="Notificaciones" className="relative">
        <Bell className="h-4 w-4" />
        {!!me?.unreadNotifications && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-label={`${me.unreadNotifications} sin leer`} />
        )}
      </Button>
      <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-semibold" title={me?.user.fullName}>
        {me?.user.fullName?.slice(0, 2).toUpperCase() ?? '··'}
      </div>
    </header>
  );
}
