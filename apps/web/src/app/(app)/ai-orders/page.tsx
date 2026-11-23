'use client';

import { useState } from 'react';
import type { AiOrderStatus, AiOrderView } from '@spiceos/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import { useAddInstruction, useAiInstructions, useAiOrders, useRevokeInstruction } from '@/lib/staff';

const STATUS: Record<AiOrderStatus, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }> = {
  DONE: { label: 'Hecha', tone: 'good' },
  AWAITING_CONFIRMATION: { label: 'Esperando el sí', tone: 'warn' },
  CONFIRMED: { label: 'Confirmada', tone: 'good' },
  REJECTED: { label: 'Descartada', tone: 'neutral' },
  EXPIRED: { label: 'Vencida sin confirmar', tone: 'neutral' },
  FAILED: { label: 'Falló', tone: 'bad' },
};

const when = (d: string) =>
  new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

/** Lo que dueños y gerentes le pidieron a la IA por WhatsApp, y las indicaciones que siguen vigentes. */
export default function AiOrdersPage() {
  const { data: me } = useMe();
  const canGive = !!me?.permissions.includes('ai.order.give');
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Órdenes a la IA</h1>
      <p className="text-sm text-muted-foreground">
        Lo que le piden a la IA por WhatsApp quienes tienen su celular vinculado en Configuración → Usuarios y permisos. Cada orden queda con quién la dio,
        cuándo y qué hizo. Ajustar stock, facturar, cambiar precios, cancelar pedidos y mandar mensajes a clientes solo se hacen después de un “sí”.
      </p>
      <Instructions canGive={canGive} />
      <Log />
    </div>
  );
}

function Instructions({ canGive }: { canGive: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useAiInstructions(showAll);
  const revoke = useRevokeInstruction();
  const add = useAddInstruction();
  const [text, setText] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await add.mutateAsync({ text, until: until || null });
      setText('');
      setUntil('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Indicaciones para el asistente de ventas</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Ver solo las vigentes' : 'Ver también las cortadas'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">El asistente de WhatsApp las sigue al atender a los clientes, hasta la fecha de fin o hasta que las cortes.</p>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : !data?.length ? (
          <p className="text-muted-foreground">No hay indicaciones {showAll ? '' : 'vigentes'}.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className={i.active ? '' : 'text-muted-foreground line-through'}>{i.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.createdBy} · {when(i.createdAt)} · {i.source === 'whatsapp' ? 'por WhatsApp' : 'desde SpiceOS'}
                    {i.until && ` · hasta el ${i.until.split('-').reverse().join('/')}`}
                    {i.revokedAt && ` · cortada por ${i.revokedBy ?? '—'} el ${when(i.revokedAt)}`}
                    {!i.active && !i.revokedAt && ' · vencida'}
                  </div>
                </div>
                {i.active && canGive && (
                  <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                    Cortar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canGive && (
          <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Nueva indicación" htmlFor="ins-text">
              <Input id="ins-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: esta semana ofrecé el Combo Esencial a los minoristas" maxLength={500} />
            </Field>
            <Field label="Hasta (opcional)" htmlFor="ins-until">
              <Input id="ins-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
            <Button type="submit" disabled={text.trim().length < 3 || add.isPending}>
              Agregar
            </Button>
            {error && <p className="text-xs text-destructive sm:col-span-3">{error}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Log() {
  const [userId, setUserId] = useState('');
  const { data, isLoading } = useAiOrders(userId || undefined);
  const { data: all } = useAiOrders();
  const people = [...new Map((all ?? []).map((o) => [o.user.id, o.user.name])).entries()];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Registro de órdenes</CardTitle>
        {people.length > 1 && (
          <Select aria-label="Filtrar por persona" className="w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todas las personas</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !data?.length ? (
          <p className="text-muted-foreground">
            Todavía no hay órdenes. Para dar una, escribile al WhatsApp de la empresa desde el celular vinculado a tu usuario.
          </p>
        ) : (
          data.map((o) => <OrderRow key={o.id} order={o} />)
        )}
      </CardContent>
    </Card>
  );
}

function OrderRow({ order: o }: { order: AiOrderView }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[o.status] ?? STATUS.DONE;
  const actions = o.actions.filter((a) => !a.summary.startsWith('Consultó') && !a.summary.startsWith('Buscó'));
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{o.user.name}</span>
        <span>{when(o.createdAt)}</span>
        <Badge tone={s.tone}>{s.label}</Badge>
        {o.confirmedAt && <span>confirmada {when(o.confirmedAt)}</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{o.request}</p>
      {o.pending && (
        <p className="mt-1 text-xs">
          <span className="font-medium">Acción delicada:</span> {o.pending.summary}
        </p>
      )}
      {actions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {actions.map((a, i) => (
            <li key={i} className={a.ok ? '' : 'text-destructive'}>
              {a.ok ? '✓' : '✗'} {a.summary}
            </li>
          ))}
        </ul>
      )}
      {o.reply && (
        <div className="mt-2">
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar respuesta' : 'Ver respuesta de la IA'}
          </button>
          {open && <p className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{o.reply}</p>}
        </div>
      )}
    </div>
  );
}
