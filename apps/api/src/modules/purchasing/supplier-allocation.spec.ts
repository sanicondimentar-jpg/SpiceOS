import { allocatePayment, purchaseStatus } from './supplier-allocation';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('allocatePayment', () => {
  it('un solo pago cubre las dos compras, primero la más vieja', () => {
    const r = allocatePayment(100_000, [
      { id: 'b', date: d('2026-11-13'), balance: 54_692 },
      { id: 'a', date: d('2026-10-30'), balance: 45_308 },
    ]);
    expect(r.allocations).toEqual([
      { purchaseId: 'a', amount: 45_308 },
      { purchaseId: 'b', amount: 54_692 },
    ]);
    expect(r.unallocated).toBe(0);
  });

  it('si no alcanza, la más nueva queda en parte', () => {
    const r = allocatePayment(50_000, [
      { id: 'a', date: d('2026-10-30'), balance: 45_308 },
      { id: 'b', date: d('2026-11-13'), balance: 54_692 },
    ]);
    expect(r.allocations).toEqual([
      { purchaseId: 'a', amount: 45_308 },
      { purchaseId: 'b', amount: 4_692 },
    ]);
    expect(r.unallocated).toBe(0);
  });

  it('lo que sobra queda a cuenta', () => {
    const r = allocatePayment(1000.5, [{ id: 'a', date: d('2026-10-30'), balance: 800.25 }]);
    expect(r.allocations).toEqual([{ purchaseId: 'a', amount: 800.25 }]);
    expect(r.unallocated).toBe(200.25);
  });

  it('sin compras elegidas, todo a cuenta', () => {
    expect(allocatePayment(500, [])).toEqual({ allocations: [], unallocated: 500 });
  });
});

describe('purchaseStatus', () => {
  it('pendiente, en parte y pagada', () => {
    expect(purchaseStatus(100, 0, false)).toBe('UNPAID');
    expect(purchaseStatus(100, 40, false)).toBe('PARTIAL');
    expect(purchaseStatus(100, 99.999, false)).toBe('PAID');
    expect(purchaseStatus(100, 0, true)).toBe('CANCELLED');
  });
});
