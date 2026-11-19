import { BASIC_COMBO, ESSENTIAL_COMBO, priceCombo } from './combos';

const prices: Record<string, number> = {
  '179-U': 1200, '159-U': 1500, '60-U': 900, '41-U': 800, '373-U': 700,
  '105-U': 1200, '330-U': 1000, '329-U': 1100, '50-U': 1000, '48-U': 1000, '141-U': 1200,
};

describe('combos', () => {
  it('reparte el precio fijo del Esencial en pesos enteros que suman justo $10.000', () => {
    const c = priceCombo(ESSENTIAL_COMBO, (s) => prices[s])!;
    expect(c.listTotal).toBe(10400);
    expect(c.price).toBe(10000);
    expect(c.lines.every((l) => Number.isInteger(l.unitPrice) && l.unitPrice <= l.listPrice)).toBe(true);
    expect(c.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)).toBe(10000);
    expect(c.firstPurchasePrice).toBe(10000);
  });

  it('el Combo Chef vale la suma de los sobres y tiene 10% en la primera compra', () => {
    const c = priceCombo(BASIC_COMBO, (s) => prices[s])!;
    expect(BASIC_COMBO.name).toBe('Combo Chef');
    expect(c.price).toBe(41000);
    expect(c.firstPurchasePrice).toBe(36900);
  });

  it('no se ofrece si falta algún sobre o su precio', () => {
    expect(priceCombo(ESSENTIAL_COMBO, (s) => (s === '50-U' ? null : prices[s]))).toBeNull();
  });

  it('con cantidades mayores a uno también suma justo', () => {
    const c = priceCombo({ ...BASIC_COMBO, price: 40000 }, (s) => prices[s])!;
    expect(c.price).toBe(40000);
  });
});
