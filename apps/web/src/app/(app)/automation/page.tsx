'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ALERT_INFO, ALERT_ORDER, useAlerts, useSaveAlertSettings, type Alert, type AlertKind } from '@/lib/automation';
import { useCollectionSettings } from '@/lib/collections';
import { useMe } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const TONE: Record<Alert['severity'], 'bad' | 'warn' | 'neutral'> = { high: 'bad', medium: 'warn', low: 'neutral' };
const SEVERITY_LABEL: Record<Alert['severity'], string> = { high: 'Urgente', medium: 'Revisar', low: 'Para tener en cuenta' };

export default function AutomationPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useAlerts();
  const canWrite = !!me?.permissions.includes('automation.rule.write');
  const canReadReceivables = !!me?.permissions.includes('receivables.account.read');
  const [kind, setKind] = useState<AlertKind | ''>('');
  const items = (data?.items ?? []).filter((a) => !kind || a.kind === kind);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automatizaciones</h1>
        <p className="text-sm text-muted-foreground">
          El sistema revisa solo lo que hay que mirar todos los días y te lo muestra acá y en la campanita de arriba. Cuando lo resolvés, el aviso desaparece.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-lg font-semibold">Avisos de hoy</h2>
            <FilterChip active={!kind} onClick={() => setKind('')}>Todos ({data?.items.length ?? 0})</FilterChip>
            {ALERT_ORDER.filter((k) => data?.counts[k]).map((k) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>{ALERT_INFO[k].title} ({data!.counts[k]})</FilterChip>
            ))}
          </div>
          {isLoading && <Skeleton className="h-48" />}
          {data && !items.length && (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" /> No hay nada para revisar.
              </CardContent>
            </Card>
          )}
          {!!items.length && (
            <Card>
              <ul className="divide-y">
                {items.map((a, i) => (
                  <li key={`${a.kind}-${a.link}-${i}`}>
                    <Link href={a.link} className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', a.severity === 'high' ? 'text-destructive' : a.severity === 'medium' ? 'text-warning' : 'text-muted-foreground')} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.detail}</div>
                      </div>
                      <Badge tone={TONE[a.severity]} className="shrink-0">{SEVERITY_LABEL[a.severity]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="w-full space-y-3 lg:w-96">
          <h2 className="text-lg font-semibold">Qué revisa el sistema</h2>
          {data && <AlertSettingsCard data={data} canWrite={canWrite} />}
          {canReadReceivables && <CollectionRemindersCard />}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1 text-xs', active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {children}
    </button>
  );
}

function AlertSettingsCard({ data, canWrite }: { data: NonNullable<ReturnType<typeof useAlerts>['data']>; canWrite: boolean }) {
  const save = useSaveAlertSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const settings = data.settings;
  const update = (k: AlertKind, patch: { enabled?: boolean; value?: number }) => save.mutate({ ...settings, [k]: { ...settings[k], ...patch } });

  return (
    <Card>
      <CardContent className="divide-y p-0 text-sm">
        {ALERT_ORDER.filter((k) => data.allowed[k]).map((k) => {
          const info = ALERT_INFO[k];
          const s = settings[k];
          const draft = values[k] ?? String(s.value ?? '');
          const n = Number(draft);
          const valid = !!info.param && Number.isInteger(n) && n >= info.param.min && n <= info.param.max;
          return (
            <div key={k} className="space-y-1.5 p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={s.enabled}
                  disabled={!canWrite || save.isPending}
                  onChange={(e) => update(k, { enabled: e.target.checked })}
                />
                <span className="flex-1">
                  <span className="font-medium">{info.title}</span>
                  <span className="block text-xs text-muted-foreground">{info.description}</span>
                </span>
              </label>
              {info.param && s.enabled && (
                <form
                  className="ml-7 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (valid) update(k, { value: n });
                  }}
                >
                  <span className="text-xs text-muted-foreground">{info.param.label(s.value ?? 0)}.</span>
                  {canWrite && (
                    <>
                      <Input
                        aria-label={`${info.title}: ${info.param.unit}`}
                        className="h-8 w-16 text-right"
                        inputMode="numeric"
                        value={draft}
                        onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                      />
                      <span className="text-xs text-muted-foreground">{info.param.unit}</span>
                      {draft !== String(s.value) && (
                        <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!valid || save.isPending}>Guardar</Button>
                      )}
                    </>
                  )}
                </form>
              )}
            </div>
          );
        })}
        {save.error && <p className="p-4 text-destructive">{save.error.message}</p>}
        {!canWrite && <p className="p-4 text-xs text-muted-foreground">Solo un administrador puede cambiar qué se revisa.</p>}
      </CardContent>
    </Card>
  );
}

/** La cobranza manda sus recordatorios por WhatsApp sola: se muestra acá para tener todo lo automático junto. */
function CollectionRemindersCard() {
  const { data } = useCollectionSettings();
  if (!data) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>Recordatorios de cobranza por WhatsApp</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone={data.remindersEnabled ? 'good' : 'neutral'}>{data.remindersEnabled ? 'Prendido' : 'Apagado'}</Badge>
          <span className="text-muted-foreground">Todos los días a las 9</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.remindersEnabled
            ? `Te avisa ${data.daysBefore} días antes de cada vencimiento y, cuando vence, le escribe también al cliente.`
            : 'Cuando está prendido, avisa antes de cada vencimiento y le escribe al cliente cuando vence.'}
        </p>
        <Link href="/settings/collections" className="text-xs text-primary hover:underline">Configurar en Cobranza</Link>
      </CardContent>
    </Card>
  );
}
