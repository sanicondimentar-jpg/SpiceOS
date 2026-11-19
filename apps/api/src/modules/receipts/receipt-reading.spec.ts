import { toReading, type CatalogVariant } from './receipt-reading';

const catalog: CatalogVariant[] = [
  { id: 'v-aves', sku: '386', product: 'Condimento para Aves 151', presentation: 'Bolsa 1 kg', cost: 9508 },
  { id: 'v-aji', sku: '253', product: 'Ají Molido', presentation: 'Bolsa 1 kg', cost: 10440 },
];

describe('toReading', () => {
  it('cruza por SKU, aplica el descuento al costo y arma la referencia con la fecha', () => {
    const r = toReading(
      {
        reference: null,
        date: '2026-11-13',
        supplier: null,
        discountPct: 20,
        total: 54692,
        lines: [
          { text: 'COND. PARA AVES 1000', quantity: 2, unitPrice: 11885.48, sku: '386' },
          { text: 'AJI MOLIDO 1000', quantity: 1, unitPrice: 13049.57, sku: '253' },
        ],
      },
      catalog,
    );
    expect(r.reference).toBe('Remito 13/11/2026');
    expect(r.lines).toEqual([
      expect.objectContaining({ variantId: 'v-aves', quantity: 2, unitCost: 9508.38, currentCost: 9508 }),
      expect.objectContaining({ variantId: 'v-aji', quantity: 1, unitCost: 10439.66 }),
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it('deja aparte lo que no reconoce y junta renglones del mismo producto', () => {
    const r = toReading(
      {
        reference: '0001-00000042',
        date: '13/11/2026',
        supplier: 'Especias 51',
        discountPct: null,
        total: null,
        lines: [
          { text: 'Ají 1 kg', quantity: 1, unitPrice: null, sku: '253' },
          { text: 'Ají molido x kg', quantity: 2, unitPrice: null, sku: '253' },
          { text: 'Pimentón', quantity: 3, unitPrice: null, sku: null },
          { text: 'Otro', quantity: 1, unitPrice: null, sku: '999' },
        ],
      },
      catalog,
    );
    expect(r.reference).toBe('0001-00000042');
    expect(r.documentDate).toBeNull();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ quantity: 3, unitCost: null });
    expect(r.unmatched).toEqual([{ sourceText: 'Pimentón', quantity: 3 }, { sourceText: 'Otro', quantity: 1 }]);
  });
});
