import { round2 } from '../../../shared/domain/money';

/**
 * Reglas de factura electrónica de ARCA, sin base de datos ni red.
 * Monotributo emite Factura C (sin IVA discriminado: el precio de lista es el final).
 * Responsable Inscripto emite A a inscriptos y monotributistas, y B a consumidores finales y exentos,
 * con 21 % de IVA sobre el precio de lista (que en ese caso es sin IVA).
 */

export type IssuerCondition = 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
export type ReceiverCondition = 'RI' | 'Monotributo' | 'CF' | 'Exento';

export const VAT_RATE = 21;
/** Id de alícuota de IVA 21 % en ARCA. */
const VAT_21_ID = 5;

export interface InvoiceKind {
  /** Letra (y prefijo de nota de crédito) como se guarda y se muestra: C, NC-C, A, NC-A... */
  type: string;
  letter: 'A' | 'B' | 'C';
  /** Código de comprobante de ARCA. */
  arcaType: number;
  creditNote: boolean;
}

const CODES: Record<'A' | 'B' | 'C', { invoice: number; creditNote: number }> = {
  A: { invoice: 1, creditNote: 3 },
  B: { invoice: 6, creditNote: 8 },
  C: { invoice: 11, creditNote: 13 },
};

export function invoiceKind(issuer: IssuerCondition, receiver: ReceiverCondition, creditNote = false): InvoiceKind {
  const letter = issuer === 'MONOTRIBUTO' ? 'C' : receiver === 'RI' || receiver === 'Monotributo' ? 'A' : 'B';
  return kindForLetter(letter, creditNote);
}

export function kindForLetter(letter: 'A' | 'B' | 'C', creditNote = false): InvoiceKind {
  return { type: creditNote ? `NC-${letter}` : letter, letter, arcaType: CODES[letter][creditNote ? 'creditNote' : 'invoice'], creditNote };
}

export const KIND_LABEL: Record<string, string> = {
  A: 'Factura A',
  B: 'Factura B',
  C: 'Factura C',
  'NC-A': 'Nota de crédito A',
  'NC-B': 'Nota de crédito B',
  'NC-C': 'Nota de crédito C',
};

/** Condición frente al IVA del cliente tal como la guarda el CRM; sin dato, consumidor final. */
export function receiverCondition(raw: string | null | undefined): ReceiverCondition {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'ri' || v.startsWith('responsable')) return 'RI';
  if (v.startsWith('mono')) return 'Monotributo';
  if (v.startsWith('exento')) return 'Exento';
  return 'CF';
}

/** CondicionIVAReceptorId (RG 5616). */
export const RECEIVER_CONDITION_ID: Record<ReceiverCondition, number> = { RI: 1, Exento: 4, CF: 5, Monotributo: 6 };
export const RECEIVER_CONDITION_LABEL: Record<ReceiverCondition, string> = {
  RI: 'IVA Responsable Inscripto',
  Monotributo: 'Responsable Monotributo',
  CF: 'Consumidor Final',
  Exento: 'IVA Sujeto Exento',
};
export const ISSUER_CONDITION_LABEL: Record<IssuerCondition, string> = {
  MONOTRIBUTO: 'Responsable Monotributo',
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
};

export interface ReceiverDoc {
  docType: number;
  docNumber: string;
}

/** CUIT (80) si tiene 11 dígitos, DNI (96) si tiene 7 u 8, si no "sin identificar" (99, número 0). */
export function receiverDoc(taxId: string | null | undefined): ReceiverDoc {
  const digits = (taxId ?? '').replace(/\D/g, '');
  if (digits.length === 11) return { docType: 80, docNumber: digits };
  if (digits.length === 7 || digits.length === 8) return { docType: 96, docNumber: digits };
  return { docType: 99, docNumber: '0' };
}

export const DOC_LABEL: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Sin identificar' };

export function assertReceiverAllowed(kind: InvoiceKind, doc: ReceiverDoc) {
  if (kind.letter === 'A' && doc.docType !== 80) {
    throw new Error('Para hacer una factura A el cliente tiene que tener cargado el CUIT');
  }
}


export interface Amounts {
  net: number;
  vat: number;
  total: number;
}

/**
 * Importes del comprobante a partir del total del pedido (suma de líneas con descuentos, precios de lista).
 * C: el precio de lista ya es el final. A y B: el precio de lista es sin IVA y se suma el 21 %.
 */
export function invoiceAmounts(letter: 'A' | 'B' | 'C', orderTotal: number): Amounts {
  const net = round2(orderTotal);
  if (letter === 'C') return { net, vat: 0, total: net };
  const vat = round2((net * VAT_RATE) / 100);
  return { net, vat, total: round2(net + vat) };
}

export interface CaeRequestInput {
  kind: InvoiceKind;
  pointOfSale: number;
  number: number;
  date: string; // yyyy-mm-dd
  doc: ReceiverDoc;
  receiver: ReceiverCondition;
  amounts: Amounts;
  /** Comprobante que anula una nota de crédito. */
  associated?: { arcaType: number; pointOfSale: number; number: number; issuerCuit: string; date: string };
}

/** Detalle del comprobante en el orden en que lo pide FECAESolicitar. */
export function caeDetail(i: CaeRequestInput) {
  const c = i.kind.letter === 'C';
  return {
    Concepto: 1, // productos
    DocTipo: i.doc.docType,
    DocNro: i.doc.docNumber,
    CbteDesde: i.number,
    CbteHasta: i.number,
    CbteFch: i.date.replace(/-/g, ''),
    ImpTotal: money(i.amounts.total),
    ImpTotConc: '0.00',
    ImpNeto: money(i.amounts.net),
    ImpOpEx: '0.00',
    ImpTrib: '0.00',
    ImpIVA: money(c ? 0 : i.amounts.vat),
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: RECEIVER_CONDITION_ID[i.receiver],
    ...(i.associated && {
      CbtesAsoc: {
        CbteAsoc: {
          Tipo: i.associated.arcaType,
          PtoVta: i.associated.pointOfSale,
          Nro: i.associated.number,
          Cuit: i.associated.issuerCuit,
          CbteFch: i.associated.date.replace(/-/g, ''),
        },
      },
    }),
    ...(!c && { Iva: { AlicIva: { Id: VAT_21_ID, BaseImp: money(i.amounts.net), Importe: money(i.amounts.vat) } } }),
  };
}

const money = (n: number) => round2(n).toFixed(2);

/** "0003-00000125" */
export function formatInvoiceNumber(pointOfSale: number, number: number) {
  return `${String(pointOfSale).padStart(4, '0')}-${String(number).padStart(8, '0')}`;
}

/** Código QR obligatorio (RG 4892): URL de ARCA con los datos del comprobante en base64. */
export function qrUrl(i: {
  date: string;
  issuerCuit: string;
  pointOfSale: number;
  arcaType: number;
  number: number;
  total: number;
  docType: number;
  docNumber: string;
  cae: string;
}) {
  const data = {
    ver: 1,
    fecha: i.date,
    cuit: Number(i.issuerCuit),
    ptoVta: i.pointOfSale,
    tipoCmp: i.arcaType,
    nroCmp: i.number,
    importe: round2(i.total),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: i.docType,
    nroDocRec: Number(i.docNumber),
    tipoCodAut: 'E',
    codAut: Number(i.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

/** yyyy-mm-dd en hora argentina. */
export function todayAr(now = new Date()) {
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** ARCA acepta fecha de emisión hasta 5 días antes para productos; se usa siempre la de hoy. */
export function arcaDate(yyyymmdd: string) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
