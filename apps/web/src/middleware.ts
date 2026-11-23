export { default } from 'next-auth/middleware';

// Todo requiere sesión salvo login y los endpoints de auth.
// Los archivos de la app instalable (manifest, íconos, service worker) se sirven sin sesión.
export const config = { matcher: ['/((?!login|api/auth|_next|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)'] };
