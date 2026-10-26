export { default } from 'next-auth/middleware';

// Todo requiere sesión salvo login y los endpoints de auth.
export const config = { matcher: ['/((?!login|api/auth|_next|favicon.ico).*)'] };
