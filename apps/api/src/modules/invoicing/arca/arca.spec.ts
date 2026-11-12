import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { checkCertificate, generateKeyAndCsr } from './certificate';
import { tag, tags, toXml } from './soap';
import { buildTra, parseLoginResponse, signTra } from './wsaa';
import { parseCaeResponse } from './wsfe';

/** Certificado como el que devuelve ARCA: firmado por otra autoridad para el CSR que generamos. */
function signCsr(csrPem: string, days = 730) {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const ca = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey!;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + days * 86_400_000);
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores Test' }]);
  cert.sign(ca.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe('certificado y acceso a ARCA', () => {
  const { privateKeyPem, csrPem } = generateKeyAndCsr({ cuit: '20368070921', legalName: 'Ignacio Pérez' });
  const certPem = signCsr(csrPem);

  it('genera un pedido de certificado con el CUIT como serialNumber', () => {
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    expect(csr.verify()).toBe(true);
    expect((csr.subject.getField({ type: '2.5.4.5' }) as { value: string }).value).toBe('CUIT 20368070921');
    expect((csr.subject.getField('O') as { value: string }).value).toBe('Ignacio Perez');
  });

  it('acepta el certificado de su clave y rechaza uno de otra', () => {
    expect(checkCertificate(certPem, privateKeyPem)).toMatchObject({ subjectCuit: '20368070921' });
    const other = generateKeyAndCsr({ cuit: '20368070921', legalName: 'Otro' });
    expect(() => checkCertificate(signCsr(other.csrPem), privateKeyPem)).toThrow(/no corresponde/);
    expect(() => checkCertificate('cualquier cosa', privateKeyPem)).toThrow(/No se pudo leer/);
  });

  it('firma el TRA como CMS con el contenido adentro (lo verifica openssl)', () => {
    const tra = buildTra('wsfe', new Date('2026-11-12T12:00:00Z'));
    expect(tag(tra, 'service')).toBe('wsfe');
    expect(tag(tra, 'generationTime')).toBe('2026-11-12T11:50:00.000Z');
    const cms = signTra(tra, certPem, privateKeyPem);
    const dir = mkdtempSync(join(tmpdir(), 'cms-'));
    writeFileSync(join(dir, 'tra.cms'), Buffer.from(cms, 'base64'));
    const out = execFileSync('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', join(dir, 'tra.cms')], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    expect(out).toBe(tra);
  });

  it('lee el ticket de la respuesta de WSAA', () => {
    const inner = '<?xml version="1.0"?><loginTicketResponse><header><expirationTime>2026-11-13T00:00:00.000-03:00</expirationTime></header><credentials><token>TOK</token><sign>SIG</sign></credentials></loginTicketResponse>';
    const xml = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${inner.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;
    expect(parseLoginResponse(xml)).toEqual({ token: 'TOK', sign: 'SIG', expiresAt: new Date('2026-11-13T03:00:00.000Z') });
  });
});

describe('SOAP de WSFE', () => {
  it('arma el XML respetando el orden y omitiendo vacíos', () => {
    expect(toXml({ A: 1, B: { C: 'x&y', D: undefined }, E: [{ F: 1 }, { F: 2 }] }, 'ar')).toBe(
      '<ar:A>1</ar:A><ar:B><ar:C>x&amp;y</ar:C></ar:B><ar:E><ar:F>1</ar:F></ar:E><ar:E><ar:F>2</ar:F></ar:E>',
    );
  });

  it('lee un CAE aprobado', () => {
    const xml = `<soap:Envelope><soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>
      <FeCabResp><Cuit>20368070921</Cuit><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><Resultado>A</Resultado></FeCabResp>
      <FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>12</CbteDesde><CbteHasta>12</CbteHasta>
      <Resultado>A</Resultado><CAE>76451234567890</CAE><CbteFch>20261112</CbteFch><CAEFchVto>20261122</CAEFchVto></FECAEDetResponse></FeDetResp>
      </FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;
    expect(parseCaeResponse(xml)).toEqual({ approved: true, cae: '76451234567890', caeDueDate: '20261122', errors: [], observations: [] });
  });

  it('lee un rechazo con observaciones', () => {
    const xml = `<FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><CAE></CAE>
      <Observaciones><Obs><Code>10015</Code><Msg>Factura B monto mayor al limite</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>
      <Errors><Err><Code>10016</Code><Msg>El numero no es el proximo</Msg></Err></Errors></FECAESolicitarResult>`;
    const r = parseCaeResponse(xml);
    expect(r.approved).toBe(false);
    expect(r.observations).toEqual([{ code: '10015', message: 'Factura B monto mayor al limite' }]);
    expect(r.errors).toEqual([{ code: '10016', message: 'El numero no es el proximo' }]);
    expect(tags('<a:Err><b>1</b></a:Err><Errors/><Err><b>2</b></Err>', 'Err')).toHaveLength(2);
  });
});
