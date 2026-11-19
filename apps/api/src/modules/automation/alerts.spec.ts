import { DEFAULT_ALERT_SETTINGS, resolveSettings, sortAlerts, type Alert } from './alerts';

describe('avisos', () => {
  it('sin nada guardado usa los valores por defecto', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('respeta lo guardado y acota los umbrales', () => {
    const s = resolveSettings({ lowStock: { enabled: false }, expiring: { enabled: true, value: 9999 }, webOrders: { value: 0 } });
    expect(s.lowStock.enabled).toBe(false);
    expect(s.expiring.value).toBe(365);
    expect(s.webOrders).toEqual({ enabled: true, value: 2 });
    expect(s.overdueDebt).toEqual({ enabled: true });
  });

  it('ordena por gravedad y después por tipo', () => {
    const a = (kind: Alert['kind'], severity: Alert['severity']): Alert => ({ kind, severity, title: kind, detail: '', link: '' });
    expect(sortAlerts([a('lapsedCustomers', 'low'), a('lowStock', 'medium'), a('expiring', 'high'), a('overdueDebt', 'medium')]).map((x) => x.kind)).toEqual([
      'expiring', 'overdueDebt', 'lowStock', 'lapsedCustomers',
    ]);
  });
});
