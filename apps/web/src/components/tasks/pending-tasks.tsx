'use client';

import { useState } from 'react';
import { Check, ListTodo, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { date } from '@/lib/utils';
import { useCompleteTask, useCreateTask, useOpenTasks } from '@/lib/tasks';

/** Tarjeta "Pendientes" de Inicio: tareas abiertas de la empresa, para tildar cuando se hacen. */
export function PendingTasks({ userId }: { userId?: string }) {
  const { data: tasks } = useOpenTasks();
  const create = useCreateTask();
  const complete = useCompleteTask();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return;
    create.mutate({ title: title.trim(), assigneeId: userId ?? null }, { onSuccess: () => { setTitle(''); setAdding(false); } });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="h-4 w-4" /> Pendientes {tasks?.length ? `(${tasks.length})` : ''}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
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
    </Card>
  );
}
