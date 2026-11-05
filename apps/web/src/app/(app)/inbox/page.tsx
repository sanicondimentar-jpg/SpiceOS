'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Archive, ArchiveRestore, Check, CheckCheck, Clock, Link2, Search, Send, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaPreview } from '@/components/messaging/media-preview';
import { useCustomers, useMe } from '@/lib/hooks';
import {
  TYPE_LABEL,
  useConversation,
  useConversations,
  useCreateCustomerFromChat,
  useMarkRead,
  useSendMessage,
  useUpdateConversation,
  type ChatMessage,
  type ConversationDetail,
  type ConversationRow,
} from '@/lib/messaging';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/orders';
import { cn, date, money } from '@/lib/utils';

export default function InboxPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const router = useRouter();
  const selected = useSearchParams().get('c');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const { data, isLoading } = useConversations(q, status);
  const { data: me } = useMe();
  const markRead = useMarkRead();
  const select = (id: string | null) => router.replace(id ? `/inbox?c=${id}` : '/inbox', { scroll: false });

  // Al abrir un chat (o si llegan mensajes mientras está abierto) queda leído.
  const row = data?.items.find((c) => c.id === selected);
  useEffect(() => {
    if (row && row.unreadCount > 0 && !markRead.isPending) markRead.mutate(row.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.unreadCount]);

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] md:-m-6">
      <aside className={cn('flex w-full flex-col border-r bg-card md:w-80 md:shrink-0', selected && 'hidden md:flex')}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">WhatsApp</h1>
            {!!data?.unread && <Badge tone="brand">{data.unread} sin leer</Badge>}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {(['OPEN', 'CLOSED'] as const).map((s) => (
              <Button key={s} size="sm" variant={status === s ? 'secondary' : 'ghost'} onClick={() => setStatus(s)}>
                {s === 'OPEN' ? 'Abiertos' : 'Archivados'}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <Skeleton className="m-3 h-40" />}
          {data && !data.items.length && (
            <p className="p-4 text-sm text-muted-foreground">
              {q ? 'No hay chats que coincidan.' : status === 'OPEN' ? 'Todavía no llegaron mensajes.' : 'No hay chats archivados.'}
              {!q && status === 'OPEN' && me?.permissions.includes('core.settings.manage') && (
                <> Si todavía no conectaste el número, hacelo en <Link className="text-primary hover:underline" href="/settings/whatsapp">Configuración → WhatsApp</Link>.</>
              )}
            </p>
          )}
          {data?.items.map((c) => <ConversationItem key={c.id} c={c} active={c.id === selected} onClick={() => select(c.id)} />)}
        </div>
      </aside>
      <section className={cn('min-w-0 flex-1', !selected && 'hidden md:block')}>
        {selected ? (
          <Chat id={selected} onBack={() => select(null)} />
        ) : (
          <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">Elegí un chat para verlo y responder.</div>
        )}
      </section>
    </div>
  );
}

