import PdfPrinter from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * Lista de precios en PDF con la identidad de la web Sabor a Casa (saboracasa.com.ar).
 * Funciones puras: reciben las filas ya leídas de la base y devuelven la definición de pdfmake.
 * Nunca reciben costos ni márgenes.
 */

export const BRAND = {
  name: 'Sabor a Casa',
  whatsapp: '+54 9 11 7058-0234',
  email: 'sanicondimentar@gmail.com',
  web: 'www.saboracasa.com.ar',
  conditions: ['Forma de pago: a convenir', 'Zona de cobertura: Zona Norte', 'Precios sujetos a cambio sin previo aviso'],
};

const COLORS = {
  bordo: '#731515',
  bordoDark: '#590709',
  gold: '#C6974E',
  cream: '#FAF6EC',
  creamDeep: '#F0E5CF',
  text: '#251C16',
  muted: '#6B5E52',
  border: '#E3D5BC',
};

export interface PriceRow {
  sku: string;
  product: string;
  /** Nombre de la presentación tal como está en SpiceOS: "Bolsa 1 kg", "Caja 25 sobres × 25 g", "Sobre suelto 25 g (caja de 50)". */
  variant: string;
  netWeightKg: number | null;
  price: number;
}

export interface PdfLine {
  sku: string;
  product: string;
  presentation: string;
  unitsPerBox: number | null;
  boxPrice: number | null;
  unitPrice: number;
  sortWeight: number;
  fromBox?: number | null;
}

export interface PdfSection {
  title: string;
  lines: PdfLine[];
}

type Parsed =
  | { kind: 'bulk'; presentation: string }
  | { kind: 'box'; units: number; container: string; presentation: string }
  | { kind: 'loose'; presentation: string; fromBox: number | null }
  | { kind: 'other'; presentation: string };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "sobres" → "sobre", "cartones" → "cartón", "paquetes" → "paquete", "frascos" → "frasco". */
export function singular(container: string): string {
  const c = container.toLowerCase();
  if (c.endsWith('ones')) return `${c.slice(0, -4)}ón`;
  if (c.endsWith('s')) return c.slice(0, -1);
  return c;
}

export function parseVariant(name: string): Parsed {
  const n = name.trim();
  let m = /^bolsa\s+(.+)$/i.exec(n);
  if (m) return { kind: 'bulk', presentation: `Bolsa ${m[1]}` };
  m = /^caja\s+(\d+)\s+(\S+)\s*[×x]\s*(.+)$/i.exec(n);
  if (m) {
    const units = Number(m[1]);
    return { kind: 'box', units, container: m[2].toLowerCase(), presentation: `${capitalize(singular(m[2]))} ${m[3]}` };
  }
  m = /^(\S+)\s+suelt[oa]\s+(.+?)(?:\s*\(caja de (\d+)\))?$/i.exec(n);
  if (m) return { kind: 'loose', presentation: `${capitalize(m[1].toLowerCase())} ${m[2]}`, fromBox: m[3] ? Number(m[3]) : null };
  return { kind: 'other', presentation: n };
}

const byName = (a: PdfLine, b: PdfLine) =>
  a.product.localeCompare(b.product, 'es', { sensitivity: 'base' }) || a.sortWeight - b.sortWeight || a.sku.localeCompare(b.sku);

/**
 * Secciones en el orden pedido: granel; cajas de la que trae menos unidades a la que trae más;
 * otras presentaciones mayoristas; y al final los sueltos de la lista minorista. Alfabético dentro de cada una.
 */
