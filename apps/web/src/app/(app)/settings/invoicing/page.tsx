'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { FiscalSettingsInput } from '@spiceos/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useFiscalSettings, useGenerateCsr, useSaveCertificate, useSaveFiscalSettings, useTestArca, type FiscalSettingsView } from '@/lib/invoicing';
import { date, money } from '@/lib/utils';

type Form = {
  taxCondition: FiscalSettingsView['taxCondition'];
  cuit: string;
  legalName: string;
  address: string;
  grossIncomeId: string;
  activityStart: string;
  pointOfSale: string;
  environment: FiscalSettingsView['environment'];
  monotributoCategory: string;
  annualCap: string;
};

const EMPTY: Form = {
  taxCondition: 'MONOTRIBUTO',
  cuit: '',
  legalName: '',
  address: '',
  grossIncomeId: '',
  activityStart: '',
  pointOfSale: '',
  environment: 'PRODUCTION',
  monotributoCategory: '',
  annualCap: '',
};

export default function InvoicingSettingsPage() {
  const { data, isLoading } = useFiscalSettings();
  const s = data?.settings;
  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Facturación electrónica</h1>
        {s?.ready ? <Badge tone="good">Lista para facturar</Badge> : s ? <Badge tone="warn">Falta terminar</Badge> : <Badge>Sin configurar</Badge>}
        {s?.environment === 'TESTING' && <Badge tone="warn">Modo prueba</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        Las facturas se piden a ARCA desde el pedido, con el botón «Facturar». Cualquier persona con permiso para facturar lo puede hacer con estos datos:
        no hace falta la clave fiscal para cada factura.
      </p>

      {s?.taxCondition === 'MONOTRIBUTO' && s.annualCap ? <CapCard invoiced={data.invoicedLast12Months} cap={s.annualCap} category={s.monotributoCategory} /> : null}
      <FiscalDataCard settings={s ?? null} />
      {s && <CertificateCard settings={s} />}
      {s?.hasCertificate && <TestCard settings={s} />}
    </div>
  );
}

