import { Agent, request } from 'node:https';

/**
 * SOAP mínimo para los web services de ARCA: arma el XML a mano y lee las etiquetas que hacen falta.
 * Los servidores de ARCA usan claves Diffie-Hellman cortas que Node rechaza por defecto (SECLEVEL 2).
 */
const agent = new Agent({ keepAlive: true, ciphers: 'DEFAULT@SECLEVEL=1' });

export class ArcaHttpError extends Error {}

export function post(url: string, body: string, soapAction: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent,
        timeout: timeoutMs,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          // Los errores SOAP llegan con HTTP 500 y un <faultstring> que explica el problema.
          const fault = tag(text, 'faultstring');
          if (fault) return reject(new ArcaHttpError(fault));
          if ((res.statusCode ?? 500) >= 400) return reject(new ArcaHttpError(`ARCA respondió ${res.statusCode}`));
          resolve(text);
        });
      },
    );
    req.on('timeout', () => req.destroy(new ArcaHttpError('ARCA no respondió a tiempo')));
    req.on('error', (e) => reject(e instanceof ArcaHttpError ? e : new ArcaHttpError(`No se pudo conectar con ARCA: ${e.message}`)));
    req.end(body);
  });
}

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

type XmlValue = string | number | boolean | null | undefined | XmlObject | XmlValue[];
export interface XmlObject {
  [key: string]: XmlValue;
}

/** { A: 1, B: { C: 'x' } } → <p:A>1</p:A><p:B><p:C>x</p:C></p:B>. El orden de las claves se respeta. */
export function toXml(obj: XmlObject, prefix: string): string {
  return Object.entries(obj)
    .map(([k, v]) => element(k, v, prefix))
    .join('');
}

function element(k: string, v: XmlValue, prefix: string): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map((x) => element(k, x, prefix)).join('');
  const inner = typeof v === 'object' ? toXml(v, prefix) : escapeXml(String(v));
  return `<${prefix}:${k}>${inner}</${prefix}:${k}>`;
}

/** Contenido de la primera etiqueta con ese nombre (con o sin prefijo de namespace). */
export function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1]!.trim() : null;
}

/** Contenido de todas las etiquetas con ese nombre. */
export function tags(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]!.trim());
}

export const ARCA_URLS = {
  TESTING: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  PRODUCTION: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
} as const;
export type ArcaEnv = keyof typeof ARCA_URLS;