function ConversationItem({ c, active, onClick }: { c: ConversationRow; active: boolean; onClick: () => void }) {
  const preview = c.lastMessage ? c.lastMessage.text ?? TYPE_LABEL[c.lastMessage.type] ?? c.lastMessage.type : '';
  return (
    <button onClick={onClick} className={cn('flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left hover:bg-accent', active && 'bg-primary/10')}>
      <div className="flex items-center gap-2">
        <span className={cn('truncate text-sm', c.unreadCount ? 'font-semibold' : 'font-medium')}>{c.customer?.name ?? c.contactName ?? formatPhone(c.phone)}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{c.lastMessageAt && when(c.lastMessageAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {c.lastMessage?.direction === 'OUTBOUND' && 'Vos: '}
          {preview}
        </span>
        {!!c.unreadCount && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{c.unreadCount}</span>}
      </div>
      {!c.customer && <span className="text-[11px] text-warning">Sin cliente vinculado</span>}
    </button>
  );
}

function Chat({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: c, isLoading, error } = useConversation(id);
  const { data: me } = useMe();
  const canSend = !!me?.permissions.includes('messaging.message.send');
  const bottom = useRef<HTMLDivElement>(null);
  const last = c?.messages.at(-1)?.id;
  // Con llaves: en Chrome nuevo scrollIntoView devuelve una promesa, y React la tomaría como limpieza y se rompe.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [last, id]);

  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (isLoading || !c) return <Skeleton className="m-6 h-96" />;
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader c={c} onBack={onBack} canSend={canSend} />
        <details className="border-b bg-card lg:hidden">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground">
            {c.customer ? `Cliente y pedidos de ${c.customer.name}` : 'Vincular a un cliente'}
          </summary>
          <CustomerPanel c={c} className="pt-0" />
        </details>
        <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
          {c.messages.map((m, i) => (
            <div key={m.id}>
              {(i === 0 || day(c.messages[i - 1].sentAt) !== day(m.sentAt)) && (
                <div className="my-2 text-center text-xs text-muted-foreground">{date(m.sentAt)}</div>
              )}
              <Bubble m={m} />
            </div>
          ))}
          <div ref={bottom} />
        </div>
        {canSend && <Composer c={c} />}
      </div>
      <CustomerPanel c={c} className="hidden w-72 shrink-0 border-l bg-card lg:block" />
    </div>
  );
}

function ChatHeader({ c, onBack, canSend }: { c: ConversationDetail; onBack: () => void; canSend: boolean }) {
  const update = useUpdateConversation(c.id);
  const closed = c.status === 'CLOSED';
  return (
    <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Volver" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
      <div className="min-w-0">
        <div className="truncate font-medium">{c.customer?.name ?? c.contactName ?? formatPhone(c.phone)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatPhone(c.phone)}
          {c.contactName && c.customer && c.contactName !== c.customer.name && ` · ${c.contactName}`}
        </div>
      </div>
      {canSend && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={update.isPending}
          onClick={() => update.mutate({ status: closed ? 'OPEN' : 'CLOSED' })}
          title={closed ? 'Volver a abiertos' : 'Archivar: si el cliente vuelve a escribir, se abre solo'}
        >
          {closed ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {closed ? 'Desarchivar' : 'Archivar'}
        </Button>
      )}
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const out = m.direction === 'OUTBOUND';
  const label = TYPE_LABEL[m.type];
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm', out ? 'bg-primary/15' : 'bg-card')}>
        {m.hasMedia && <MediaPreview messageId={m.id} type={m.type} />}
        {!m.text && !m.hasMedia && label && <span className="italic text-muted-foreground">{label}</span>}
        {!m.text && !m.hasMedia && !label && <span className="italic text-muted-foreground">Mensaje de tipo «{m.type}» (abrilo en el celular)</span>}
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        {m.transcript && <p className="mt-1 whitespace-pre-wrap border-l-2 pl-2 text-xs text-muted-foreground">Transcripción: {m.transcript}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {out && m.sentBy && <span>{m.sentBy} ·</span>}
          <span>{new Date(m.sentAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
          {out && <StatusIcon status={m.status} />}
        </div>
        {m.status === 'FAILED' && <p className="text-xs text-destructive">No se entregó{m.error && `: ${m.error}`}</p>}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'READ') return <CheckCheck className="h-3.5 w-3.5 text-primary" aria-label="Leído" />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3.5 w-3.5" aria-label="Entregado" />;
  if (status === 'FAILED') return <X className="h-3.5 w-3.5 text-destructive" aria-label="No se entregó" />;
  if (status === 'SENT') return <Check className="h-3.5 w-3.5" aria-label="Enviado" />;
  return <Clock className="h-3.5 w-3.5" />;
}

function Composer({ c }: { c: ConversationDetail }) {
  const send = useSendMessage(c.id);
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim() || send.isPending) return;
    send.mutate(text.trim(), { onSuccess: () => setText('') });
  };
  if (!c.windowOpen) {
    return (
      <div className="border-t bg-card p-3 text-sm text-muted-foreground">
        Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp no deja escribirle desde el sistema hasta que vuelva a escribir
        (desde el celular sí podés).
      </div>
    );
  }
  return (
    <div className="border-t bg-card p-3">
      {send.error && <p className="mb-2 text-sm text-destructive">{send.error.message}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Escribí una respuesta (Enter envía, Shift+Enter baja de renglón)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label="Enviar" disabled={!text.trim() || send.isPending}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}

function CustomerPanel({ c, className }: { c: ConversationDetail; className?: string }) {
  const { data: me } = useMe();
  const can = (p: string) => !!me?.permissions.includes(p);
  const [linking, setLinking] = useState(false);
  const update = useUpdateConversation(c.id);
  const create = useCreateCustomerFromChat(c.id);
  const error = update.error?.message ?? create.error?.message;

  return (
    <div className={cn('space-y-4 overflow-y-auto p-4', className)}>
      <div className="space-y-2">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">Cliente</h2>
        {c.customer ? (
          <div className="space-y-1 text-sm">
            <Link href={`/customers/${c.customer.id}`} className="font-medium hover:underline">{c.customer.name}</Link>
            <div className="text-xs text-muted-foreground">{c.customer.code}{c.customer.status === 'PROSPECT' && ' · prospecto'}</div>
            {can('messaging.message.send') && !linking && (
              <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setLinking(true)}><Link2 className="h-4 w-4" /> Cambiar cliente</Button>
            )}
          </div>
        ) : (
          !linking && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Este número no está en ningún cliente.</p>
              <div className="flex flex-wrap gap-2">
                {can('messaging.message.send') && <Button size="sm" variant="outline" onClick={() => setLinking(true)}><Link2 className="h-4 w-4" /> Vincular</Button>}
                {can('crm.customer.write') && (
                  <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}><UserPlus className="h-4 w-4" /> Crear cliente</Button>
                )}
              </div>
            </div>
          )
        )}
        {linking && (
          <CustomerPicker
            onPick={(customerId) => update.mutate({ customerId }, { onSuccess: () => setLinking(false) })}
            onCancel={() => setLinking(false)}
          />
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {c.customer && (
        <div className="space-y-2">
          <div className="flex items-center">
            <h2 className="text-xs font-medium uppercase text-muted-foreground">Pedidos</h2>
            {can('orders.order.write') && (
              <Link
                className="ml-auto text-xs text-primary hover:underline"
                href={`/orders/new?customerId=${c.customer.id}&customerName=${encodeURIComponent(c.customer.name)}`}
              >
                + Nuevo pedido
              </Link>
            )}
          </div>
          {!c.orders.length && <p className="text-sm text-muted-foreground">Sin pedidos todavía.</p>}
          {c.orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="block rounded-md border p-2 text-sm hover:bg-accent">
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.number}</span>
                <Badge tone={STATUS_TONE[o.status]} className="ml-auto">{STATUS_LABEL[o.status]}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{date(o.createdAt)} · {money(o.total)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerPicker({ onPick, onCancel }: { onPick: (id: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const { data } = useCustomers(q, 1);
  return (
    <Card>
      <CardContent className="space-y-2 p-2">
        <Input autoFocus placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-56 overflow-y-auto">
          {data?.items.slice(0, 10).map((cu) => (
            <button key={cu.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => onPick(cu.id)}>
              {cu.tradeName ?? cu.legalName}
              <span className="block text-xs text-muted-foreground">{cu.code}{cu.phone && ` · ${cu.phone}`}</span>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
      </CardContent>
    </Card>
  );
}

const day = (d: string) => new Date(d).toDateString();

function when(d: string) {
  const t = new Date(d);
  return day(d) === new Date().toDateString() ? t.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : t.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

/** +5491170580234 → +54 9 11 7058-0234 */
function formatPhone(p: string) {
  const m = p.match(/^\+?549(11|\d{2,4})(\d{3,4})(\d{4})$/);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : p;
}
