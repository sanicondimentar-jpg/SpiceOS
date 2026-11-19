'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/receipts';
import { date } from '@/lib/utils';

/** Claves para que Claude (u otra integración) deje remitos por confirmar. La clave se ve una sola vez. */
export default function ApiKeysPage() {
  const { data, isLoading } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState('Claude');
  const [copied, setCopied] = useState(false);
  const newKey = create.data?.key;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <h1 className="text-2xl font-semibold">Claves de acceso</h1>
      <p className="text-sm text-muted-foreground">
        Con una clave, Claude puede leer la foto de un remito de compra que le mandes en el chat y dejarlo en Inventario → Ingresar mercadería
        como <strong>remito por confirmar</strong>. La clave no sirve para nada más: no ve clientes, precios ni stock, y no suma mercadería sin que alguien la confirme.
      </p>

      <Card>
        <CardHeader><CardTitle>Nueva clave</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nombre (para reconocerla)" htmlFor="key-name" className="min-w-60 flex-1">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => { setCopied(false); create.mutate(name.trim()); }}>Crear clave</Button>
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          {newKey && (
            <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              <p className="font-medium">Copiala ahora: no se vuelve a mostrar.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">{newKey}</code>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(newKey).then(() => setCopied(true))}>
                  <Copy className="mr-1 h-4 w-4" />{copied ? 'Copiada' : 'Copiar'}
                </Button>
              </div>
              <p className="text-muted-foreground">
                Guardala como secreto del entorno de Claude (variable <code>SPICEOS_API_KEY</code>), no la pegues en el chat.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Claves creadas</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <Skeleton className="h-20 w-full" />}
          {data && !data.length && <p className="text-sm text-muted-foreground">Todavía no hay claves.</p>}
          <ul className="divide-y text-sm">
            {data?.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{k.name}</span>
                <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                {k.revokedAt ? <Badge tone="bad">Revocada</Badge> : <Badge tone="good">Activa</Badge>}
                <span className="text-xs text-muted-foreground">
                  Creada {date(k.createdAt)}{k.lastUsedAt ? ` · usada ${date(k.lastUsedAt)}` : ' · sin usar'}
                </span>
                {!k.revokedAt && (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={revoke.isPending} onClick={() => confirm(`¿Revocar la clave "${k.name}"? Deja de funcionar en el momento.`) && revoke.mutate(k.id)}>
                    Revocar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
