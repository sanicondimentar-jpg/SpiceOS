'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

/** Registra el service worker que hace a SpiceOS instalable (solo en producción, para no molestar en desarrollo). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Ya abierta como app instalada (desde el ícono de la pantalla de inicio). */
function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Botón "Instalar en el celular" del menú.
 * Android/Chrome: abre el aviso del sistema para instalar. iPhone (Safari no tiene ese aviso): explica los dos toques.
 * No aparece si ya está instalada.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <div className="border-t p-2">
      <button
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            if (outcome === 'accepted') setInstalled(true);
            setPrompt(null);
          } else setHelp(true);
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <Download className="h-4 w-4" /> Instalar en el celular
      </button>
      {help && (
        <div className="relative mt-1 rounded-md bg-muted p-3 pr-8 text-xs leading-relaxed">
          <button onClick={() => setHelp(false)} aria-label="Cerrar" className="absolute right-2 top-2 text-muted-foreground"><X className="h-4 w-4" /></button>
          En Safari, tocá <Share className="inline h-3.5 w-3.5 align-text-bottom" /> <b>Compartir</b> y después <b>Agregar a inicio</b>. Te queda el ícono de Sabor a Casa en la pantalla.
        </div>
      )}
    </div>
  );
}
