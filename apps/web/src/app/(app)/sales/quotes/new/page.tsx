'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { OrderForm, type OrderFormSubmit } from '@/components/orders/order-form';
import { useCreateQuote } from '@/lib/sales';

export default function NewQuotePage() {
  return (
    <Suspense>
      <NewQuote />
    </Suspense>
  );
}

function NewQuote() {
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreateQuote();
  const [error, setError] = useState<string | null>(null);
  const customerId = params.get('customerId');
  const customerName = params.get('customerName');

  const save = async (d: OrderFormSubmit) => {
    setError(null);
    try {
      const { id } = await create.mutateAsync({
        customerId: d.customerId,
        branchId: d.branchId,
        withInvoice: d.withInvoice,
        validDays: d.validDays ?? 15,
        notes: d.notes,
        lines: d.lines,
      });
      router.push(`/sales/quotes/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Nuevo presupuesto</h1>
        <Link href="/sales" className="ml-auto text-sm text-muted-foreground hover:underline">Cancelar</Link>
      </div>
      <p className="text-sm text-muted-foreground">No reserva stock. Cuando el cliente acepte, lo pasás a pedido con los mismos precios.</p>
      <OrderForm
        quote
        initial={customerId && customerName ? { customer: { id: customerId, name: customerName } } : undefined}
        submitting={create.isPending}
        error={error}
        actions={[{ label: 'Guardar presupuesto', onSubmit: save }]}
      />
    </div>
  );
}
