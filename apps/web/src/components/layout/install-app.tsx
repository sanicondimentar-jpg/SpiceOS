'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'spiceos:instalar-oculto';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Registra el service worker y ofrece instalar SpiceOS en el celular (queda un ícono como una app).
 * En Android/Chrome usa el aviso del navegador; en iPhone explica cómo agregarlo a la pantalla de inicio.
 */
export function useInstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    setInstalled(isStandalone());
    setIos(isIos());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return false;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === 'accepted') setInstalled(true);
    return true;
  };

  return { canInstall: !installed && (!!prompt || ios), ios: ios && !prompt, install };
}

/** Botón del menú: "Instalar en el celular". */
export function InstallAppButton({ onDone }: { onDone?: () => void }) {
  const { canInstall, ios, install } = useInstallApp();
  const [help, setHelp] = useState(false);
  if (!canInstall) return null;
  return (
    <div className="border-t p-2">
      <button
        onClick={() => (ios ? setHelp((v) => !v) : void install().then(() => onDone?.()))}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Download className="h-4 w-4" /> Instalar en el celular
      </button>
      {help && <IosHelp />}
    </div>
  );
}

/** Aviso en el celular (una sola vez): se puede cerrar y no vuelve a salir. */
export function InstallBanner() {
  const { canInstall, ios, install } = useInstallApp();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISSED) === '1');
    } catch {
      setHidden(false);
    }
  }, []);
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* sin almacenamiento: vuelve a salir la próxima vez */
    }
  };
  if (!canInstall || hidden) return null;
  return (
    <div className="flex items-start gap-3 border-b bg-primary/5 px-4 py-2.5 text-sm md:hidden print:hidden">
      <img src="/icons/icon-192.png" alt="" className="mt-0.5 h-8 w-8 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Instalá SpiceOS en el celular</p>
        {ios ? (
          <IosHelp />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Queda un ícono en la pantalla y se abre como una app.</p>
            <Button size="sm" className="mt-1.5 h-8" onClick={() => void install().then(dismiss)}>
              <Download className="h-4 w-4" /> Instalar
            </Button>
          </>
        )}
      </div>
      <button onClick={dismiss} aria-label="Cerrar aviso" className="p-1 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function IosHelp() {
  return (
    <p className="mt-1 px-1 text-xs text-muted-foreground">
      En iPhone, abrilo en Safari, tocá <Share className="inline h-3.5 w-3.5 align-text-bottom" /> <b>Compartir</b> y después <b>Agregar a inicio</b>.
    </p>
  );
}
