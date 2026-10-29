import { normalizeOrderNumber } from './web-orders.service';

describe('número de pedido para el seguimiento', () => {
  it('acepta el número como lo escriba el cliente', () => {
    expect(normalizeOrderNumber('PED-00000012')).toBe('PED-00000012');
    expect(normalizeOrderNumber('ped 12')).toBe('PED-00000012');
    expect(normalizeOrderNumber(' 12 ')).toBe('PED-00000012');
  });
});
