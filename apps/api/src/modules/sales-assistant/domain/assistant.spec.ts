import { catalogText, combosInfo, comboText, decide, topSellersText, isWebOrderMessage, webOrderNote, webOrderNumber, priceDraft, toTurns, type CatalogItem, type DecisionInput } from './assistant';

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
    // Los pedidos armados en la web se contestan en el momento (pedido de Nacho: que no espere a un "hola").
    expect(decide({ ...base, text: '*Pedido — Sabor a Casa*\nModo: Mayorista' }).answer).toBe(true);
    expect(decide({ ...base, text: '*Pedido PED-00000012 — Sabor a Casa*' }).answer).toBe(true);
    expect(decide({ ...base, repliesLast24h: 40 }).answer).toBe(false);
  });

  it('reconoce el encabezado de pedido web y no confunde un mensaje cualquiera', () => {
    expect(isWebOrderMessage('Pedido — Sabor a Casa')).toBe(true);
    expect(isWebOrderMessage('Quiero hacer un pedido a Sabor a Casa')).toBe(false);
    expect(isWebOrderMessage(null)).toBe(false);
    expect(webOrderNumber('*Pedido PED-00000012 — Sabor a Casa*\nModo: Minorista')).toBe('PED-00000012');
    expect(webOrderNumber('*Pedido — Sabor a Casa*')).toBeNull();
  });

  it('arma la respuesta inmediata a un pedido web', () => {
    const order = { number: 'PED-00000012', status: 'recibido, por confirmar', retail: false, total: 30_000, lines: ['1 × Pimentón 1 kg = $ 30.000'], hasAddress: false };
    const note = webOrderNote(order, 50_000);
    expect(note).toContain('PED-00000012');
    expect(note).toContain('NO uses registrar_pedido');
    expect(note).toContain('pedido mínimo');
    expect(note).toContain('dirección');
    expect(webOrderNote({ ...order, retail: true, hasAddress: true }, 50_000)).not.toContain('pedido mínimo');
    expect(webOrderNote(null, 50_000)).toContain('todavía no tenemos el número');
  });
});

const catalog: CatalogItem[] = [
  { sku: '181', product: 'Pimentón Flor Selecto', presentation: 'Bolsa 1 kg', price: 14400, unitsPerBox: null, inStock: true, loose: false },
  { sku: '386', product: 'Condimento para Aves', presentation: 'Frasco 50 g', price: 24000, unitsPerBox: 12, inStock: false, loose: false },
  { sku: '386-U', product: 'Condimento para Aves', presentation: 'Frasco 50 g', price: 2300, unitsPerBox: null, inStock: false, loose: true },
];

const loose = (sku: string, product: string, price: number): CatalogItem => ({ sku, product, presentation: 'Sobre 25 g', price, unitsPerBox: null, inStock: false, loose: true });
const comboItems = [loose('179-U', 'Pimienta Negra Molida', 1200), loose('41-U', 'Pimentón Seleccionado', 800), loose('141-U', 'Orégano en Hojas', 1200), loose('60-U', 'Ají Molido', 900)];
const essentialItems = [
  loose('159-U', 'Pimienta Blanca Molida', 1500),
  loose('373-U', 'Ajo en Polvo', 700),
  loose('105-U', 'Comino Molido', 1200),
  loose('330-U', 'Chimichurri Seco', 1000),
  loose('329-U', 'Mezcla para Provenzal', 1100),
  loose('50-U', 'Adobo para Pizza', 1000),
  loose('48-U', 'Condimento para Arroz', 1000),
];
const opts = { minOrder: 50000, retail: false, combos: [] as { code: string; quantity: number }[], firstPurchase: false };

