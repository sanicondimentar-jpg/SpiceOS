import type { MetadataRoute } from 'next';

/**
 * Permite "instalar" SpiceOS en el celular (Agregar a la pantalla de inicio): queda un ícono de Sabor a Casa
 * y se abre a pantalla completa, sin la barra del navegador, como una app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SpiceOS · Sabor a Casa',
    short_name: 'SpiceOS',
    description: 'Pedidos, clientes, WhatsApp e inventario de Sabor a Casa',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'es-AR',
    background_color: '#fdfcfb',
    theme_color: '#7d1d1d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Pedidos', url: '/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'WhatsApp', url: '/inbox', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Inventario', url: '/inventory', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
