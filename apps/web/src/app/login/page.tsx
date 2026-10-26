'use client';

import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">S</div>
        <h1 className="text-xl font-semibold">SpiceOS</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ingresá con tu cuenta de la empresa</p>
        <Button className="mt-6 w-full" onClick={() => signIn('keycloak', { callbackUrl: '/' })}>
          Ingresar
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">Acceso protegido con verificación en dos pasos</p>
      </div>
    </main>
  );
}
