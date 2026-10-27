import { lotCodeFor } from './lot-code';

describe('lotCodeFor', () => {
  it('respeta el lote cargado y, si falta, lo arma con el vencimiento', () => {
    expect(lotCodeFor('L24', new Date('2027-12-01'))).toBe('L24');
    expect(lotCodeFor(undefined, new Date('2027-12-01'))).toBe('V2027-12-01');
    expect(lotCodeFor(undefined, undefined)).toBeUndefined();
  });
});
