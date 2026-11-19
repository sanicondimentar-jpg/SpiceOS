'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { folderLink, useConnectDrive, useDisconnectDrive, useDriveStatus, useSyncDrive } from '@/lib/drive';

const RESULT: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Listo, Drive quedó conectado. En unos minutos empiezan a aparecer los archivos en Documentos.', ok: true },
  cancelled: { text: 'Cancelaste el permiso en Google. Podés volver a intentarlo cuando quieras.', ok: false },
  error: { text: 'Google no devolvió el permiso. Probá de nuevo; si se repite, avisá.', ok: false },
};

/** Configuración → Google Drive: conectar carpetas de Drive al módulo Documentos. */
export default function IntegrationsPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl" />}>
      <DriveSettings />
    </Suspense>
  );
}

function DriveSettings() {
  const result = RESULT[useSearchParams().get('drive') ?? ''];
  const { data, isLoading } = useDriveStatus();
  const connect = useConnectDrive();
  const sync = useSyncDrive();
  const disconnect = useDisconnectDrive();
  const [folders, setFolders] = useState('');
  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  const count = (s: string) => data.files.find((f) => f.syncStatus === s)?._count ?? 0;
  const conn = data.connections[0];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <h1 className="text-2xl font-semibold">Google Drive</h1>
      <p className="text-sm text-muted-foreground">
        El sistema lee (sin modificar nada) las carpetas de Drive que elijas y trae sus archivos a Documentos, con subcarpetas incluidas. Cada 5 minutos revisa si hay archivos nuevos o cambiados. Lo que tiene texto (PDF, Word, Documentos y Hojas de Google) lo puede leer el copiloto.
      </p>

      {result && <p className={`rounded-md p-3 text-sm ${result.ok ? 'bg-muted' : 'bg-destructive/10 text-destructive'}`}>{result.text}</p>}

      {!data.configured && (
        <Card>
          <CardContent className="p-5 text-sm">
            Todavía faltan las claves de Google en el servidor. Cuando estén cargadas, acá vas a poder conectar tu Drive.
          </CardContent>
        </Card>
      )}

      {conn && (
        <Card>
          <CardHeader><CardTitle>Conectado</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>Cuenta: <span className="font-medium">{conn.googleAccount}</span></div>
            <div>
              Carpetas:
              <ul className="ml-5 list-disc">
                {conn.rootFolderIds.map((id) => (
                  <li key={id}><a href={folderLink(id)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{id}</a></li>
                ))}
              </ul>
            </div>
            <div>
              Última revisión: {conn.lastSyncAt ? new Date(conn.lastSyncAt).toLocaleString('es-AR') : 'todavía no (la primera puede tardar unos minutos)'}
            </div>
            <div>
              Archivos: {count('INDEXED')} cargados · {count('PENDING')} pendientes · {count('SKIPPED')} sin texto (fotos, etc.) · {count('ERROR')} con error
            </div>
            {!!data.errors.length && (
              <ul className="ml-5 list-disc text-xs text-destructive">
                {data.errors.map((e) => <li key={e.name}>{e.name}: {e.lastError?.slice(0, 160)}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(conn.id)}>
                {sync.isSuccess ? 'Revisando…' : 'Revisar ahora'}
              </Button>
              <Button
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() => confirm('¿Desconectar Drive? Los documentos ya traídos quedan en el sistema.') && disconnect.mutate(conn.id)}
              >
                Desconectar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data.configured && (
        <Card>
          <CardHeader>
            <CardTitle>{conn ? 'Cambiar carpetas o cuenta' : 'Conectar Drive'}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Abrí la carpeta en Drive, copiá el link de la barra del navegador y pegalo acá. Para varias carpetas, separalas con coma. Después Google te va a pedir que elijas la cuenta y des permiso de lectura.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Link de la carpeta" htmlFor="d-folders" hint="Ejemplo: https://drive.google.com/drive/folders/1AbC…">
              <Input id="d-folders" value={folders} onChange={(e) => setFolders(e.target.value)} placeholder={conn ? conn.rootFolderIds.map(folderLink).join(', ') : ''} />
            </Field>
            {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
            <div className="flex justify-end">
              <Button disabled={!folders.trim() || connect.isPending} onClick={() => connect.mutate(folders)}>
                {connect.isPending ? 'Abriendo Google…' : 'Conectar con Google'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