export function buildSections(wholesale: PriceRow[], retail: PriceRow[]): PdfSection[] {
  const bulk: PdfLine[] = [];
  const boxes = new Map<number, { containers: Set<string>; lines: PdfLine[] }>();
  const other: PdfLine[] = [];
  const loose: PdfLine[] = [];
  const base = (r: PriceRow) => ({ sku: r.sku, product: r.product, sortWeight: r.netWeightKg ?? 0 });

  for (const r of wholesale) {
    const p = parseVariant(r.variant);
    if (p.kind === 'bulk') bulk.push({ ...base(r), presentation: p.presentation, unitsPerBox: null, boxPrice: null, unitPrice: r.price });
    else if (p.kind === 'box') {
      const group = boxes.get(p.units) ?? { containers: new Set<string>(), lines: [] };
      group.containers.add(p.container);
      group.lines.push({
        ...base(r),
        sortWeight: (r.netWeightKg ?? 0) / p.units,
        presentation: p.presentation,
        unitsPerBox: p.units,
        boxPrice: r.price,
        unitPrice: r.price / p.units,
      });
      boxes.set(p.units, group);
    } else other.push({ ...base(r), presentation: p.presentation, unitsPerBox: null, boxPrice: r.price, unitPrice: r.price });
  }
  for (const r of retail) {
    const p = parseVariant(r.variant);
    if (p.kind !== 'loose') continue; // De la lista minorista solo van los sueltos.
    loose.push({ ...base(r), sortWeight: (r.netWeightKg ?? 0) * 1000 + (p.fromBox ?? 0) / 1000, presentation: p.presentation, unitsPerBox: null, boxPrice: null, unitPrice: r.price, fromBox: p.fromBox });
  }
  // Un mismo suelto que sale de cajas distintas (por ejemplo de la caja de 25 y de la de 50) se distingue por la caja.
  const key = (l: PdfLine) => `${l.product}|${l.presentation}`;
  const counts = new Map<string, number>();
  for (const l of loose) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  for (const l of loose) if ((counts.get(key(l)) ?? 0) > 1 && l.fromBox) l.presentation += ` (de caja x${l.fromBox})`;

  const sections: PdfSection[] = [];
  if (bulk.length) sections.push({ title: 'Granel', lines: bulk.sort(byName) });
  for (const [units, g] of [...boxes].sort(([a], [b]) => a - b)) {
    const what = g.containers.size === 1 ? [...g.containers][0] : 'unidades';
    sections.push({ title: `Cajas de ${units} ${what}`, lines: g.lines.sort(byName) });
  }
  if (other.length) sections.push({ title: 'Otras presentaciones', lines: other.sort(byName) });
  if (loose.length) sections.push({ title: 'Sueltos (precio por unidad)', lines: loose.sort(byName) });
  return sections;
}

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0, minimumFractionDigits: 0 });
export const money = (n: number) => ars.format(Math.round(n)).replace(/ /g, ' ');

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(date);
}

/** Fecha AAAA-MM-DD en hora argentina, para el nombre del archivo. */
export function isoDateAr(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date);
}

/** El logo de la web: casita con chimenea y humo, dorada, sobre círculo bordó con borde dorado. */
function logoSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="${COLORS.bordoDark}" stroke="${COLORS.gold}" stroke-width="2.4"/>
  <g transform="translate(12 11) scale(0.75)" fill="none" stroke="${COLORS.gold}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="35" cy="9" rx="2.4" ry="1.7" fill="${COLORS.gold}" stroke="none" fill-opacity="0.5"/>
    <ellipse cx="37" cy="6" rx="3" ry="2.1" fill="${COLORS.gold}" stroke="none" fill-opacity="0.32"/>
    <ellipse cx="34.5" cy="3.5" rx="3.4" ry="2.4" fill="${COLORS.gold}" stroke="none" fill-opacity="0.18"/>
    <path d="M34 16.5V11h4v9"/>
    <path d="M6 25 24 11l18 14"/>
    <path d="M11 23.5V41h26V23.5"/>
    <path d="M20 41v-9h8v9"/>
  </g>
