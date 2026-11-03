import { nextStatus } from './message-status';

describe('nextStatus', () => {
  it('avanza enviado → entregado → leído', () => {
    expect(nextStatus('SENT', 'delivered')).toBe('DELIVERED');
    expect(nextStatus('DELIVERED', 'read')).toBe('READ');
  });
  it('no retrocede si los avisos llegan desordenados', () => {
    expect(nextStatus('READ', 'delivered')).toBe('READ');
    expect(nextStatus('DELIVERED', 'sent')).toBe('DELIVERED');
  });
  it('marca fallido salvo que ya se haya entregado', () => {
    expect(nextStatus('SENT', 'failed')).toBe('FAILED');
    expect(nextStatus('READ', 'failed')).toBe('READ');
  });
  it('ignora estados desconocidos', () => {
    expect(nextStatus('SENT', 'deleted')).toBe('SENT');
  });
});
