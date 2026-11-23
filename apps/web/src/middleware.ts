export { default } from 'next-auth/middleware';

// Todo requiere sesión salvo login, los endpoints de auth y lo que necesita el celular para
// instalar SpiceOS como app (manifest, íconos, service worker y la página sin conexión).
export const config = {
  matcher: ['/((?!login|api/auth|_next|favicon.ico|manifest.webmanifest|icons/|sw.js|offline.html).*)'],
};
