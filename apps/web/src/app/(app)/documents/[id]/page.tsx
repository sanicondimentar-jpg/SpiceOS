'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, Upload } from 'lucide-react';
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
  entityHref,
  fileSize,
  openDocument,
  useAddVersion,
  useDeleteDocument,
  useDocument,
  useUpdateDocument,
  type DocumentDetail,
  type DocumentKindValue,
} from '@/lib/documents';
import { useMe } from '@/lib/hooks';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const { data: doc, isLoading, error } = useDocument(id);
  const canWrite = !!me?.permissions.includes('documents.document.write');
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Skeleton className="mx-auto h-64 max-w-4xl" />;
  if (error || !doc) return <p className="text-sm text-destructive">{error?.message ?? 'No se encontró el documento'}</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Documentos
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{DOCUMENT_KIND_LABEL[doc.kind]}</span>
            {doc.entityType && doc.entityId && (
              <>
                <span>·</span>
                <Link href={entityHref(doc.entityType, doc.entityId)} className="text-primary hover:underline">
                  {ENTITY_LABEL[doc.entityType]}: {doc.entityName ?? 'ver'}
                </Link>
              </>
            )}
            <ExpiryBadge validUntil={doc.validUntil} />
            {doc.tags.map((t) => (
              <Badge key={t} tone="neutral">{t}</Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {doc.current?.hasFile && (
            <Button onClick={() => openDocument(doc.id)}>
              <FileText className="mr-1 h-4 w-4" /> Abrir
            </Button>
          )}
          {doc.driveLink && (
            <Button variant="outline" asChild>
              <a href={doc.driveLink} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Abrir en Drive
              </a>
            </Button>
          )}
          {canWrite && !editing && <Button variant="outline" onClick={() => setEditing(true)}>Editar</Button>}
        </div>
      </div>

      {editing && <EditCard doc={doc} onDone={() => setEditing(false)} />}

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          {doc.current?.searchable
            ? 'El copiloto puede leer este documento para responder preguntas.'
            : 'Este archivo no tiene texto que se pueda leer (por ejemplo, una foto o un PDF escaneado): queda guardado, pero el copiloto no lo usa para responder.'}
        </CardContent>
      </Card>

      {canWrite && doc.source === 'UPLOAD' && <NewVersionCard doc={doc} />}

      <Card>
        <CardHeader className="pb-2"><CardTitle>Versiones</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y text-sm">
            {doc.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-20 shrink-0 font-medium">Versión {v.versionNo}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {v.fileName ?? v.mimeType}
                  {v.sizeBytes ? ` · ${fileSize(v.sizeBytes)}` : ''} · {new Date(v.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                {v.id === doc.current?.id && <Badge tone="good">Actual</Badge>}
                {doc.source === 'UPLOAD' && (
                  <Button size="sm" variant="ghost" onClick={() => openDocument(doc.id, v.id)}>Ver</Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canWrite && <DeleteButton id={doc.id} />}
    </div>
  );
}

function NewVersionCard({ doc }: { doc: DocumentDetail }) {
  const add = useAddVersion(doc.id);
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [msg, setMsg] = useState('');
  const submit = () => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    if (validUntil) form.append('validUntil', validUntil);
    add.mutate(form, {
      onSuccess: (r) => {
        setFile(null);
        setValidUntil('');
        setMsg(r.unchanged ? 'Es el mismo archivo que la versión actual: no se cambió nada.' : 'Listo, se guardó la versión nueva.');
      },
    });
  };
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>Reemplazar por una versión nueva</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Por ejemplo, el certificado renovado o la ficha actualizada. La versión anterior queda en el historial.</p>
        <div className="flex flex-wrap items-end gap-3">
          <input
            ref={ref}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.md"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setMsg('');
            }}
          />
          <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> {file ? file.name : 'Elegir archivo'}
          </Button>
          {doc.validUntil !== null && (
            <Field label="Nuevo vencimiento (opcional)" htmlFor="ver-valid">
              <Input id="ver-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          )}
          <Button onClick={submit} disabled={!file || add.isPending}>{add.isPending ? 'Subiendo…' : 'Guardar versión'}</Button>
        </div>
        {add.error && <p className="text-destructive">{add.error.message}</p>}
        {msg && <p className="text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}

function EditCard({ doc, onDone }: { doc: DocumentDetail; onDone: () => void }) {
  const update = useUpdateDocument(doc.id);
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<DocumentKindValue>(doc.kind);
  const [validUntil, setValidUntil] = useState(doc.validUntil ?? '');
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [changeEntity, setChangeEntity] = useState(false);
  const [entity, setEntity] = useState<EntityValue>({ type: '', id: '' });
  const missingEntity = changeEntity && !!entity.type && !entity.id;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2 || missingEntity) return;
    update.mutate(
      {
        title: title.trim(),
        kind,
        validUntil: validUntil || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        ...(changeEntity && { entityType: entity.type || null, entityId: entity.id || null }),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>Editar datos</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="ed-title">
            <Input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Tipo" htmlFor="ed-kind">
            <Select id="ed-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKindValue)}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Vence" htmlFor="ed-valid" hint="Dejalo vacío si no vence.">
            <Input id="ed-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Etiquetas" htmlFor="ed-tags" hint="Separadas por coma.">
            <Input id="ed-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Corresponde a" htmlFor="ed-entity-type" error={missingEntity ? 'Elegí cuál' : undefined} className="sm:col-span-2">
            {changeEntity ? (
              <EntityPicker idPrefix="ed-entity" value={entity} onChange={setEntity} />
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span>{doc.entityType ? `${ENTITY_LABEL[doc.entityType]}: ${doc.entityName ?? '—'}` : 'Nada en particular'}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChangeEntity(true)}>Cambiar</Button>
              </div>
            )}
          </Field>
          {update.error && <p className="text-sm text-destructive sm:col-span-2">{update.error.message}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={title.trim().length < 2 || missingEntity || update.isPending}>Guardar</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteButton({ id }: { id: string }) {
  const del = useDeleteDocument();
  const router = useRouter();
  return (
    <div className="space-y-1">
      <Button
        variant="ghost"
        className="text-destructive"
        disabled={del.isPending}
        onClick={() => {
          if (confirm('¿Borrar este documento? Deja de aparecer en la lista y el copiloto ya no lo usa.')) del.mutate(id, { onSuccess: () => router.push('/documents') });
        }}
      >
        Borrar documento
      </Button>
      {del.error && <p className="text-sm text-destructive">{del.error.message}</p>}
    </div>
  );
}
