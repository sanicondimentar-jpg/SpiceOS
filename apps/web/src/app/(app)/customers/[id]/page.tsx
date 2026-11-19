'use client';

import Link from 'next/link';
import { use } from 'react';
import { MessageCircle, Phone, ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { date, money, number } from '@/lib/utils';
import { useCustomer360, useMe } from '@/lib/hooks';
import { ContactsCard } from '@/components/crm/contacts-card';
import { CustomerDetailsCard } from '@/components/crm/customer-details-card';
import { CustomerOrdersCard } from '@/components/crm/customer-orders-card';

const MISSING_LABEL: Record<string, string> = { phone: 'el teléfono', address: 'la dirección' };

/** Customer 360: todo lo que la empresa sabe de un cliente, en una pantalla. */
export default function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useCustomer360(id);
  const { data: me } = useMe();
  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-7xl" />;
  const { customer: c, kpis } = data;
  const risk = c.account?.riskAssessments?.[0];
  const missing: string[] = data.missing ?? [];
  const canWrite = !!me?.permissions.includes('crm.customer.write');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{c.tradeName ?? c.legalName}</h1>
          <p className="text-sm text-muted-foreground">
            {c.code} · CUIT {c.taxId ?? '—'} · {c.industry ?? 'sin rubro'} · Lista {c.priceList?.name ?? 'por defecto'}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {c.phone ? (
            <Button asChild variant="outline" size="sm"><a href={`tel:${c.phone}`}><Phone className="h-4 w-4" /> Llamar</a></Button>
          ) : (
            <Button variant="outline" size="sm" disabled><Phone className="h-4 w-4" /> Llamar</Button>
          )}
          <Button variant="outline" size="sm"><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
          <Button asChild size="sm">
            <Link href={`/orders/new?customerId=${c.id}&customerName=${encodeURIComponent(c.tradeName ?? c.legalName)}`}><ShoppingCart className="h-4 w-4" /> Nuevo pedido</Link>
          </Button>
        </div>
      </div>

      {missing.length > 0 && (
        <div role="status" className="rounded-md border border-warning bg-warning/10 px-4 py-3 text-sm">
          <span className="font-medium">Ficha para completar:</span> falta {missing.map((m) => MISSING_LABEL[m] ?? m).join(' y ')}.
          {c.source === 'whatsapp' || c.source === 'web' ? ` Se creó sola desde ${c.source === 'web' ? 'un pedido web' : 'WhatsApp'}.` : ''}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat title="Compras 12 meses" value={money(kpis.revenue12m)} />
        <Stat title="Margen 12 meses" value={money(kpis.margin12m)} />
        <Stat title="Ticket promedio" value={money(kpis.avgTicket)} />
        <Stat title="Días sin comprar" value={kpis.daysSinceLastOrder ?? '—'} warn={(kpis.daysSinceLastOrder ?? 0) > 60} />
        <Stat title="Saldo / vencido" value={`${money(c.account?.balance)} / ${money(c.account?.overdue)}`} warn={Number(c.account?.overdue ?? 0) > 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
        <CustomerOrdersCard customerId={id} canSeeInvoices={!!me?.permissions.includes('invoicing.invoice.read')} />
        <Card>
          <CardHeader><CardTitle>Actividad</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.timeline.length === 0 && <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>}
            {data.timeline.map((a: { id: string; type: string; subject: string; occurredAt: string }) => (
              <div key={a.id} className="flex gap-3 text-sm">
                <Badge tone={a.type === 'WHATSAPP' ? 'good' : 'neutral'}>{a.type}</Badge>
                <span className="flex-1">{a.subject}</span>
                <span className="text-xs text-muted-foreground">{date(a.occurredAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        </div>

        <div className="space-y-4">
          <CustomerDetailsCard customer={c} missing={missing} canWrite={canWrite} />
          <ContactsCard customerId={id} canWrite={canWrite} />
          <Card>
            <CardHeader><CardTitle>Riesgo financiero</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {risk ? (
                <>
                  <Badge tone={risk.level === 'LOW' ? 'good' : risk.level === 'MEDIUM' ? 'warn' : 'bad'}>{risk.level} · {risk.score}/100</Badge>
                  <p className="mt-2 text-muted-foreground">{risk.explanation}</p>
                </>
              ) : (
                <p className="text-muted-foreground">Sin evaluación todavía.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Lo que más compra</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.topProducts.map((p: { variant_id: string; name: string; qty: number; revenue: number }) => (
                <div key={p.variant_id} className="flex justify-between gap-2">
                  <span>{p.name}</span>
                  <span className="tabular-nums text-muted-foreground">{number(p.qty)} u · {money(p.revenue)}</span>
                </div>
              ))}
              {data.topProducts.length === 0 && <p className="text-muted-foreground">Sin compras todavía.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Oportunidades y tareas</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.openOpportunities.map((o: { id: string; title: string; amount: number | null; stage: { name: string } }) => (
                <div key={o.id} className="flex justify-between gap-2"><span>{o.title}</span><Badge tone="brand">{o.stage.name}</Badge></div>
              ))}
              {data.openTasks.map((t: { id: string; title: string; dueAt: string | null }) => (
                <div key={t.id} className="flex justify-between gap-2"><span>☐ {t.title}</span><span className="text-xs text-muted-foreground">{date(t.dueAt)}</span></div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value, warn }: { title: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><div className={`text-lg font-semibold tabular-nums ${warn ? 'text-destructive' : ''}`}>{value}</div></CardContent>
    </Card>
  );
}