describe('catálogo para el asistente', () => {
  it('separa mayorista y sueltos, y marca lo que no se ofrece sin hablar de stock', () => {
    const text = catalogText(catalog);
    expect(text).toContain('MAYORISTA (cajas y bolsas):');
    expect(text).toContain('[386] Condimento para Aves — Frasco 50 g — $ 24.000 por caja de 12 ($ 2.000 c/u) — NO OFRECER');
    expect(text).toContain('[181] Pimentón Flor Selecto — Bolsa 1 kg — $ 14.400');
    expect(text).not.toMatch(/stock/i);
    // Los sueltos se arman abriendo cajas: se ofrecen igual.
    expect(text.split('SUELTOS PARA MINORISTAS')[1]).toContain('[386-U] Condimento para Aves — Frasco 50 g — $ 2.300\n'.trim());
    expect(text.split('SUELTOS PARA MINORISTAS')[1]).not.toContain('NO OFRECER');
  });

  it('arma el Combo Chef con los precios vigentes y el 10% de primera compra', () => {
    const chef = combosInfo(comboItems).find((c) => c.code === 'BASICO')!;
    expect(chef.priced).toMatchObject({ price: 41000, firstPurchasePrice: 36900 });
    expect(comboText(comboItems)).toContain('$ 36.900');
    // Al Esencial le faltan sobres: no se ofrece.
    expect(combosInfo(comboItems).find((c) => c.code === 'ESENCIAL')!.priced).toBeNull();
    expect(comboText(comboItems)).not.toContain('Combo Esencial');
    expect(combosInfo(comboItems.slice(1)).every((c) => !c.priced)).toBe(true);
  });

  it('el Combo Esencial va a precio fijo', () => {
    const text = comboText([...comboItems, ...essentialItems]);
    expect(text).toContain('Combo Esencial (código de combo "ESENCIAL")');
    expect(text).toContain('Precio: $ 10.000 (sueltos suman $ 10.400)');
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
      opts,
    );
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]).toMatchObject({ sku: '181', quantity: 3, lineTotal: 43200 });
    expect(d.total).toBe(67200);
    expect(d.belowMinimum).toBe(false);
    expect(d.noStock).toEqual(['386']);
  });

  it('avisa los códigos que no existen y el pedido mínimo, que no corre para minoristas', () => {
    const d = priceDraft([{ sku: '999', quantity: 1 }, { sku: '181', quantity: 1 }], catalog, opts);
    expect(d.unknown).toEqual(['999']);
    expect(d.belowMinimum).toBe(true);
    expect(priceDraft([{ sku: '181', quantity: 1 }], catalog, { ...opts, retail: true }).belowMinimum).toBe(false);
  });

  it('agrega el combo con descuento solo en la primera compra', () => {
    const all = [...catalog, ...comboItems];
    const first = priceDraft([{ sku: '386-U', quantity: 2 }], all, { ...opts, retail: true, combos: [{ code: 'BASICO', quantity: 1 }], firstPurchase: true });
    expect(first.lines.filter((l) => l.fromCombo)).toHaveLength(4);
    expect(first.subtotal).toBe(4600 + 41000);
    expect(first.discountTotal).toBe(4100);
    expect(first.total).toBe(4600 + 36900);
    const again = priceDraft([], all, { ...opts, retail: true, combos: [{ code: 'basico', quantity: 2 }], firstPurchase: false });
    expect(again.total).toBe(82000);
    expect(again.discountTotal).toBe(0);
    expect(priceDraft([], catalog, { ...opts, combos: [{ code: 'BASICO', quantity: 1 }] }).comboUnavailable).toEqual(['BASICO']);
  });

  it('carga el Combo Esencial sobre por sobre y suma justo el precio fijo', () => {
    const all = [...catalog, ...comboItems, ...essentialItems];
    const d = priceDraft([{ sku: '179-U', quantity: 1 }], all, { ...opts, retail: true, combos: [{ code: 'ESENCIAL', quantity: 2 }], firstPurchase: true });
    const combo = d.lines.filter((l) => l.fromCombo === 'Combo Esencial');
    expect(combo).toHaveLength(10);
    expect(combo.every((l) => l.quantity === 2 && l.discountPct === 0)).toBe(true);
    // El suelto de pimienta va aparte, a precio de lista.
    expect(d.lines.find((l) => l.sku === '179-U' && !l.fromCombo)).toMatchObject({ quantity: 1, lineTotal: 1200 });
    expect(d.total).toBe(1200 + 20000);
    expect(priceDraft([], all, { ...opts, combos: [{ code: 'NO-EXISTE', quantity: 1 }] }).comboUnavailable).toEqual(['NO-EXISTE']);
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

describe('productos que más rotan', () => {
  it('usa las ventas y completa con los básicos mientras haya pocas', () => {
    expect(topSellersText(['Comino Molido'])).toBe('Productos que más rotan (ofrecelos primero): Comino Molido, Pimienta Negra Molida, Pimentón, Orégano en Hojas, Ají Molido.');
    expect(topSellersText(['A', 'B', 'C', 'D'])).toBe('Productos que más rotan (ofrecelos primero): A, B, C, D.');
  });
});
