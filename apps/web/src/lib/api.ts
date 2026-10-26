'use client';

import { getSession } from 'next-auth/react';

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
  const session = (await getSession()) as { accessToken?: string } | null;
  const org = typeof window !== 'undefined' ? window.localStorage.getItem('spiceos.org') : null;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken && { Authorization: `Bearer ${session.accessToken}` }),
      ...(org && { 'x-spiceos-org': org }),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { title?: string };
    throw new ApiError(res.status, problem.title ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
