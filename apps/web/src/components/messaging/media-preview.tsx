'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchBlob } from '@/lib/api';
import { TYPE_LABEL } from '@/lib/messaging';

/** Fotos y audios se bajan de Meta a pedido (el archivo pide el token, no sirve un <img src> directo). */
export function MediaPreview({ messageId, type }: { messageId: string; type: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const auto = type === 'image' || type === 'sticker';

  const load = async () => {
    setState('loading');
    try {
      setUrl(URL.createObjectURL(await fetchBlob(`/messaging/conversations/messages/${messageId}/media`)));
      setState('idle');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  };

  useEffect(() => {
    if (auto) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  if (state === 'error') return <p className="text-xs text-destructive">{error}</p>;
  if (url) {
    if (type === 'image' || type === 'sticker') return <img src={url} alt="Foto recibida" className="mb-1 max-h-72 rounded" />;
    if (type === 'audio') return <audio controls src={url} className="mb-1 max-w-full" />;
    if (type === 'video') return <video controls src={url} className="mb-1 max-h-72 rounded" />;
    return <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">Abrir {TYPE_LABEL[type]?.toLowerCase() ?? 'archivo'}</a>;
  }
  return (
    <Button size="sm" variant="outline" className="mb-1" disabled={state === 'loading'} onClick={() => void load()}>
      {state === 'loading' ? 'Cargando…' : type === 'audio' ? 'Escuchar audio' : `Ver ${TYPE_LABEL[type]?.toLowerCase() ?? 'archivo'}`}
    </Button>
  );
}
