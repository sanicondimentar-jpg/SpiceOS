import forge from 'node-forge';
import { escapeXml, post, tag, unescapeXml } from './soap';

/**
 * WSAA: con el certificado de la computadora fiscal se pide un ticket (token + firma) que habilita
 * a usar un web service (wsfe) durante 12 horas. ARCA no da otro mientras el anterior siga vigente,
 * así que hay que guardarlo.
 */

export interface Ticket {
  token: string;
  sign: string;
  expiresAt: Date;
}

/** Ticket de pedido de acceso (TRA). */
export function buildTra(service: string, now = new Date()) {
  const from = new Date(now.getTime() - 10 * 60_000).toISOString();
  const to = new Date(now.getTime() + 10 * 60_000).toISOString();
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0">' +
    `<header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId><generationTime>${from}</generationTime><expirationTime>${to}</expirationTime></header>` +
    `<service>${service}</service>` +
    '</loginTicketRequest>'
  );
}

/** Firma el TRA como CMS (PKCS#7 SignedData con el contenido adentro), en base64. */
export function signTra(tra: string, certificatePem: string, privateKeyPem: string): string {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      // node-forge acepta Date aunque los tipos digan string.
      { type: forge.pki.oids.signingTime!, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export function loginEnvelope(cms: string) {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${escapeXml(cms)}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  );
}

export function parseLoginResponse(xml: string): Ticket {
  const inner = unescapeXml(tag(xml, 'loginCmsReturn') ?? '');
  const token = tag(inner, 'token');
  const sign = tag(inner, 'sign');
  const exp = tag(inner, 'expirationTime');
  if (!token || !sign || !exp) throw new Error('ARCA no devolvió el ticket de acceso');
  return { token, sign, expiresAt: new Date(exp) };
}

export async function login(url: string, certificatePem: string, privateKeyPem: string, service = 'wsfe'): Promise<Ticket> {
  const cms = signTra(buildTra(service), certificatePem, privateKeyPem);
  try {
    return parseLoginResponse(await post(url, loginEnvelope(cms), '""'));
  } catch (e) {
    const msg = (e as Error).message;
    if (/ya posee un TA valido/i.test(msg)) {
      throw new Error('ARCA ya entregó un acceso que sigue vigente y SpiceOS no lo tiene guardado. Probá de nuevo más tarde (puede tardar hasta 12 horas).');
    }
    if (/Computador no autorizado|no autorizado a acceder/i.test(msg)) {
      throw new Error('ARCA dice que el certificado no está autorizado para facturar: falta asociarlo al servicio "Facturación Electrónica" en el Administrador de Relaciones de Clave Fiscal.');
    }
    throw new Error(`ARCA rechazó el ingreso: ${msg}`);
  }
}
