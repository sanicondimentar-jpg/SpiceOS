import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { DOC_LABEL, ISSUER_CONDITION_LABEL, KIND_LABEL, RECEIVER_CONDITION_LABEL, formatInvoiceNumber, qrUrl, type IssuerCondition, type ReceiverCondition } from './invoice-rules';

/** Factura en PDF con el formato de ARCA (RG 1415): letra y código, datos del emisor y del receptor, CAE y QR. */

export interface InvoicePdfData {
  type: string; // C, NC-C, A...
  arcaType: number;
  pointOfSale: number;
  number: number;
  issueDate: string; // yyyy-mm-dd
  dueDate: string;
  cae: string;
  caeDueDate: string;
  testing: boolean;
  issuer: {
    legalName: string;
    tradeName?: string | null;
    cuit: string;
    address: string;
    condition: IssuerCondition;
    grossIncomeId: string | null;
    activityStart: string | null;
  };
  receiver: { name: string; docType: number; docNumber: string; condition: ReceiverCondition; address: string | null };
  saleCondition: string;
  lines: { sku: string; description: string; quantity: number; unitPrice: number; discountPct: number; lineTotal: number }[];
  net: number;
  vat: number;
  total: number;
  related?: string | null; // "Factura C 0003-00000012" en una nota de crédito
}

const ars = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

