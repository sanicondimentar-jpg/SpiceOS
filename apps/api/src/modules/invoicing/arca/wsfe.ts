import { post, tag, tags, toXml, type XmlObject } from './soap';

/** WSFEv1: factura electrónica (A, B, C y sus notas de crédito) sin detalle de ítems. */

const NS = 'http://ar.gov.afip.dif.FEV1/';

export interface WsfeAuth {
  token: string;
  sign: string;
  cuit: string;
}

export interface ArcaMessage {
  code: string;
  message: string;
}

export interface CaeResult {
  approved: boolean;
  cae: string | null;
  caeDueDate: string | null; // yyyymmdd
  errors: ArcaMessage[];
  observations: ArcaMessage[];
}

export interface AuthorizedInvoice {
  docType: number;
  docNumber: string;
  date: string; // yyyymmdd
  total: number;
  cae: string;
  caeDueDate: string;
}

export class WsfeError extends Error {
  constructor(readonly errors: ArcaMessage[]) {
    super(errors.map((e) => `${e.message} (${e.code})`).join('; '));
  }
}

export class WsfeClient {
  constructor(
    private readonly url: string,
    private readonly auth: WsfeAuth,
  ) {}

  private async call(method: string, body: XmlObject = {}, withAuth = true) {
    const content = toXml({ ...(withAuth && { Auth: { Token: this.auth.token, Sign: this.auth.sign, Cuit: this.auth.cuit } }), ...body }, 'ar');
    const envelope =
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">` +
      `<soapenv:Header/><soapenv:Body><ar:${method}>${content}</ar:${method}></soapenv:Body></soapenv:Envelope>`;
    return post(this.url, envelope, `"${NS}${method}"`);
  }

  async dummy() {
    const xml = await this.call('FEDummy', {}, false);
    return { app: tag(xml, 'AppServer'), db: tag(xml, 'DbServer'), auth: tag(xml, 'AuthServer') };
  }

  /** Puntos de venta habilitados para web services. */
  async pointsOfSale() {
    const xml = await this.call('FEParamGetPtosVenta');
    const errors = messages(xml, 'Err');
    // 602: "Sin resultados" (todavía no hay puntos de venta para web services).
    if (errors.length && !errors.every((e) => e.code === '602')) throw new WsfeError(errors);
    return tags(xml, 'PtoVenta').map((p) => ({
      number: Number(tag(p, 'Nro')),
      type: tag(p, 'EmisionTipo') ?? '',
      blocked: tag(p, 'Bloqueado') === 'S',
      droppedAt: tag(p, 'FchBaja'),
    }));
  }

  async lastAuthorized(pointOfSale: number, arcaType: number): Promise<number> {
    const xml = await this.call('FECompUltimoAutorizado', { PtoVta: pointOfSale, CbteTipo: arcaType });
    const errors = messages(xml, 'Err');
    if (errors.length) throw new WsfeError(errors);
    return Number(tag(xml, 'CbteNro') ?? 0);
  }

  async getInvoice(pointOfSale: number, arcaType: number, number: number): Promise<AuthorizedInvoice | null> {
    const xml = await this.call('FECompConsultar', { FeCompConsReq: { CbteTipo: arcaType, CbteNro: number, PtoVta: pointOfSale } });
    const errors = messages(xml, 'Err');
    if (errors.some((e) => e.code === '602')) return null;
    if (errors.length) throw new WsfeError(errors);
    const r = tag(xml, 'ResultGet') ?? '';
    return {
      docType: Number(tag(r, 'DocTipo')),
      docNumber: tag(r, 'DocNro') ?? '',
      date: tag(r, 'CbteFch') ?? '',
      total: Number(tag(r, 'ImpTotal')),
      cae: tag(r, 'CodAutorizacion') ?? '',
      caeDueDate: tag(r, 'FchVto') ?? '',
    };
  }

  async requestCae(pointOfSale: number, arcaType: number, detail: XmlObject): Promise<CaeResult> {
    const xml = await this.call('FECAESolicitar', {
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta: pointOfSale, CbteTipo: arcaType },
        FeDetReq: { FECAEDetRequest: detail },
      },
    });
    return parseCaeResponse(xml);
  }
}

export function parseCaeResponse(xml: string): CaeResult {
  const det = tag(xml, 'FECAEDetResponse') ?? '';
  const result = tag(det, 'Resultado') ?? tag(xml, 'Resultado');
  const cae = tag(det, 'CAE');
  return {
    approved: result === 'A' && !!cae,
    cae: cae || null,
    caeDueDate: tag(det, 'CAEFchVto') || null,
    errors: messages(xml, 'Err'),
    observations: messages(det, 'Obs'),
  };
}

function messages(xml: string, name: 'Err' | 'Obs'): ArcaMessage[] {
  return tags(xml, name).map((e) => ({ code: tag(e, 'Code') ?? '', message: tag(e, 'Msg') ?? '' }));
}
