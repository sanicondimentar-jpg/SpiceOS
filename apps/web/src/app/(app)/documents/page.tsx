'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { FileText, Plus, Search, Upload } from 'lucide-react';
import { EntityPicker, type EntityValue } from '@/components/documents/entity-picker';
import { ExpiryBadge } from '@/components/documents/expiry-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KINDS,
  ENTITY_LABEL,
  daysLeft,
  fileSize,
  useCreateDocument,
  useDocuments,
  type DocumentKindValue,
  type DocumentSummary,
} from '@/lib/documents';
import { useMe } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export default function DocumentsPage() {
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('documents.document.write');
  const [kind, setKind] = useState<DocumentKindValue | ''>('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useDocuments({ kind, q });
  const { data: all } = useDocuments({});
  const expiring = (all ?? []).filter((d) => {
    const n = daysLeft(d.validUntil);
    return n !== null && n <= 30;
  });
  const kinds = DOCUMENT_KINDS.filter((k) => all?.some((d) => d.kind === k));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Documentos</h1>
          <p className="text-sm text-muted-foreground">
            Fichas técnicas, certificados, análisis, contratos y listas de proveedores en un solo lugar. Lo que tiene texto (PDF, Word) lo puede leer el copiloto para responder preguntas.
          </p>
          {me?.permissions.includes('core.settings.manage') && (
            <Link href="/settings/integrations" className="text-sm text-primary hover:underline">Traer archivos de Google Drive →</Link>
          )}
        </div>
        {canWrite && !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Subir documento
          </Button>
        )}
      </div>

      {adding && <UploadCard onDone={() => setAdding(false)} />}

      {!!expiring.length && (
        <Card className="border-warning/50">
          <CardHeader className="pb-2"><CardTitle>Vencen pronto</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {expiring.map((d) => (
              <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center justify-between gap-3 rounded px-1 py-1 hover:bg-muted/50">
                <span className="truncate">{d.title}{d.entityName ? ` · ${d.entityName}` : ''}</span>
                <ExpiryBadge validUntil={d.validUntil} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Buscar" placeholder="Buscar por nombre o etiqueta" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Chip active={!kind} onClick={() => setKind('')}>Todos</Chip>
          {kinds.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{DOCUMENT_KIND_LABEL[k]}</Chip>
          ))}
        </div>

        {isLoading && <Skeleton className="h-40" />}
        {data && !data.length && (
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <FileText className="h-5 w-5" />
              {all?.length ? 'No hay documentos con ese filtro.' : 'Todavía no hay documentos. Subí la primera ficha técnica o certificado.'}
            </CardContent>
          </Card>
        )}
        {!!data?.length && (
          <Card>
            <ul className="divide-y">
              {data.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentSummary }) {
  return (
    <li>
      <Link href={`/documents/${doc.id}`} className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/50">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{doc.title}</div>
          <div className="text-xs text-muted-foreground">
            {DOCUMENT_KIND_LABEL[doc.kind]}
            {doc.entityType && doc.entityName ? ` · ${ENTITY_LABEL[doc.entityType]}: ${doc.entityName}` : ''}
            {doc.current ? ` · ${doc.current.fileName ?? doc.current.mimeType}${doc.current.sizeBytes ? ` (${fileSize(doc.current.sizeBytes)})` : ''}` : ''}
            {doc.current && doc.current.versionNo > 1 ? ` · versión ${doc.current.versionNo}` : ''}
            {doc.source === 'DRIVE' ? ' · Google Drive' : ''}
          </div>
          {!!doc.tags.length && (
            <div className="mt-1 flex flex-wrap gap-1">
              {doc.tags.map((t) => (
                <Badge key={t} tone="neutral">{t}</Badge>
              ))}
            </div>
          )}
        </div>
        <ExpiryBadge validUntil={doc.validUntil} />
      </Link>
    </li>
  );
}


function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function UploadCard({ onDone }: { onDone: () => void }) {
  const create = useCreateDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DocumentKindValue>('TECHNICAL_SHEET');
  const [validUntil, setValidUntil] = useState('');
  const [tags, setTags] = useState('');
  const [entity, setEntity] = useState<EntityValue>({ type: '', id: '' });
  const missingEntity = !!entity.type && !entity.id;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || title.trim().length < 2 || missingEntity) return;
    const form = new FormData();
    form.append('file', file);
    form.append('title', title.trim());
    form.append('kind', kind);
    if (validUntil) form.append('validUntil', validUntil);
    if (tags.trim()) form.append('tags', tags);
    if (entity.type && entity.id) {
      form.append('entityType', entity.type);
      form.append('entityId', entity.id);
    }
    create.mutate(form, { onSuccess: onDone });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>Subir documento</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Archivo" htmlFor="doc-file" hint="PDF, foto, Word, Excel o texto. Hasta 15 MB." className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <input
                id="doc-file"
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.md"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-4 w-4" /> Elegir archivo
              </Button>
              <span className="truncate text-sm text-muted-foreground">{file ? `${file.name} (${fileSize(file.size)})` : 'Ningún archivo elegido'}</span>
            </div>
          </Field>
          <Field label="Nombre" htmlFor="doc-title">
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ficha técnica pimentón ahumado" />
          </Field>
          <Field label="Tipo" htmlFor="doc-kind">
            <Select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKindValue)}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Vence (opcional)" htmlFor="doc-valid" hint="Para certificados y habilitaciones: te avisa antes de que venza.">
            <Input id="doc-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Etiquetas (opcional)" htmlFor="doc-tags" hint="Separadas por coma, por ejemplo: sin tacc, kosher.">
            <Input id="doc-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Corresponde a (opcional)" htmlFor="doc-entity-type" error={missingEntity ? 'Elegí cuál' : undefined} className="sm:col-span-2">
            <EntityPicker idPrefix="doc-entity" value={entity} onChange={setEntity} />
          </Field>
          {create.error && <p className="text-sm text-destructive sm:col-span-2">{create.error.message}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!file || title.trim().length < 2 || missingEntity || create.isPending}>
              {create.isPending ? 'Subiendo…' : 'Guardar'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
