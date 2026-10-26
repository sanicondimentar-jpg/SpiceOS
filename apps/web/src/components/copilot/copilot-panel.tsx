'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CopilotReply, useConfirmToolCall, useCopilot } from '@/lib/hooks';

type Agent = 'auto' | 'commercial' | 'pricing' | 'purchasing' | 'inventory' | 'collections' | 'executive' | 'documents';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  pending?: CopilotReply['pendingConfirmations'];
  tools?: string[];
}

const AGENTS: { key: Agent; label: string }[] = [
  { key: 'auto', label: 'General' },
  { key: 'commercial', label: 'Comercial' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'purchasing', label: 'Compras' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'collections', label: 'Cobranza' },
  { key: 'executive', label: 'Ejecutivo' },
  { key: 'documents', label: 'Documentos' },
];

const SUGGESTIONS = [
  '¿Qué clientes están en riesgo?',
  '¿Qué oportunidades tengo abiertas?',
  '¿Qué productos son más rentables?',
  '¿Qué clientes no compran hace más de 60 días?',
  'Resumí las conversaciones de WhatsApp de hoy',
];

/** Deduce la entidad de la pantalla actual para que "este cliente" funcione. */
function screenContext(pathname: string) {
  const m = pathname.match(/^\/(customers|orders|products|quotes)\/([0-9a-f-]{36})/);
  const entity = { customers: 'customer', orders: 'order', products: 'product', quotes: 'quote' } as const;
  return m ? { screen: pathname, entityType: entity[m[1] as keyof typeof entity], entityId: m[2] } : { screen: pathname };
}

/** Copiloto disponible desde cualquier pantalla (panel lateral, ⌘K). */
export function CopilotPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [agent, setAgent] = useState<Agent>('auto');
  const [sessionId, setSessionId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const copilot = useCopilot();
  const confirm = useConfirmToolCall();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [turns.length, copilot.isPending]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setTurns((t) => [...t, { role: 'user', text }]);
    setInput('');
    try {
      const reply = await copilot.mutateAsync({ message: text, agent, sessionId, context: screenContext(pathname) });
      setSessionId(reply.sessionId);
      setTurns((t) => [...t, { role: 'assistant', text: reply.text, pending: reply.pendingConfirmations, tools: reply.toolsUsed }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `No pude responder: ${(e as Error).message}` }]);
    }
  };

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-card shadow-xl transition-transform',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-semibold">Copiloto</span>
        <select
          value={agent}
          onChange={(e) => setAgent(e.target.value as Agent)}
          className="ml-2 rounded-md border bg-background px-2 py-1 text-xs"
          aria-label="Agente"
        >
          {AGENTS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Cerrar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground">Preguntame sobre clientes, ventas, stock, cobranza o documentos.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="block w-full rounded-md border px-3 py-2 text-left hover:bg-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn('max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2', t.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted')}>
            {t.text}
            {t.tools && t.tools.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">Consultó: {Array.from(new Set(t.tools)).join(', ')}</div>
            )}
            {t.pending?.map((p) => (
              <div key={p.toolCallId} className="mt-3 rounded-md border bg-card p-3 text-foreground">
                <div className="text-xs font-medium">Acción a confirmar: {p.tool}</div>
                <pre className="mt-1 max-h-32 overflow-auto text-[11px] text-muted-foreground">{JSON.stringify(p.input, null, 2)}</pre>
                <Button size="sm" className="mt-2" disabled={confirm.isPending} onClick={() => confirm.mutate(p.toolCallId)}>
                  <Check className="h-3 w-3" /> Confirmar
                </Button>
              </div>
            ))}
          </div>
        ))}
        {copilot.isPending && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Consultando datos…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ej: generá una cotización de 10 kg de pimentón ahumado para Parrilla Don Julio"
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="icon" disabled={copilot.isPending} aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </aside>
  );
}
