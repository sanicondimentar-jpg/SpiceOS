import { openableUnits, pickPacks, unitsFromPack } from './pack-sources';

const suelto = { sku: '60-U', name: 'Sobre suelto 25 g (caja de 25)' };

describe('unitsFromPack', () => {
  it('acepta cualquier caja que traiga el mismo sobre', () => {
    expect(unitsFromPack(suelto, { sku: '3018', name: 'Caja 15 sobres × 25 g' })).toBe(15);
    expect(unitsFromPack(suelto, { sku: '60', name: 'Caja 25 sobres × 25 g' })).toBe(25);
    expect(unitsFromPack(suelto, { sku: '58', name: 'Caja 50 sobres × 25 g' })).toBe(50);
  });
  it('rechaza otro tamaño, otro envase, bolsas y otros sueltos', () => {
    expect(unitsFromPack(suelto, { sku: '59', name: 'Caja 25 sobres × 50 g' })).toBeNull();
    expect(unitsFromPack(suelto, { sku: '56', name: 'Caja 50 paquetes × 100 g' })).toBeNull();
    expect(unitsFromPack(suelto, { sku: '253', name: 'Bolsa 1 kg' })).toBeNull();
    expect(unitsFromPack(suelto, { sku: '59-U', name: 'Sobre suelto 50 g (caja de 25)' })).toBeNull();
  });
  it('entiende cartones y frascos', () => {
    expect(unitsFromPack({ sku: '47-U', name: 'Cartón suelto 2 cápsulas (caja de 50)' }, { sku: '47', name: 'Caja 50 cartones × 2 cápsulas' })).toBe(50);
    expect(unitsFromPack({ sku: '204-U', name: 'Frasco suelto 100 cc (caja de 24)' }, { sku: '204', name: 'Caja 24 frascos × 100 cc' })).toBe(24);
  });
  it('con un nombre raro, solo usa su caja de siempre', () => {
    expect(unitsFromPack({ sku: '60-U', name: 'Ají suelto' }, { sku: '60', name: 'Caja 25 sobres × 25 g' })).toBe(25);
    expect(unitsFromPack({ sku: '60-U', name: 'Ají suelto' }, { sku: '58', name: 'Caja 50 sobres × 25 g' })).toBeNull();
  });
});

describe('pickPacks', () => {
  const sources = [
    { variantId: 'a', sku: '3018', available: 1, perPack: 15 },
    { variantId: 'b', sku: '60', available: 4, perPack: 25 },
    { variantId: 'c', sku: '58', available: 2, perPack: 50 },
  ];
  it('abre la caja con más stock', () => {
    expect(pickPacks(3, sources)).toEqual([{ variantId: 'b', sku: '60', perPack: 25, packs: 1 }]);
  });
  it('si hacen falta varias, va siempre por la que más tiene en ese momento', () => {
    // b 4→3→2, empata con c (2) y gana c (trae más sobres); después b vuelve a tener más.
    expect(pickPacks(110, sources)).toEqual([
      { variantId: 'b', sku: '60', perPack: 25, packs: 3 },
      { variantId: 'c', sku: '58', perPack: 50, packs: 1 },
    ]);
  });
  it('si no alcanzan, abre todas', () => {
    expect(pickPacks(1000, sources).reduce((s, p) => s + p.packs, 0)).toBe(7);
    expect(openableUnits(sources)).toBe(15 + 100 + 100);
  });
  it('sin cajas no abre nada', () => {
    expect(pickPacks(5, [{ variantId: 'a', sku: '60', available: 0, perPack: 25 }])).toEqual([]);
  });
});
