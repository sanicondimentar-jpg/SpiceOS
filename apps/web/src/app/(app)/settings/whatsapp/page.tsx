'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSaveWhatsappAccount, useWhatsappAccount } from '@/lib/messaging';
import { date } from '@/lib/utils';

export default function WhatsappSettingsPage() {
  const { data, isLoading } = useWhatsappAccount();
  const save = useSaveWhatsappAccount();
  const a = data?.account;
  const [v, setV] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '', autoCreateCustomer: false });
  useEffect(() => {
    if (a) setV((x) => ({ ...x, phoneNumberId: a.phoneNumberId, wabaId: a.wabaId, autoCreateCustomer: a.autoCreateCustomer }));
  }, [a]);

  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  const ready = /^\d{5,}$/.test(v.phoneNumberId) && /^\d{5,}$/.test(v.wabaId) && (!!a || (!!v.accessToken && !!v.appSecret));
  const subscribeError = save.data?.subscribeError;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        {a?.connectedAt ? <Badge tone="good">Conectado</Badge> : a ? <Badge tone="warn">Falta terminar</Badge> : <Badge>Sin conectar</Badge>}
      </div>

      {a && (
        <Card>
          <CardContent className="space-y-1 p-5 text-sm">
            <div><span className="text-muted-foreground">Número: </span><span className="font-medium">{a.displayPhone}</span>{a.verifiedName && ` · ${a.verifiedName}`}</div>
            {a.connectedAt && <div className="text-muted-foreground">Conectado el {date(a.connectedAt)}</div>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>1. Datos de Meta</CardTitle>
          <p className="text-sm text-muted-foreground">
            Están en developers.facebook.com → tu app → WhatsApp → Configuración de la API, y en Configuración de la app → Básica.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Identificador del número de teléfono" htmlFor="w-phone">
            <Input id="w-phone" inputMode="numeric" value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value.trim() })} />
          </Field>
          <Field label="Identificador de la cuenta de WhatsApp Business" htmlFor="w-waba">
            <Input id="w-waba" inputMode="numeric" value={v.wabaId} onChange={(e) => setV({ ...v, wabaId: e.target.value.trim() })} />
          </Field>
          <Field label="Token de acceso (permanente, de usuario del sistema)" htmlFor="w-token" hint={a ? 'Dejalo vacío para mantener el que está guardado.' : undefined} className="sm:col-span-2">
            <Input id="w-token" type="password" autoComplete="off" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value })} />
          </Field>
          <Field label="Clave secreta de la app (App secret)" htmlFor="w-secret" hint={a?.hasAppSecret ? 'Dejala vacía para mantener la que está guardada.' : undefined} className="sm:col-span-2">
            <Input id="w-secret" type="password" autoComplete="off" value={v.appSecret} onChange={(e) => setV({ ...v, appSecret: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={v.autoCreateCustomer} onChange={(e) => setV({ ...v, autoCreateCustomer: e.target.checked })} />
            <span>
              Crear un cliente (prospecto) automáticamente cuando escribe un número nuevo.
              <span className="block text-xs text-muted-foreground">Si no, el chat queda sin cliente y lo vinculás o lo creás desde la bandeja.</span>
            </span>
          </label>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            {save.error && <p className="mr-auto text-sm text-destructive">{save.error.message}</p>}
            {save.isSuccess && !subscribeError && <p className="mr-auto text-sm text-success">Guardado y comprobado con Meta.</p>}
            <Button
              disabled={!ready || save.isPending}
              onClick={() =>
                save.mutate(
                  { ...v, accessToken: v.accessToken || undefined, appSecret: v.appSecret || undefined },
                  { onSuccess: () => setV((x) => ({ ...x, accessToken: '', appSecret: '' })) },
                )
              }
            >
              {save.isPending ? 'Comprobando con Meta…' : 'Guardar y comprobar'}
            </Button>
          </div>
          {subscribeError && (
            <p className="text-sm text-warning sm:col-span-2">
              Se guardó, pero Meta no dejó suscribir la app a la cuenta: {subscribeError}. Revisá que el token tenga el permiso whatsapp_business_management.
            </p>
          )}
        </CardContent>
      </Card>

      {a?.verifyToken && (
        <Card>
          <CardHeader>
            <CardTitle>2. Webhook en Meta</CardTitle>
            <p className="text-sm text-muted-foreground">
              En la app de Meta → WhatsApp → Configuración → Webhook → Editar, pegá estos dos datos, tocá «Verificar y guardar» y después
              suscribite a los campos <b>messages</b> y <b>smb_message_echoes</b> (este último trae lo que respondés desde el celular).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyField label="URL de devolución de llamada" value={data.webhookUrl} />
            <CopyField label="Token de verificación" value={a.verifyToken} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} htmlFor={label}>
      <div className="flex gap-2">
        <Input id={label} readOnly value={value} className="font-mono text-xs" />
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copiar ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {copied && <p className="text-xs text-success">Copiado</p>}
    </Field>
  );
}
