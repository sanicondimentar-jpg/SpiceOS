import type { MetadataRoute } from 'next';

/** SpiceOS instalable en el celular de los empleados: queda un ícono como el de una app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SpiceOS — Sabor a Casa',
    short_name: 'SpiceOS',
    description: 'Sistema de gestión de Sabor a Casa: pedidos, WhatsApp, stock y cobranza.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fcfbfa',
    theme_color: '#ca3a1b',
    lang: 'es-AR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Pedidos', url: '/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'WhatsApp', url: '/inbox', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Nuevo pedido', url: '/orders/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
