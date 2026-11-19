import { displayStatus, isEditable, todayAr, validUntilFrom } from './quote-status';

describe('presupuestos: estado', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it('un presupuesto abierto con la validez pasada se ve vencido', () => {
    expect(displayStatus('SENT', d('2026-11-10'), '2026-11-11')).toBe('EXPIRED');
    expect(displayStatus('DRAFT', d('2026-11-10'), '2026-11-10')).toBe('DRAFT');
  });

  it('los cerrados no cambian aunque haya pasado la validez', () => {
    expect(displayStatus('ACCEPTED', d('2026-01-01'), '2026-11-11')).toBe('ACCEPTED');
    expect(displayStatus('REJECTED', d('2026-01-01'), '2026-11-11')).toBe('REJECTED');
  });

  it('solo los abiertos se editan', () => {
    expect(isEditable('SENT')).toBe(true);
    expect(isEditable('ACCEPTED')).toBe(false);
  });

  it('la validez cuenta desde hoy en Argentina', () => {
    expect(validUntilFrom('2026-11-19', 15).toISOString().slice(0, 10)).toBe('2026-12-04');
    // 01:00 UTC del 20 es todavía 19 en Argentina
    expect(todayAr(new Date('2026-11-20T01:00:00Z'))).toBe('2026-11-19');
  });
});
