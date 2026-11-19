import { lapsedCustomers } from './lapsed';
import { previousPeriod } from './insights.service';

const row = (id: string, orders: number, first: string, last: string, avg = 50_000) => ({
  customer_id: id, name: id, phone: null, orders, first_order: first, last_order: last, avg_ticket: avg,
});

describe('lapsedCustomers', () => {
  it('marca al que compraba cada 10 días y hace 30 que no compra', () => {
    const r = lapsedCustomers([row('a', 4, '2026-09-01', '2026-09-30')], '2026-10-30');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ usualEveryDays: 10, daysSinceLastOrder: 30 });
  });

  it('no marca antes de 21 días aunque compre seguido', () => {
    expect(lapsedCustomers([row('a', 10, '2026-10-01', '2026-10-10')], '2026-10-25')).toHaveLength(0);
  });

  it('a los de una sola compra los marca a los 45 días', () => {
    expect(lapsedCustomers([row('a', 1, '2026-10-01', '2026-10-01')], '2026-11-10')).toHaveLength(0);
    expect(lapsedCustomers([row('a', 1, '2026-10-01', '2026-10-01')], '2026-11-15')).toHaveLength(1);
  });

  it('ordena por lo que compraba', () => {
    const r = lapsedCustomers(
      [row('chico', 2, '2026-08-01', '2026-08-15', 10_000), row('grande', 2, '2026-08-01', '2026-08-15', 90_000)],
      '2026-11-01',
    );
    expect(r.map((x) => x.customerId)).toEqual(['grande', 'chico']);
  });
});

describe('previousPeriod', () => {
  it('devuelve el período anterior del mismo largo', () => {
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(previousPeriod('2026-11-01', '2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
  });
});
