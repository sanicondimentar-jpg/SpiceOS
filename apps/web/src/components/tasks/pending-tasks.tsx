'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, ListTodo, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { date } from '@/lib/utils';
import { useCompleteTask, useCreateTask, useOpenTasks } from '@/lib/tasks';

const OPEN_KEY = 'spiceos.pendientes.abierto';

/**
 * Tarjeta "Pendientes" de Inicio: tareas abiertas de la empresa, para tildar cuando se hacen.
 * Desplegable: arranca cerrada (una sola línea) y recuerda en el navegador si la dejaste abierta.
 */
export function PendingTasks({ userId }: { userId?: string }) {
  const { data: tasks } = useOpenTasks();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpenState] = useState(false);

  useEffect(() => {
    try {
      setOpenState(window.localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      /* sin almacenamiento: queda cerrada */
    }
  }, []);

  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v) setAdding(false);
    try {
      window.localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* no pasa nada */
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return;
    create.mutate({ title: title.trim(), assigneeId: userId ?? null }, { onSuccess: () => { setTitle(''); setAdding(false); } });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="pendientes-lista"
          title={open ? 'Contraer' : 'Ver pendientes'}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
        >
          <ListTodo className="h-4 w-4 shrink-0" />
          <CardTitle className="shrink-0">Pendientes</CardTitle>
          {!!tasks?.length && (
            <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">{tasks.length}</span>
          )}
          {!open && tasks?.[0] && <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {tasks[0].title}</span>}
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true);
            setAdding((v) => !open || !v);
          }}
        >
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </CardHeader>
      {open && (
        <CardContent id="pendientes-lista" className="space-y-3">
          {adding && (
            <form onSubmit={add} className="flex gap-2">
              <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué hay que hacer?" maxLength={200} />
              <Button type="submit" size="sm" disabled={create.isPending || title.trim().length < 3}>Guardar</Button>
            </form>
          )}
          {!tasks?.length && !adding && <p className="text-sm text-muted-foreground">No hay tareas pendientes.</p>}
          {tasks?.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-md border p-3">
              <button
                type="button"
                aria-label="Marcar como hecha"
                title="Marcar como hecha"
                disabled={complete.isPending}
                onClick={() => complete.mutate(t.id)}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-input hover:bg-accent"
              >
                <Check className="h-3 w-3 opacity-0 hover:opacity-60" />
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${t.priority === 'HIGH' || t.priority === 'URGENT' ? 'text-warning' : ''}`}>{t.title}</p>
                {t.description && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{t.description}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t.assigneeName ? `Para ${t.assigneeName.split(' ')[0]}` : 'Sin asignar'} · desde el {date(t.createdAt)}
                  {t.dueAt ? ` · vence ${date(t.dueAt)}` : ''}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
