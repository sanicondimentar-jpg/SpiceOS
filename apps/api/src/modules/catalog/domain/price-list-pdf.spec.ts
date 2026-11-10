import { buildPriceListDoc, buildSections, parseVariant, renderPdf, singular, type PriceRow } from './price-list-pdf';

const row = (sku: string, product: string, variant: string, price: number, netWeightKg: number | null = null): PriceRow => ({ sku, product, variant, price, netWeightKg });

describe('lista de precios en PDF', () => {
  it('lee las presentaciones de SpiceOS', () => {
    expect(parseVariant('Bolsa 1 kg')).toEqual({ kind: 'bulk', presentation: 'Bolsa 1 kg' });
    expect(parseVariant('Caja 25 sobres × 25 g')).toEqual({ kind: 'box', units: 25, container: 'sobres', presentation: 'Sobre 25 g' });
    expect(parseVariant('Caja 50 cartones × 2 cápsulas')).toMatchObject({ units: 50, presentation: 'Cartón 2 cápsulas' });
    expect(parseVariant('Sobre suelto 25 g (caja de 50)')).toEqual({ kind: 'loose', presentation: 'Sobre 25 g', fromBox: 50 });
    expect(singular('paquetes')).toBe('paquete');
  });

  it('ordena granel, cajas de menos a más unidades y sueltos, alfabético dentro de cada sección', () => {
    const sections = buildSections(
      [
        row('50', 'Orégano', 'Caja 50 sobres × 25 g', 36800),
        row('3017', 'Orégano', 'Caja 15 sobres × 25 g', 11800),
        row('3018', 'Ají Molido', 'Caja 15 sobres × 25 g', 11200),
        row('52', 'Comino', 'Bolsa 1 kg', 14400, 1),
        row('272', 'Comino', 'Bolsa 250 g', 3800, 0.25),
        row('10', 'Albahaca', 'Bolsa 1 kg', 9300, 1),
      ],
      [row('50-U', 'Orégano', 'Sobre suelto 25 g (caja de 50)', 900), row('X', 'Orégano', 'Caja 50 sobres × 25 g', 1)],
    );
    expect(sections.map((s) => s.title)).toEqual(['Granel', 'Cajas de 15 sobres', 'Cajas de 50 sobres', 'Sueltos (precio por unidad)']);
    expect(sections[0].lines.map((l) => l.sku)).toEqual(['10', '272', '52']);
    expect(sections[1].lines.map((l) => l.product)).toEqual(['Ají Molido', 'Orégano']);
    expect(sections[2].lines[0]).toMatchObject({ unitsPerBox: 50, boxPrice: 36800, unitPrice: 736 });
    expect(sections[3].lines).toHaveLength(1); // de la lista minorista solo los sueltos
  });

  it('muestra una sola vez un suelto que sale de cajas distintas con el mismo precio', () => {
    const [loose] = buildSections([], [row('22-U', 'Pimentón', 'Sobre suelto 25 g (caja de 25)', 900), row('20-U', 'Pimentón', 'Sobre suelto 25 g (caja de 50)', 900)]);
    expect(loose.lines.map((l) => [l.sku, l.presentation])).toEqual([['22-U', 'Sobre 25 g']]);
  });

  it('distingue un mismo suelto que sale de cajas distintas con precios distintos', () => {
    const [loose] = buildSections([], [row('22-U', 'Pimentón', 'Sobre suelto 25 g (caja de 25)', 900), row('20-U', 'Pimentón', 'Sobre suelto 25 g (caja de 50)', 800)]);
    expect(loose.lines.map((l) => l.presentation)).toEqual(['Sobre 25 g (de caja x25)', 'Sobre 25 g (de caja x50)']);
  });

  it('genera un PDF', async () => {
    const pdf = await renderPdf(buildPriceListDoc(buildSections([row('52', 'Comino', 'Bolsa 1 kg', 14400, 1)], []), new Date('2026-11-06T12:00:00Z')));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
