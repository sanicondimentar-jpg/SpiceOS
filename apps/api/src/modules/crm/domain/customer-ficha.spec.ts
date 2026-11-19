import { Customer, missingFields } from './customer';

const base = () =>
  Customer.create({ tenantId: 't', code: 'C000001', legalName: 'Rotisería La Salvadora', paymentTermsDays: 0, source: 'whatsapp', phone: null });

describe('ficha del cliente', () => {
  it('marca qué falta para completarla', () => {
    expect(missingFields({ phone: null, addressCount: 0 })).toEqual(['phone', 'address']);
    expect(missingFields({ phone: '+5491144445555', addressCount: 0 })).toEqual(['address']);
    expect(missingFields({ phone: '+5491144445555', addressCount: 1 })).toEqual([]);
  });

  it('guarda el teléfono solo si la ficha no tenía', () => {
    const c = base();
    expect(c.setPhoneIfMissing('11 15-4444-5555')).toBe(true);
    expect(c.snapshot().phone).toBe('+5491144445555');
    expect(c.setPhoneIfMissing('11 15-9999-0000')).toBe(false);
    expect(c.snapshot().phone).toBe('+5491144445555');
  });

  it('no deja borrar el teléfono', () => {
    const c = base();
    c.setPhoneIfMissing('11 15-4444-5555');
    expect(() => c.update({ phone: '' }, c.version)).toThrow('obligatorio');
  });

  it('guarda días y horario de recepción', () => {
    const c = base();
    c.update({ deliveryDays: ['LUN', 'JUE'], deliveryHours: '8 a 12' }, c.version);
    expect(c.snapshot()).toMatchObject({ deliveryDays: ['LUN', 'JUE'], deliveryHours: '8 a 12' });
  });
});
