'use client';

import { getSession, signOut } from 'next-auth/react';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Cliente HTTP de la web: agrega el token y la empresa activa; errores en formato RFC 7807. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  return res.json() as Promise<T>;
}

/** Descarga un archivo (por ejemplo una plantilla .xlsx) y lo guarda con el nombre indicado. */
export async function download(path: string, filename: string): Promise<void> {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const session = (await getSession()) as { accessToken?: string; error?: string } | null;
  if (session?.error === 'RefreshAccessTokenError') sessionExpired();
  const org = typeof window !== 'undefined' ? window.localStorage.getItem('spiceos.org') : null;
  // Con FormData el navegador arma el Content-Type multipart con su boundary.
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(!isForm && { 'Content-Type': 'application/json' }),
      ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
      ...(org && { 'x-spiceos-org': org }),
      ...init.headers,
    },
  });
  if (res.status === 401) sessionExpired();
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { title?: string; detail?: string };
    throw new ApiError(res.status, problem.detail ?? problem.title ?? `Error ${res.status}`);
  }
  return res;
}

/**
 * La sesión de Keycloak venció (o el token ya no sirve): se cierra la sesión local y se vuelve al login,
 * en vez de dejar la pantalla abierta con todo vacío. Una sola vez aunque fallen varias consultas juntas.
 */
let redirecting = false;
function sessionExpired() {
  if (redirecting || typeof window === 'undefined') return;
  redirecting = true;
  void signOut({ callbackUrl: '/login?expired=1' });
}