</svg>`;
}

const PAGE_WIDTH = 595.28; // A4 en puntos
const MARGIN_X = 36;
const HEADER_HEIGHT = 92;

export function buildPriceListDoc(sections: PdfSection[], date: Date): TDocumentDefinitions {
  const content: Content[] = [];
  // pdfmake modifica las celdas al dibujarlas: cada tabla necesita su propia fila de títulos.
  const headerRow = (): TableCell[] => ['Código', 'Producto', 'Presentación', 'Unid. por caja', 'Precio por caja', 'Precio por unidad'].map((t, i) => ({
    text: t,
    style: 'th',
    alignment: i >= 3 ? 'right' : 'left',
  }));

  for (const s of sections) {
    content.push({
      stack: [
        { text: s.title, style: 'section' },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0, lineWidth: 2, lineColor: COLORS.gold }], margin: [0, 2, 0, 6] },
      ],
      unbreakable: true,
      margin: [0, 12, 0, 0],
    });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [44, '*', 104, 50, 62, 62],
        body: [
          headerRow(),
          ...s.lines.map((l): TableCell[] => [
            { text: l.sku, color: COLORS.muted },
            { text: l.product, bold: true },
            l.presentation,
            { text: l.unitsPerBox ? String(l.unitsPerBox) : '', alignment: 'right' },
            { text: l.boxPrice !== null ? money(l.boxPrice) : '', alignment: 'right', bold: true },
            { text: money(l.unitPrice), alignment: 'right', bold: l.boxPrice === null },
          ]),
        ],
      },
      layout: {
        fillColor: (row: number) => (row === 0 ? COLORS.bordo : row % 2 === 0 ? COLORS.cream : null),
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => COLORS.border,
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: () => 5,
        paddingRight: () => 5,
      },
    });
  }

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [MARGIN_X, HEADER_HEIGHT + 14, MARGIN_X, 58],
    info: { title: `Lista de precios mayorista - ${BRAND.name}`, author: BRAND.name, subject: `Precios vigentes al ${formatDate(date)}` },
    defaultStyle: { font: 'Helvetica', fontSize: 8.5, color: COLORS.text },
    styles: {
      th: { bold: true, color: COLORS.cream, fontSize: 8 },
      section: { font: 'Times', bold: true, fontSize: 14, color: COLORS.bordo },
    },
    header: () => ({
      stack: [
        { canvas: [
          { type: 'rect', x: 0, y: 0, w: PAGE_WIDTH, h: HEADER_HEIGHT, color: COLORS.bordo },
          { type: 'line', x1: 0, y1: HEADER_HEIGHT, x2: PAGE_WIDTH, y2: HEADER_HEIGHT, lineWidth: 3, lineColor: COLORS.gold },
        ] },
        { svg: logoSvg(58), absolutePosition: { x: MARGIN_X, y: (HEADER_HEIGHT - 58) / 2 } },
        {
          absolutePosition: { x: MARGIN_X + 72, y: 22 },
          stack: [
            { text: BRAND.name, font: 'Times', bold: true, fontSize: 26, color: COLORS.gold },
            { text: 'Lista de precios mayorista', font: 'Times', italics: true, fontSize: 13, color: COLORS.cream, margin: [0, 2, 0, 0] },
          ],
        },
        {
          absolutePosition: { x: PAGE_WIDTH - MARGIN_X - 200, y: 32 },
          layout: 'noBorders',
          table: {
            widths: [200],
            body: [
              [
                {
                  stack: [
                    { text: 'PRECIOS SIN IVA', bold: true, fontSize: 11, color: COLORS.gold, alignment: 'right', characterSpacing: 1 },
                    { text: `Vigentes al ${formatDate(date)}`, fontSize: 9.5, color: COLORS.cream, alignment: 'right', margin: [0, 4, 0, 0] },
                  ],
                },
              ],
            ],
          },
        },
      ],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [MARGIN_X, 8, MARGIN_X, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH - MARGIN_X * 2, y2: 0, lineWidth: 1, lineColor: COLORS.gold }] },
        {
          margin: [0, 6, 0, 0],
          columns: [
            {
              width: '*',
              stack: [
                { text: BRAND.conditions.join('  ·  '), fontSize: 7.5, color: COLORS.text },
                { text: [`WhatsApp ${BRAND.whatsapp}`, BRAND.email, BRAND.web].join('  ·  '), fontSize: 7.5, bold: true, color: COLORS.bordo, margin: [0, 3, 0, 0] },
              ],
            },
            { width: 70, text: `Página ${currentPage} de ${pageCount}`, fontSize: 7.5, color: COLORS.muted, alignment: 'right', margin: [0, 5, 0, 0] },
          ],
        },
      ],
    }),
    content,
  };
}

/** Fuentes estándar de PDF: no hace falta instalar archivos de fuentes en el servidor. */
export const PDF_FONTS = {
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
};

export function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  const printer = new PdfPrinter(PDF_FONTS);
  const pdf = printer.createPdfKitDocument(doc);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
