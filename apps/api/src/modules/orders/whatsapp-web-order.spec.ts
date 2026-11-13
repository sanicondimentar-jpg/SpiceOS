import { parseWebOrderMessage } from './whatsapp-web-order';

const franco = `*Pedido — Sabor a Casa*
Modo: Mayorista
Cliente: Rotiseria la Salvadora
Teléfono: 116361-4127

1) [386] Condimento para Aves 151 — × 1 kg
   1 × $ 13.700 = $ 13.700
2) [181] Pimentón Flor Selecto — × 1 kg
   1 × $ 12.100 = $ 12.100
3) [253] Ají Molido — × 1 kg
   1 × $ 15.100 = $ 15.100
4) [133] Orégano en Hojas — × 1 kg
   2 × $ 12.600 = $ 25.200

*TOTAL: $ 66.100*
(Precios netos en ARS, sin IVA)

Observaciones: Martes, Miercoles y Jueves a partir de las 16hs
Viernes y sabados, a partir de las 11.30hs`;

describe('pedido de la web que llegó por WhatsApp', () => {
  it('lee el pedido que la web no pudo registrar', () => {
    const o = parseWebOrderMessage(franco, '+5491163614127');
    expect(o).toEqual({
      name: 'Rotiseria la Salvadora',
      phone: '116361-4127',
      notes: 'Martes, Miercoles y Jueves a partir de las 16hs\nViernes y sabados, a partir de las 11.30hs',
      mode: 'mayorista',
      lines: [
        { sku: '386', quantity: 1 },
        { sku: '181', quantity: 1 },
        { sku: '253', quantity: 1 },
        { sku: '133', quantity: 2 },
      ],
      total: 66100,
    });
  });

  it('en modo minorista pide los sueltos (-U)', () => {
    const o = parseWebOrderMessage(
      `*Pedido — Sabor a Casa*\nModo: Minorista\nCliente: Ana\n\n1) [50] Comino — Sobre 50 g\n   3 × $ 900 = $ 2.700\n\n*TOTAL: $ 2.700*`,
      '+5491100000000',
    );
    expect(o?.mode).toBe('minorista');
    expect(o?.lines).toEqual([{ sku: '50-U', quantity: 3 }]);
    expect(o?.phone).toBe('+5491100000000');
  });

  it('ignora el pedido que ya trae número (ya está registrado) y los mensajes comunes', () => {
    expect(parseWebOrderMessage(franco.replace('*Pedido —', '*Pedido PED-00000007 —'), '+54911')).toBeNull();
    expect(parseWebOrderMessage('Hola, quería hacer un pedido', '+54911')).toBeNull();
    expect(parseWebOrderMessage(null, '+54911')).toBeNull();
  });

  it('deja afuera de las observaciones el link de seguimiento', () => {
    const o = parseWebOrderMessage(`${franco}\n\nSeguí tu pedido: https://www.saboracasa.com.ar/seguimiento`, '+54911');
    expect(o?.notes).not.toContain('Seguí');
  });
});