export function buildInvoiceDoc(d: InvoicePdfData): TDocumentDefinitions {
  const letter = d.type.slice(-1);
  const title = d.type.startsWith('NC') ? 'NOTA DE CRÉDITO' : 'FACTURA';
  // En la B el precio se muestra con IVA incluido; en la A, sin IVA y el IVA aparte; en la C no hay IVA.
  const factor = letter === 'B' ? 1.21 : 1;
  const label = (text: string, value: string): Content => ({ text: [{ text: `${text}: `, bold: true }, value], fontSize: 9, margin: [0, 1, 0, 1] });

  const header: Content = {
    table: {
      widths: ['*', 50, '*'],
      body: [
        [
          {
            stack: [
              { text: d.issuer.tradeName || d.issuer.legalName, fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
              label('Razón social', d.issuer.legalName),
              label('Domicilio comercial', d.issuer.address),
              label('Condición frente al IVA', ISSUER_CONDITION_LABEL[d.issuer.condition]),
            ],
            border: [true, true, false, true],
            margin: [6, 6, 6, 6],
          },
          {
            stack: [
              { text: letter, fontSize: 28, bold: true, alignment: 'center' },
              { text: `COD. ${String(d.arcaType).padStart(2, '0')}`, fontSize: 7, bold: true, alignment: 'center' },
            ],
            border: [true, true, true, true],
            margin: [0, 4, 0, 4],
          },
          {
            stack: [
              { text: title, fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
              label('Punto de venta y número', formatInvoiceNumber(d.pointOfSale, d.number)),
              label('Fecha de emisión', dmy(d.issueDate)),
              label('CUIT', cuitFmt(d.issuer.cuit)),
              label('Ingresos Brutos', d.issuer.grossIncomeId || cuitFmt(d.issuer.cuit)),
              ...(d.issuer.activityStart ? [label('Inicio de actividades', dmy(d.issuer.activityStart))] : []),
            ],
            border: [false, true, true, true],
            margin: [6, 6, 6, 6],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8 },
  };

  const receiver: Content = {
    margin: [0, 8, 0, 0],
    table: {
      widths: ['*', '*'],
      body: [
        [
          {
            stack: [
              label(DOC_LABEL[d.receiver.docType] ?? 'Documento', d.receiver.docType === 99 ? '—' : d.receiver.docType === 80 ? cuitFmt(d.receiver.docNumber) : d.receiver.docNumber),
              label('Apellido y nombre / Razón social', d.receiver.name),
              ...(d.receiver.address ? [label('Domicilio', d.receiver.address)] : []),
            ],
            margin: [6, 4, 6, 4],
          },
          {
            stack: [
              label('Condición frente al IVA', RECEIVER_CONDITION_LABEL[d.receiver.condition]),
              label('Condición de venta', d.saleCondition),
              ...(d.related ? [label('Comprobante asociado', d.related)] : []),
            ],
            margin: [6, 4, 6, 4],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0.8, vLineWidth: (i: number) => (i === 1 ? 0 : 0.8) },
  };

  const items: Content = {
    margin: [0, 10, 0, 0],
    table: {
      headerRows: 1,
      widths: [55, '*', 45, 70, 40, 75],
      body: [
        ['Código', 'Producto', 'Cant.', 'Precio unit.', '% Bonif.', 'Subtotal'].map((t, i) => ({
          text: t,
          bold: true,
          fontSize: 8.5,
          fillColor: '#EEEEEE',
          alignment: i >= 2 ? 'right' : 'left',
        })),
        ...d.lines.map((l) => [
          { text: l.sku, fontSize: 8 },
          { text: l.description, fontSize: 8.5 },
          { text: qty(l.quantity), fontSize: 8.5, alignment: 'right' },
          { text: ars(l.unitPrice * factor), fontSize: 8.5, alignment: 'right' },
          { text: l.discountPct ? ars(l.discountPct) : '', fontSize: 8.5, alignment: 'right' },
          { text: ars(l.lineTotal * factor), fontSize: 8.5, alignment: 'right' },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
  };

  const totalsRows: [string, number][] =
    letter === 'A' ? [['Importe neto gravado', d.net], ['IVA 21 %', d.vat], ['Importe total', d.total]] : [['Subtotal', d.total], ['Importe total', d.total]];
  const totals: Content = {
    margin: [0, 12, 0, 0],
    columns: [
      { width: '*', text: letter === 'B' ? `IVA contenido (Ley 27.743): $ ${ars(d.vat)}` : '', fontSize: 8.5 },
      {
        width: 220,
        table: {
          widths: ['*', 90],
          body: totalsRows.map(([k, v], i) => [
            { text: `${k}: $`, bold: i === totalsRows.length - 1, fontSize: i === totalsRows.length - 1 ? 11 : 9, alignment: 'right' },
            { text: ars(v), bold: i === totalsRows.length - 1, fontSize: i === totalsRows.length - 1 ? 11 : 9, alignment: 'right' },
          ]),
        },
        layout: 'noBorders',
      },
    ],
  };

  const authorization: Content = {
    margin: [0, 18, 0, 0],
    columns: [
      { width: 95, qr: qrUrl({ date: d.issueDate, issuerCuit: d.issuer.cuit, pointOfSale: d.pointOfSale, arcaType: d.arcaType, number: d.number, total: d.total, docType: d.receiver.docType, docNumber: d.receiver.docNumber, cae: d.cae }), fit: 90 },
      {
        width: '*',
        margin: [10, 10, 0, 0],
        stack: [
          { text: 'Comprobante autorizado por ARCA', bold: true, fontSize: 10 },
          { text: 'Esta administración federal no se responsabiliza por los datos ingresados en el detalle de la operación.', fontSize: 7, italics: true, margin: [0, 2, 0, 0] },
        ],
      },
      {
        width: 170,
        margin: [0, 10, 0, 0],
        stack: [label('CAE N°', d.cae), label('Fecha de vto. de CAE', dmy(d.caeDueDate))],
      },
    ],
  };

  return {
    pageSize: 'A4',
    pageMargins: [30, 30, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    info: { title: `${KIND_LABEL[d.type] ?? d.type} ${formatInvoiceNumber(d.pointOfSale, d.number)}` },
    ...(d.testing && {
      watermark: { text: 'SIN VALIDEZ FISCAL - PRUEBA', color: '#CC0000', opacity: 0.15, bold: true, fontSize: 40 },
    }),
    content: [{ text: 'ORIGINAL', alignment: 'center', bold: true, fontSize: 10, margin: [0, 0, 0, 6] }, header, receiver, items, totals, authorization],
  };
}