function CapCard({ invoiced, cap, category }: { invoiced: number; cap: number; category: string | null }) {
  const pct = Math.min(100, (invoiced / cap) * 100);
  return (
    <Card>
      <CardContent className="space-y-2 p-5 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <span>Facturado en los últimos 12 meses{category && ` (categoría ${category})`}</span>
          <span className="font-medium tabular-nums">{money(invoiced)} de {money(cap)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-muted">
          <div className={pct >= 90 ? 'h-full bg-destructive' : pct >= 75 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
        </div>
        {pct >= 75 && <p className="text-warning">Te estás acercando al tope de la categoría: revisá con tu contador si corresponde recategorizarte.</p>}
      </CardContent>
    </Card>
  );
}

function FiscalDataCard({ settings }: { settings: FiscalSettingsView | null }) {
  const save = useSaveFiscalSettings();
  const [v, setV] = useState<Form>(EMPTY);
  useEffect(() => {
    if (settings)
      setV({
        taxCondition: settings.taxCondition,
        cuit: settings.cuit,
        legalName: settings.legalName,
        address: settings.address,
        grossIncomeId: settings.grossIncomeId ?? '',
        activityStart: settings.activityStart ?? '',
        pointOfSale: settings.pointOfSale ? String(settings.pointOfSale) : '',
        environment: settings.environment,
        monotributoCategory: settings.monotributoCategory ?? '',
        annualCap: settings.annualCap ? String(settings.annualCap) : '',
      });
  }, [settings]);
  const set = (p: Partial<Form>) => setV((x) => ({ ...x, ...p }));
  const mono = v.taxCondition === 'MONOTRIBUTO';
  const toProduction = settings?.environment === 'TESTING' && v.environment === 'PRODUCTION';

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Datos fiscales</CardTitle>
        <p className="text-sm text-muted-foreground">Salen impresos en cada factura. Tienen que coincidir con los de ARCA.</p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="Condición frente al IVA" htmlFor="f-cond" hint={mono ? 'Se emite Factura C: el precio de lista es el final, no se suma IVA.' : 'Se emite Factura A a inscriptos y monotributistas, y B al resto, sumando 21 % de IVA.'}>
          <Select id="f-cond" value={v.taxCondition} onChange={(e) => set({ taxCondition: e.target.value as Form['taxCondition'] })}>
            <option value="MONOTRIBUTO">Monotributo</option>
            <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto</option>
          </Select>
        </Field>
        <Field label="CUIT" htmlFor="f-cuit">
          <Input id="f-cuit" inputMode="numeric" placeholder="20-12345678-9" value={v.cuit} onChange={(e) => set({ cuit: e.target.value })} />
        </Field>
        <Field label="Razón social / Apellido y nombre (como figura en ARCA)" htmlFor="f-name" className="sm:col-span-2">
          <Input id="f-name" value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} />
        </Field>
        <Field label="Domicilio comercial" htmlFor="f-address" className="sm:col-span-2">
          <Input id="f-address" value={v.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Ingresos Brutos" htmlFor="f-iibb" hint="Vacío: se imprime el CUIT (Convenio / régimen simplificado).">
          <Input id="f-iibb" value={v.grossIncomeId} onChange={(e) => set({ grossIncomeId: e.target.value })} />
        </Field>
        <Field label="Inicio de actividades" htmlFor="f-start">
          <Input id="f-start" type="date" value={v.activityStart} onChange={(e) => set({ activityStart: e.target.value })} />
        </Field>
        {mono && (
          <>
            <Field label="Categoría del monotributo" htmlFor="f-cat">
              <Input id="f-cat" maxLength={1} value={v.monotributoCategory} onChange={(e) => set({ monotributoCategory: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Tope de facturación anual de la categoría ($)" htmlFor="f-cap" hint="Para avisarte cuando te acerques. Lo actualiza ARCA cada seis meses.">
              <Input id="f-cap" inputMode="decimal" value={v.annualCap} onChange={(e) => set({ annualCap: e.target.value.replace(/[^\d.]/g, '') })} />
            </Field>
          </>
        )}
        <Field label="Punto de venta (web services)" htmlFor="f-pos" hint="El que des de alta en ARCA para SpiceOS (paso 3). Usalo solo desde acá.">
          <Input id="f-pos" inputMode="numeric" value={v.pointOfSale} onChange={(e) => set({ pointOfSale: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Ambiente de ARCA" htmlFor="f-env" hint={v.environment === 'TESTING' ? 'Las facturas de prueba no tienen validez fiscal ni van a la cuenta corriente.' : undefined}>
          <Select id="f-env" value={v.environment} onChange={(e) => set({ environment: e.target.value as Form['environment'] })}>
            <option value="PRODUCTION">Producción (facturas reales)</option>
            <option value="TESTING">Prueba (homologación)</option>
          </Select>
        </Field>
        {toProduction && <p className="text-sm text-warning sm:col-span-2">Al pasar a producción se borran las facturas de prueba.</p>}
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {save.error && <p className="mr-auto text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && <p className="mr-auto text-sm text-success">Guardado.</p>}
          <Button
            disabled={save.isPending || !v.cuit || !v.legalName || !v.address}
            onClick={() => {
              const input: FiscalSettingsInput = {
                taxCondition: v.taxCondition,
                cuit: v.cuit,
                legalName: v.legalName,
                address: v.address,
                grossIncomeId: v.grossIncomeId || null,
                activityStart: v.activityStart || null,
                pointOfSale: v.pointOfSale ? Number(v.pointOfSale) : null,
                environment: v.environment,
                monotributoCategory: mono ? v.monotributoCategory || null : null,
                annualCap: mono && v.annualCap ? Number(v.annualCap) : null,
              };
              save.mutate(input);
            }}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CertificateCard({ settings }: { settings: FiscalSettingsView }) {
  const generate = useGenerateCsr();
  const saveCert = useSaveCertificate();
  const [cert, setCert] = useState('');
  const downloadCsr = () => {
    const url = URL.createObjectURL(new Blob([settings.csr ?? ''], { type: 'application/pkcs10' }));
    Object.assign(document.createElement('a'), { href: url, download: `spiceos-${settings.cuit}.csr` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Certificado de ARCA</CardTitle>
        <p className="text-sm text-muted-foreground">
          Es lo que autoriza a SpiceOS a pedir facturas con tu CUIT. Se hace una sola vez y dura dos años. La clave privada se genera y queda guardada
          cifrada en SpiceOS; a ARCA solo se le sube el pedido.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {settings.hasCertificate && (
          <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2">
            Certificado cargado. Vence el {date(settings.certificateExpiresAt)}: antes de esa fecha generá un pedido nuevo y repetí estos pasos.
          </p>
        )}
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <div className="flex flex-wrap items-center gap-2">
              <span>Generá el pedido de certificado y descargalo.</span>
              <Button
                size="sm"
                variant={settings.csr ? 'outline' : 'default'}
                disabled={generate.isPending}
                onClick={() => {
                  if (settings.hasCertificate && !window.confirm('Se va a generar una clave nueva y el certificado actual deja de servir hasta que cargues el nuevo. ¿Seguís?')) return;
                  generate.mutate(undefined);
                }}
              >
                {generate.isPending ? 'Generando…' : settings.csr ? 'Generar otro' : 'Generar pedido'}
              </Button>
              {settings.csr && (
                <Button size="sm" variant="outline" onClick={downloadCsr}>
                  <Download className="h-4 w-4" /> Descargar .csr
                </Button>
              )}
            </div>
            {generate.error && <p className="text-destructive">{generate.error.message}</p>}
          </li>
          <li>
            Entrá a <b>arca.gob.ar</b> con la clave fiscal del titular del CUIT → <b>Administración de Certificados Digitales</b> → <b>Agregar alias</b>,
            poné «spiceos», subí el archivo .csr y descargá el certificado (.crt). Si el servicio no aparece, adherilo desde el <b>Administrador de Relaciones de
            Clave Fiscal</b>.
          </li>
          <li>
            En el <b>Administrador de Relaciones de Clave Fiscal</b> → <b>Nueva relación</b> → Buscar → ARCA → WebServices → <b>Facturación Electrónica</b>;
            como representante elegí el computador fiscal «spiceos» y confirmá.
          </li>
          <li>
            Pegá acá el contenido del .crt (abrilo con el Bloc de notas) o elegí el archivo.
            <div className="mt-2 space-y-2">
              <textarea
                aria-label="Certificado"
                className="min-h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
                value={cert}
                onChange={(e) => setCert(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".crt,.pem,.cer,.txt"
                  aria-label="Archivo del certificado"
                  className="text-xs"
                  onChange={(e) => void e.target.files?.[0]?.text().then(setCert)}
                />
                <Button size="sm" className="ml-auto" disabled={!settings.csr || cert.trim().length < 100 || saveCert.isPending} onClick={() => saveCert.mutate(cert, { onSuccess: () => setCert('') })}>
                  {saveCert.isPending ? 'Guardando…' : 'Guardar certificado'}
                </Button>
              </div>
              {saveCert.error && <p className="text-destructive">{saveCert.error.message}</p>}
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function TestCard({ settings }: { settings: FiscalSettingsView }) {
  const test = useTestArca();
  const r = test.data;
  const wsPoints = r?.pointsOfSale.filter((p) => !p.blocked && !p.droppedAt) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Punto de venta y prueba</CardTitle>
        <p className="text-sm text-muted-foreground">
          En ARCA → <b>Administración de puntos de venta y domicilios</b> → A/B/M de puntos de venta → <b>Agregar</b>: elegí un número que no uses, sistema
          «Factura Electrónica - {settings.taxCondition === 'MONOTRIBUTO' ? 'Monotributo - ' : ''}Web Services» y tu domicilio. Después cargá ese número en el paso 1 y
          probá la conexión.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Button size="sm" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Consultando a ARCA…' : 'Probar conexión'}</Button>
        {test.error && <p className="text-destructive">{test.error.message}</p>}
        {r && (
          <div className="space-y-1">
            <p className="text-success">ARCA aceptó el certificado.</p>
            <p>
              Puntos de venta para web services: {wsPoints.length ? wsPoints.map((p) => p.number).join(', ') : 'ninguno todavía'}.
              {settings.pointOfSale && !wsPoints.some((p) => p.number === settings.pointOfSale) && (
                <span className="text-warning"> El {settings.pointOfSale} no aparece: revisá el número o esperá unos minutos si recién lo diste de alta.</span>
              )}
            </p>
            {r.lastNumber !== null && <p>Última Factura {r.kind} autorizada en el punto de venta {settings.pointOfSale}: {r.lastNumber || 'ninguna'}.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
