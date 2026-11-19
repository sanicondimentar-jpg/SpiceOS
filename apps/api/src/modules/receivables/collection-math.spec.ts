import { allocate, allocateParts, chargeStatus, dueNotices, todayAr, waNumber } from './collection-math';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const c = (id: string, due: string, balance: number) => ({ id, date: d('2026-11-01'), dueDate: d(due), balance });

describe('cobranza', () => {
  it('imputa de la deuda que vence primero a la última y deja el resto a cuenta', () => {
    const r = allocate(60000, [c('b', '2026-12-20', 30000), c('a', '2026-12-10', 53500)]);
    expect(r.allocations).toEqual([{ chargeId: 'a', amount: 53500 }, { chargeId: 'b', amount: 6500 }]);
    expect(r.unallocated).toBe(0);
    expect(allocate(1000, []).unallocated).toBe(1000);
  });

  it('un cobro mitad efectivo y mitad transferencia cubre la misma deuda sin pasarse', () => {
    const [cash, account] = allocateParts([{ key: 'CASH', amount: 20000 }, { key: 'ACCOUNT', amount: 40000 }], [c('a', '2026-12-10', 53500)]);
    expect(cash!.allocations).toEqual([{ chargeId: 'a', amount: 20000 }]);
    expect(account!.allocations).toEqual([{ chargeId: 'a', amount: 33500 }]);
    expect(account!.unallocated).toBe(6500);
  });

  it('estado según lo cobrado', () => {
    expect(chargeStatus(100, 0, false)).toBe('UNPAID');
    expect(chargeStatus(100, 40, false)).toBe('PARTIAL');
    expect(chargeStatus(100, 100, false)).toBe('PAID');
    expect(chargeStatus(100, 0, true)).toBe('CANCELLED');
  });

  it('avisa 10 días antes a Nacho y al vencer a Nacho y al cliente', () => {
    expect(dueNotices(d('2026-12-10'), d('2026-11-25'), 10)).toEqual([]);
    expect(dueNotices(d('2026-12-10'), d('2026-11-30'), 10)).toEqual(['OWNER_BEFORE']);
    expect(dueNotices(d('2026-12-10'), d('2026-12-09'), 10)).toEqual(['OWNER_BEFORE']);
    expect(dueNotices(d('2026-12-10'), d('2026-12-10'), 10)).toEqual(['OWNER_DUE', 'CUSTOMER_DUE']);
    expect(dueNotices(d('2026-12-10'), d('2026-12-15'), 10)).toEqual(['OWNER_DUE', 'CUSTOMER_DUE']);
  });

  it('hoy en Argentina (UTC-3)', () => {
    expect(todayAr(new Date('2026-11-20T02:00:00Z'))).toBe('2026-11-19');
    expect(todayAr(new Date('2026-11-20T03:30:00Z'))).toBe('2026-11-20');
  });

  it('número de WhatsApp con el 9 de celular', () => {
    expect(waNumber('+54 9 11 7058-0234')).toBe('5491170580234');
    expect(waNumber('+541170580234')).toBe('5491170580234');
    expect(waNumber('11 7058-0234')).toBe('5491170580234');
    expect(waNumber('123')).toBeNull();
  });
});
