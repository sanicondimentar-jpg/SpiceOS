import { normalizePhone, phoneVariants } from './customer';

describe('normalizePhone (Argentina)', () => {
  it.each([
    ['011 4444-5555', '+541144445555'],
    ['11 4444 5555', '+541144445555'],
    ['011 15-4444-5555', '+5491144445555'],
    ['0351 15 555-1234', '+5493515551234'],
    ['02954 15 55-1234', '+5492954551234'],
    ['5491144445555', '+5491144445555'], // así llega desde WhatsApp
    ['+54 9 11 4444-5555', '+5491144445555'],
    ['+54 11 4444-5555', '+541144445555'],
    ['+598 99 123 456', '+59899123456'], // Uruguay: no se toca
    ['0059899123456', '+59899123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('devuelve null sin dígitos', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('-')).toBeNull();
  });

  it('un número cargado sin 9 coincide con el WhatsApp entrante', () => {
    expect(phoneVariants('011 4444-5555')).toContain('+5491144445555');
    expect(phoneVariants('5491144445555')).toContain('+541144445555');
    expect(phoneVariants('+598 99 123 456')).toEqual(['+59899123456']);
  });
});
