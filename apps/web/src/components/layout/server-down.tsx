'use client';

import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/hooks';

/**
 * Si la API no contesta (caída o reiniciándose) la web no puede saber los permisos y el menú queda vacío,
 * con todo en $0. En vez de eso se avisa que no hay conexión con el servidor y se ofrece reintentar.
 * (Una sesión vencida da 401 y ya vuelve sola al login.)
 */
export function ServerDown() {
  const qc = useQueryClient();
  const { isError, isFetching } = useMe();
  if (!isError) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive print:hidden">
      <span className="flex-1">
        No hay conexión con el servidor del sistema, por eso no se ven el menú ni los datos. Probá de nuevo en un rato; si sigue igual, avisá.
      </span>
      <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => void qc.invalidateQueries()}>
        <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Reintentar
      </Button>
    </div>
  );
}
