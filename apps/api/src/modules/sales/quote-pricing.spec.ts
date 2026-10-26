import { priceLines } from './quote-pricing';
import type { PricedVariant } from '../catalog/catalog.facade';

const catalog = new Map<string, PricedVariant>([
  ['v1', { variantId: 'v1', sku: 'PIM-1KG', name: 'Pimentón 1 kg', listPrice: 10000, cost: 6000, minMarginPct: 25 }],
]);

describe('priceLines', () => {
  it('usa el precio de lista y calcula margen', () => {
    const r = priceLines([{ variantId: 'v1', quantity: 2, discountPct: 0 }], catalog, 10);
    expect(r.total).toBe(20000);
    expect(r.marginTotal).toBe(8000);
    expect(r.approvalReasons).toHaveLength(0);
  });

  it('pide aprobación si el descuento supera el tope del rol', () => {
    const r = priceLines([{ variantId: 'v1', quantity: 1, discountPct: 15 }], catalog, 10);
    expect(r.approvalReasons[0]).toContain('descuento 15%');
  });

  it('pide aprobación si el margen queda bajo el mínimo', () => {
    const r = priceLines([{ variantId: 'v1', quantity: 1, unitPrice: 7000, discountPct: 0 }], catalog, 50);
    expect(r.approvalReasons[0]).toContain('margen');
  });
});
