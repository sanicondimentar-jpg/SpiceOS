import { normalizeStaffPhone, samePhone } from './staff-phone';

describe('normalizeStaffPhone', () => {
  it.each([
    ['11 5906-3462', '5491159063462'],
    ['1159894229', '5491159894229'],
    ['+54 9 11 5906-3462', '5491159063462'],
    ['011 15 5906-3462', '5491159063462'],
    ['5491159063462', '5491159063462'],
    ['221 15 456-7890', '5492214567890'],
  ])('%s → %s', (raw, wa) => expect(normalizeStaffPhone(raw)).toBe(wa));

  it('rechaza números incompletos', () => expect(normalizeStaffPhone('5906-3462')).toBeNull());
});

describe('samePhone', () => {
  it('compara sin importar el +54 9', () => expect(samePhone('5491159063462', '11 5906-3462')).toBe(true));
  it('distingue números distintos', () => expect(samePhone('5491159063462', '1159894229')).toBe(false));
});
