'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { useProducts } from '@/lib/catalog';
import { ENTITY_LABEL, type DocumentEntity } from '@/lib/documents';
import { useCustomers } from '@/lib/hooks';
import { useSuppliers } from '@/lib/purchasing';

export interface EntityValue {
  type: DocumentEntity | '';
  id: string;
}

/** A qué producto, proveedor o cliente corresponde un documento (opcional). */
export function EntityPicker({ value, onChange, idPrefix }: { value: EntityValue; onChange: (v: EntityValue) => void; idPrefix: string }) {
  const [q, setQ] = useState('');
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
      <Select
        id={`${idPrefix}-type`}
        aria-label="Corresponde a"
        value={value.type}
        onChange={(e) => {
          setQ('');
          onChange({ type: e.target.value as DocumentEntity | '', id: '' });
        }}
      >
        <option value="">Nada en particular</option>
        {(Object.keys(ENTITY_LABEL) as DocumentEntity[]).map((k) => (
          <option key={k} value={k}>{ENTITY_LABEL[k]}</option>
        ))}
      </Select>
      {value.type && (
        <div className="flex gap-2">
          {value.type !== 'supplier' && <Input aria-label="Buscar" placeholder="Buscar…" className="w-32" value={q} onChange={(e) => setQ(e.target.value)} />}
          <Options type={value.type} q={q} value={value.id} onChange={(id) => onChange({ type: value.type, id })} />
        </div>
      )}
    </div>
  );
}

function Options({ type, q, value, onChange }: { type: DocumentEntity; q: string; value: string; onChange: (id: string) => void }) {
  const products = useProducts(type === 'product' ? q : '', 1, true);
  const customers = useCustomers(type === 'customer' ? q : '', 1);
  const suppliers = useSuppliers();
  const options =
    type === 'product'
      ? (products.data?.items ?? []).map((p) => ({ id: p.id, name: p.name }))
      : type === 'customer'
        ? (customers.data?.items ?? []).map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName }))
        : (suppliers.data ?? []).map((s) => ({ id: s.id, name: s.legalName }));
  return (
    <Select aria-label={ENTITY_LABEL[type]} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Elegí {ENTITY_LABEL[type].toLowerCase()}…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </Select>
  );
}
