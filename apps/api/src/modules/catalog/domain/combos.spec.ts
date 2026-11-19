import { kitAvailable } from '../../inventory/inventory.facade';
import { comboCode, comboSku, firstPurchaseDiscountPct } from './combos';

describe('combos', () => {
  it('pasa del código corto al SKU y vuelta (y "BASICO" es el Combo Chef)', () => {
    expect(comboSku('esencial')).toBe('COMBO-ESENCIAL');
    expect(comboSku('COMBO-ESENCIAL')).toBe('COMBO-ESENCIAL');
    expect(comboSku('BASICO')).toBe('COMBO-CHEF');
    expect(comboCode('COMBO-CHEF')).toBe('CHEF');
  });

  it('solo el Combo Chef tiene descuento de primera compra', () => {
    expect(firstPurchaseDiscountPct('COMBO-CHEF')).toBe(10);
    expect(firstPurchaseDiscountPct('COMBO-ESENCIAL')).toBe(0);
  });

  it('alcanza para tantos combos como permita el sobre más escaso', () => {
    const available = new Map([
      ['a', 25],
      ['b', 7],
    ]);
    expect(kitAvailable([{ variantId: 'a', quantity: 10 }, { variantId: 'b', quantity: 1 }], available)).toBe(2);
    expect(kitAvailable([{ variantId: 'a', quantity: 1 }, { variantId: 'c', quantity: 1 }], available)).toBe(0);
    expect(kitAvailable([{ variantId: 'b', quantity: 1 }], new Map([['b', -3]]))).toBe(0);
  });
});
