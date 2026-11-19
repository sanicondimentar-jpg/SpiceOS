'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSaveWhatsappProfile, useWhatsappProfile, type WhatsappProfile } from '@/lib/messaging';
import logo from './logo-sabor-a-casa.png';

type Fields = Omit<WhatsappProfile, 'photoUrl'>;

/** Textos sugeridos para Sabor a Casa: se proponen solo en los campos que en Meta están vacíos. */
const SUGGESTED: Fields = {
  about: 'Especias y condimentos por mayor y menor 🌶️ Pedidos por acá',
  description:
    'Sabor a Casa: especias, condimentos y hierbas para rotiserías, restaurantes, almacenes y para tu cocina. Venta mayorista por caja y bolsa, y minorista en sobres sueltos y combos. Entregamos en GBA Norte y alrededores. Pedido mínimo mayorista $50.000. Catálogo y precios en www.saboracasa.com.ar',
  address: 'Entregas en GBA Norte y alrededores',
  email: 'sanicondimentar@gmail.com',
  website: 'https://www.saboracasa.com.ar',
  website2: '',
  vertical: 'GROCERY',
};

const VERTICALS: [string, string][] = [
  ['GROCERY', 'Alimentos y comestibles'],
  ['RESTAURANT', 'Restaurante'],
  ['RETAIL', 'Comercio minorista'],
  ['PROF_SERVICES', 'Servicios profesionales'],
  ['EVENT_PLAN', 'Eventos'],
  ['OTHER', 'Otro'],
];

const textarea = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** Perfil público del número de WhatsApp: lo que ve el cliente al tocar el nombre del negocio. */
export function WhatsappProfileCard() {
  const { data, isLoading, error } = useWhatsappProfile(true);
  const save = useSaveWhatsappProfile();
  const [v, setV] = useState<Fields>(SUGGESTED);
  const [suggested, setSuggested] = useState<string[]>([]);
  /** null = no cambiar la foto; 'logo' = el logo de Sabor a Casa; File = una elegida. */
  const [photo, setPhoto] = useState<File | 'logo' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    const next = { ...SUGGESTED };
    const filled: string[] = [];
    for (const k of Object.keys(SUGGESTED) as (keyof Fields)[]) {
      if (data[k]) next[k] = data[k];
      else if (SUGGESTED[k]) filled.push(k);
    }
    setV(next);
    setSuggested(filled);
    if (!data.photoUrl) setPhoto('logo');
  }, [data]);

  useEffect(() => {
    if (photo instanceof File) {
      const url = URL.createObjectURL(photo);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(photo === 'logo' ? logo.src : null);
  }, [photo]);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Perfil de WhatsApp</CardTitle></CardHeader>
        <CardContent className="text-sm text-destructive">{error?.message ?? 'No se pudo leer el perfil.'}</CardContent>
      </Card>
    );
  }

  const set = (k: keyof Fields) => (e: { target: { value: string } }) => {
    setV({ ...v, [k]: e.target.value });
    setSuggested((s) => s.filter((x) => x !== k));
  };
  const hint = (k: keyof Fields, text?: string) => (suggested.includes(k) ? `Sugerido (en WhatsApp hoy está vacío). ${text ?? ''}` : text);
  const shownPhoto = preview ?? data.photoUrl;
  const tooLong = v.about.length > 139 || v.description.length > 512;

  async function publish() {
    let blob: Blob | null = null;
    if (photo === 'logo') blob = await (await fetch(logo.src)).blob();
    else if (photo) blob = photo;
    save.mutate({ fields: v, photo: blob }, { onSuccess: () => { setPhoto(null); setSuggested([]); } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil de WhatsApp</CardTitle>
        <p className="text-sm text-muted-foreground">
          Es lo que ven los clientes al tocar el nombre del negocio en WhatsApp. Al publicar se cambia en Meta en el momento; los campos vacíos
          quedan como están.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border bg-muted text-xs text-muted-foreground">
            {shownPhoto ? <img src={shownPhoto} alt="Foto de perfil" className="h-full w-full object-cover" /> : 'Sin foto'}
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">
              Foto de perfil
              {photo === 'logo' && <span className="ml-2 text-xs font-normal text-muted-foreground">Se va a publicar el logo de Sabor a Casa</span>}
              {photo instanceof File && <span className="ml-2 text-xs font-normal text-muted-foreground">Se va a publicar {photo.name}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setPhoto('logo')}>Usar el logo</Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Elegir otra foto…</Button>
              {photo && <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}>No cambiar la foto</Button>}
            </div>
            <p className="text-xs text-muted-foreground">JPG o PNG, cuadrada, hasta 5 MB. WhatsApp la recorta en círculo.</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Info (frase corta bajo el nombre) · ${v.about.length}/139`} htmlFor="wp-about" hint={hint('about')} error={v.about.length > 139 ? 'Hasta 139 caracteres' : undefined} className="sm:col-span-2">
            <Input id="wp-about" value={v.about} onChange={set('about')} />
          </Field>
          <Field label={`Descripción · ${v.description.length}/512`} htmlFor="wp-desc" hint={hint('description')} error={v.description.length > 512 ? 'Hasta 512 caracteres' : undefined} className="sm:col-span-2">
            <textarea id="wp-desc" rows={5} className={textarea} value={v.description} onChange={set('description')} />
          </Field>
          <Field label="Dirección o zona" htmlFor="wp-address" hint={hint('address')} className="sm:col-span-2">
            <Input id="wp-address" value={v.address} onChange={set('address')} />
          </Field>
          <Field label="Rubro" htmlFor="wp-vertical" hint={hint('vertical')}>
            <Select id="wp-vertical" value={v.vertical} onChange={set('vertical')}>
              <option value="">Sin elegir</option>
              {VERTICALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Email" htmlFor="wp-email" hint={hint('email')}>
            <Input id="wp-email" type="email" value={v.email} onChange={set('email')} />
          </Field>
          <Field label="Sitio web" htmlFor="wp-web" hint={hint('website')}>
            <Input id="wp-web" value={v.website} onChange={set('website')} />
          </Field>
          <Field label="Otro sitio (opcional)" htmlFor="wp-web2" hint="Por ejemplo, Instagram.">
            <Input id="wp-web2" value={v.website2} onChange={set('website2')} />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2">
          {save.error && <p className="mr-auto text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && <p className="mr-auto text-sm text-success">Publicado en WhatsApp.</p>}
          <Button disabled={tooLong || save.isPending} onClick={() => void publish()}>
            {save.isPending ? 'Publicando…' : 'Publicar en WhatsApp'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
