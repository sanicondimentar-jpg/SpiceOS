import { catalogText, decide, isWebOrderMessage, priceDraft, toTurns, type CatalogItem, type DecisionInput } from './assistant';

const now = new Date('2026-11-19T15:00:00Z');
const base: DecisionInput = {
  mode: 'ON',
  aiConfigured: true,
  phone: '5491155556666',
  testPhones: [],
  supplierPhones: [],
  handoff: null,
  pausedUntil: null,
  repliesLast24h: 0,
  messageType: 'text',
  text: 'Hola, ¿tienen pimentón?',
  now,
};

describe('cuándo contesta el asistente', () => {
  it('contesta un mensaje normal con el asistente encendido', () => {
    expect(decide(base)).toEqual({ answer: true });
  });

  it('apagado o sin clave de IA no contesta', () => {
    expect(decide({ ...base, mode: 'OFF' }).answer).toBe(false);
    expect(decide({ ...base, aiConfigured: false }).answer).toBe(false);
  });

  it('en modo prueba solo contesta a los teléfonos de prueba', () => {
    expect(decide({ ...base, mode: 'TEST' }).answer).toBe(false);
    expect(decide({ ...base, mode: 'TEST', testPhones: ['11 5555-6666'] }).answer).toBe(true);
  });

  it('nunca atiende a proveedores autorizados', () => {
    expect(decide({ ...base, supplierPhones: ['+54 9 11 5555 6666'] })).toEqual({ answer: false, reason: 'es un proveedor' });
  });

  it('se calla si el chat está derivado o si respondió una persona hace poco', () => {
    expect(decide({ ...base, handoff: 'reclamo' }).answer).toBe(false);
    expect(decide({ ...base, pausedUntil: new Date(now.getTime() + 3600_000) }).answer).toBe(false);
    expect(decide({ ...base, pausedUntil: new Date(now.getTime() - 1000) }).answer).toBe(true);
  });

  it('no contesta reacciones, pedidos armados en la web ni pasado el tope del día', () => {
    expect(decide({ ...base, messageType: 'reaction' }).answer).toBe(false);
    expect(decide({ ...base, text: '*Pedido — Sabor a Casa*\nModo: Mayorista' }).answer).toBe(false);
    expect(decide({ ...base, text: '*Pedido PED-00000012 — Sabor a Casa*' }).answer).toBe(false);
    expect(decide({ ...base, repliesLast24h: 40 }).answer).toBe(false);
  });

  it('reconoce el encabezado de pedido web y no confunde un mensaje cualquiera', () => {
    expect(isWebOrderMessage('Pedido — Sabor a Casa')).toBe(true);
    expect(isWebOrderMessage('Quiero hacer un pedido a Sabor a Casa')).toBe(false);
    expect(isWebOrderMessage(null)).toBe(false);
  });
});

const catalog: CatalogItem[] = [
  { sku: '181', product: 'Pimentón Flor Selecto', presentation: 'Bolsa 1 kg', price: 14400, unitsPerBox: null, inStock: true, loose: false },
  { sku: '386', product: 'Condimento para Aves', presentation: 'Frasco 50 g', price: 24000, unitsPerBox: 12, inStock: false, loose: false },
  { sku: '386-U', product: 'Condimento para Aves', presentation: 'Frasco 50 g', price: 2300, unitsPerBox: null, inStock: false, loose: true },
];

describe('catálogo para el asistente', () => {
  it('muestra precio por caja y por unidad, y el stock', () => {
    const text = catalogText(catalog);
    expect(text).toContain('[386] Condimento para Aves — Frasco 50 g — $ 24.000 por caja de 12 ($ 2.000 c/u) — SIN STOCK');
    expect(text).toContain('[386-U]');
    expect(text).toContain('a confirmar');
    expect(text).toContain('[181] Pimentón Flor Selecto — Bolsa 1 kg — $ 14.400 — hay stock');
  });
});

describe('pedido del asistente', () => {
  it('suma con los precios del catálogo y junta códigos repetidos', () => {
    const d = priceDraft(
      [
        { sku: '181', quantity: 2 },
        { sku: '[181]', quantity: 1 },
        { sku: '386', quantity: 1 },
      ],
      catalog,
      50000,
    );
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]).toMatchObject({ sku: '181', quantity: 3, lineTotal: 43200 });
    expect(d.total).toBe(67200);
    expect(d.belowMinimum).toBe(false);
    expect(d.noStock).toEqual(['386']);
  });

  it('avisa los códigos que no existen y el pedido mínimo', () => {
    const d = priceDraft([{ sku: '999', quantity: 1 }, { sku: '181', quantity: 1 }], catalog, 50000);
    expect(d.unknown).toEqual(['999']);
    expect(d.belowMinimum).toBe(true);
  });
});

describe('historial del chat para el modelo', () => {
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  it('junta mensajes seguidos, marca lo que escribió una persona y empieza por el cliente', () => {
    const turns = toTurns([
      { direction: 'OUTBOUND', type: 'text', body: 'Promo de la semana', transcript: null, sentBy: 'u1', sentAt: at(0) },
      { direction: 'INBOUND', type: 'text', body: 'Hola', transcript: null, sentBy: null, sentAt: at(1) },
      { direction: 'INBOUND', type: 'audio', body: null, transcript: 'quiero pimentón', sentBy: null, sentAt: at(2) },
      { direction: 'OUTBOUND', type: 'text', body: '¡Hola! Sí, tenemos.', transcript: null, sentBy: 'assistant:whatsapp', sentAt: at(3) },
      { direction: 'OUTBOUND', type: 'text', body: 'Te paso precio', transcript: null, sentBy: 'u1', sentAt: at(4) },
      { direction: 'INBOUND', type: 'image', body: null, transcript: null, sentBy: null, sentAt: at(5) },
    ]);
    expect(turns).toEqual([
      { role: 'user', content: 'Hola\n[audio transcripto] quiero pimentón' },
      { role: 'assistant', content: '¡Hola! Sí, tenemos.\n[Respondió una persona del equipo] Te paso precio' },
      { role: 'user', content: '[mandó una foto, que no podés ver]' },
    ]);
  });
});
