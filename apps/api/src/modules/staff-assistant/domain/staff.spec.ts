import { instructionActive, instructionsForSales, isAffirmative } from './staff';

describe('isAffirmative', () => {
  it.each(['sí', 'Si', 'dale', 'Dale!', 'ok', 'Sí, confirmo', 'de una', 'confirmado', 'sí dale', 'listo, hacelo'])('"%s" confirma', (t) =>
    expect(isAffirmative(t)).toBe(true),
  );
  it.each(['no', 'sí pero cambiá a 5', 'si, no, esperá', 'mmm', '', 'cuánto stock hay de pimentón?', 'dale, pero que sean 3 cajas', 'ok cancelalo'])('"%s" no confirma', (t) =>
    expect(isAffirmative(t)).toBe(false),
  );
});

describe('instructionActive', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  it('sin fecha sigue hasta que la corten', () => expect(instructionActive({ revokedAt: null, until: null }, now)).toBe(true));
  it('vale hasta el día de fin inclusive', () => expect(instructionActive({ revokedAt: null, until: new Date('2026-11-23') }, now)).toBe(true));
  it('vencida no vale', () => expect(instructionActive({ revokedAt: null, until: new Date('2026-11-22') }, now)).toBe(false));
  it('cortada no vale', () => expect(instructionActive({ revokedAt: new Date(), until: null }, now)).toBe(false));
});

describe('instructionsForSales', () => {
  it('sin indicaciones no agrega nada', () => expect(instructionsForSales([])).toBeNull());
  it('lista las indicaciones', () => expect(instructionsForSales(['Ofrecé el Combo Esencial'])).toContain('- Ofrecé el Combo Esencial'));
});
