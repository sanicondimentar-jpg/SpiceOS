import { allocateFefo } from './fefo';

const d = (s: string) => new Date(s);

describe('allocateFefo', () => {
  it('consume primero el lote que vence antes', () => {
    const r = allocateFefo(
      [
        { stockItemId: 'a', lotId: 'L2', expiresAt: d('2027-06-01'), available: 10 },
        { stockItemId: 'b', lotId: 'L1', expiresAt: d('2027-01-01'), available: 4 },
      ],
      6,
    );
    expect(r).toEqual([
      { stockItemId: 'b', lotId: 'L1', quantity: 4 },
      { stockItemId: 'a', lotId: 'L2', quantity: 2 },
    ]);
  });

  it('devuelve null si no alcanza', () => {
    expect(allocateFefo([{ stockItemId: 'a', lotId: null, expiresAt: null, available: 1 }], 2)).toBeNull();
  });
});
