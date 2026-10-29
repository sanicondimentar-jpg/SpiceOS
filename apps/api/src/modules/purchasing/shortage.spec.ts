import { packSkuOf, packsFor, unitsPerPack } from './shortage';

describe('faltantes', () => {
  it('reconoce el suelto y su caja', () => {
    expect(packSkuOf('50-U')).toBe('50');
    expect(packSkuOf('3017')).toBeNull();
  });

  it('lee los sobres por caja del nombre', () => {
    expect(unitsPerPack('Caja 50 sobres × 25 g')).toBe(50);
    expect(unitsPerPack('Caja 15 sobres × 50 g')).toBe(15);
    expect(unitsPerPack('Bolsa 1 kg')).toBeNull();
  });

  it('abre las cajas que hay y compra el resto', () => {
    expect(packsFor(30, 25, 0)).toEqual({ open: 0, buy: 2 });
    expect(packsFor(30, 25, 1)).toEqual({ open: 1, buy: 1 });
    expect(packsFor(25, 25, 5)).toEqual({ open: 1, buy: 0 });
  });
});
