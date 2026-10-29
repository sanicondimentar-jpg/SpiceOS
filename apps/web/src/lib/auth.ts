import type { NextAuthOptions } from 'next-auth';
import KeycloakProvider from 'next-auth/providers/keycloak';

/** La sesión se cierra tras 2 horas sin uso (igual que la sesión del cliente spiceos-web en Keycloak). */
const SESSION_IDLE_SECONDS = 2 * 60 * 60;

/**
 * OIDC con Keycloak (PKCE + MFA configurados en el realm).
 * El access token vive 5 min; se renueva con el refresh token rotativo antes de vencer.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_WEB_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_WEB_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER,
      authorization: { params: { scope: 'openid profile email organization' } },
      checks: ['pkce', 'state'],
    }),
  ],
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_SECONDS },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: (account.expires_at ?? 0) * 1000,
        };
      }
      if (Date.now() < (token.expiresAt as number) - 30_000) return token;
      return refresh(token);
    },
    async session({ session, token }) {
      return { ...session, accessToken: token.accessToken as string, error: token.error as string | undefined };
    },
  },
  pages: { signIn: '/login' },
};

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

/**
 * Cada consulta de la web pide la sesión, y al vencer el access token varias lo renuevan a la vez con el mismo
 * refresh token. Keycloak acepta cada refresh token una sola vez: sin esto la segunda renovación fallaba y la
 * sesión se cerraba a los pocos minutos. Las renovaciones con el mismo token comparten un único pedido.
 */
const refreshing = new Map<string, Promise<Tokens>>();

async function refresh(token: Record<string, unknown>) {
  const refreshToken = token.refreshToken as string;
  let pending = refreshing.get(refreshToken);
  if (!pending) {
    pending = requestTokens(refreshToken);
    refreshing.set(refreshToken, pending);
    setTimeout(() => refreshing.delete(refreshToken), 60_000);
  }
  try {
    return { ...token, ...(await pending) };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

async function requestTokens(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.KEYCLOAK_WEB_CLIENT_ID!,
      client_secret: process.env.KEYCLOAK_WEB_CLIENT_SECRET!,
    }),
  });
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  if (!res.ok) throw json;
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
}
