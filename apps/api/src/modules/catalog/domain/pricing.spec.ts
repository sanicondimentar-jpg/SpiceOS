import { changePct, marginPct, minPriceForMargin, priceFromCost, slugify } from './pricing';

describe('pricing', () => {
  it('calcula precio desde costo y redondea hacia arriba', () => {
    expect(priceFromCost(1000, 1.55)).toBe(1550);
    expect(priceFromCost(1001, 1.55, 10)).toBe(1560); // 1551.55 → 1560
    expect(priceFromCost(333.33, 1.5, 1)).toBe(500);
    expect(priceFromCost(0, 1.55)).toBe(0);
  });

  it('no sube un precio que ya es múltiplo por error de coma flotante', () => {
    expect(priceFromCost(100, 1.1, 10)).toBe(110); // 110.00000000000001
  });

  it('calcula margen sobre precio de venta', () => {
    expect(marginPct(1550, 1000)).toBe(35.48);
    expect(marginPct(null, 1000)).toBeNull();
    expect(marginPct(900, 1000)).toBe(-11.11);
  });

  it('calcula variación de costo', () => {
    expect(changePct(1000, 1150)).toBe(15);
    expect(changePct(0, 1150)).toBeNull();
  });

  it('calcula el precio mínimo para un margen', () => {
    expect(minPriceForMargin(750, 25)).toBe(1000);
  });

  it('genera slugs sin acentos', () => {
    expect(slugify('Pimentón & Ají')).toBe('pimenton-aji');
  });
});
