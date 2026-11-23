import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { RegisterServiceWorker } from '@/components/layout/pwa';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'SpiceOS',
  description: 'Plataforma empresarial para distribuidoras de especias',
  applicationName: 'SpiceOS',
  // Instalada en el iPhone ("Agregar a inicio") se abre a pantalla completa con el ícono de Sabor a Casa.
  appleWebApp: { capable: true, title: 'SpiceOS', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

/** viewport-fit=cover: en celulares con muesca la barra inferior respeta la zona segura. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#7d1d1d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
