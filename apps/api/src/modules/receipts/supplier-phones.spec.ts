import { isAuthorizedPhone, normalizeReceiptPhone } from './supplier-phones';

describe('teléfonos autorizados para remitos', () => {
  it('reconoce el número con o sin +54 9', () => {
    expect(isAuthorizedPhone('5491170580234', ['11 7058-0234'])).toBe(true);
    expect(isAuthorizedPhone('5491170580234', ['+54 9 11 7058 0234'])).toBe(true);
  });

  it('rechaza otros números y los cargados incompletos', () => {
    expect(isAuthorizedPhone('5491170580235', ['11 7058-0234'])).toBe(false);
    expect(isAuthorizedPhone('5491170580234', ['70580234'])).toBe(false);
    expect(isAuthorizedPhone('5491170580234', [])).toBe(false);
    expect(normalizeReceiptPhone('7058-0234')).toBeNull();
  });
});
