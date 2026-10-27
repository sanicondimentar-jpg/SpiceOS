'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { OrderForm, type OrderFormSubmit } from '@/components/orders/order-form';
import { useMe } from '@/lib/hooks';
import { useCreateOrder } from '@/lib/orders';
import { api } from '@/lib/api';

export default function NewOrderPage() {
  return (
    <Suspense>
      <NewOrder />
    </Suspense>
  );
}

function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreateOrder();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const canConfirm = me?.permissions.includes('orders.order.confirm');
  const customerId = params.get('customerId');
  const customerName = params.get('customerName');

  const save = async (data: OrderFormSubmit, confirm: boolean) => {
    setError(null);
    try {
      const { id } = await create.mutateAsync({ ...data, channel: 'sales_rep' });
      // Si la confirmación falla (por ejemplo, falta stock) el pedido queda en borrador y su ficha muestra el motivo.
      const failure = confirm ? await api(`/orders/${id}/confirm`, { method: 'POST' }).then(() => null, (e: Error) => e.message) : null;
      router.push(`/orders/${id}${failure ? `?error=${encodeURIComponent(failure)}` : ''}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Nuevo pedido</h1>
        <Link href="/orders" className="ml-auto text-sm text-muted-foreground hover:underline">Cancelar</Link>
      </div>
      <OrderForm
        initial={customerId && customerName ? { customer: { id: customerId, name: customerName } } : undefined}
        submitting={create.isPending}
        error={error}
        actions={[
          { label: 'Guardar borrador', variant: canConfirm ? 'outline' : 'default', onSubmit: (d) => save(d, false) },
          ...(canConfirm ? [{ label: 'Guardar y confirmar', onSubmit: (d: OrderFormSubmit) => save(d, true) }] : []),
        ]}
      />
    </div>
  );
}
