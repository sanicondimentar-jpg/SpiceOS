'use client';

import { useState } from 'react';
import { Check, Copy, Globe, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePortalAccess, useRevokePortal } from '@/lib/crm';
import { date } from '@/lib/utils';

/**
 * Portal de clientes mayoristas en la ficha: cómo invitarlo y quién entró.
 * El cliente entra con el WhatsApp de su ficha (o de un contacto), sin contraseña.
 */
export function PortalCard({ customerId, phone, canWrite }: { customerId: string; phone: string | null; canWrite: boolean }) {
  const { data } = usePortalAccess(customerId);
  const revoke = useRevokePortal(customerId);
  const [copied, setCopied] = useState(false);
  const url = data?.portalUrl ?? 'https://www.saboracasa.com.ar/mayoristas';
  const invite = `¡Hola! Ya podés ver tus precios, hacer y repetir pedidos, seguirlos y ver tu cuenta en ${url}. Entrás con tu WhatsApp, sin contraseña. Desde el celular lo podés instalar como una app.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copiá la invitación', invite);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> Portal de clientes</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {phone
            ? <>Entra en <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">saboracasa.com.ar/mayoristas</a> mandando un código desde el WhatsApp {phone} (o el de un contacto de la ficha).</>
            : 'Para entrar al portal necesita un teléfono en la ficha: entra mandando un código desde ese WhatsApp.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiada' : 'Copiar invitación'}
        </Button>
        {data && (
          data.sessions.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Sesiones abiertas</p>
              {data.sessions.map((s) => (
                <div key={s.id} className="flex justify-between gap-2 text-xs">
                  <span>{s.phone}</span>
                  <span className="text-muted-foreground">último uso {date(s.lastSeenAt)}</span>
                </div>
              ))}
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => { if (window.confirm('¿Cerrar todas las sesiones del portal de este cliente? Va a tener que entrar de nuevo con su WhatsApp.')) revoke.mutate(); }}
                >
                  <LogOut className="h-4 w-4" /> Cerrar sesiones
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Todavía no entró al portal.</p>
          )
        )}
      </CardContent>
    </Card>
  );
}
