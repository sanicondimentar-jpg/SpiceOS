import forge from 'node-forge';

/**
 * Certificado para los web services de ARCA. La clave privada se genera en SpiceOS y nunca sale de acá:
 * a ARCA se le sube el pedido de certificado (CSR) y devuelve el certificado firmado.
 */

export function generateKeyAndCsr(input: { cuit: string; legalName: string }) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: ascii(input.legalName).slice(0, 60) },
    { name: 'commonName', value: 'spiceos' },
    { type: '2.5.4.5', value: `CUIT ${input.cuit}` }, // serialNumber
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return { privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey), csrPem: forge.pki.certificationRequestToPem(csr) };
}

export interface CertificateInfo {
  notBefore: Date;
  notAfter: Date;
  subjectCuit: string | null;
}

/** Lee el certificado y verifica que sea el par de la clave guardada. */
export function checkCertificate(certificatePem: string, privateKeyPem: string): CertificateInfo {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(normalizePem(certificatePem));
  } catch {
    throw new Error('No se pudo leer el certificado: pegá el contenido completo del archivo .crt, incluidas las líneas BEGIN y END');
  }
  const key = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (pub.n.compareTo(key.n) !== 0) {
    throw new Error('Ese certificado no corresponde al último pedido generado en SpiceOS. Subí a ARCA el pedido (CSR) que descargaste de acá.');
  }
  const serial = cert.subject.getField({ type: '2.5.4.5' }) as { value?: string } | null;
  const cuit = serial?.value?.replace(/\D/g, '') || null;
  return { notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter, subjectCuit: cuit };
}

export function normalizePem(pem: string) {
  return pem.trim().replace(/\r\n/g, '\n');
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
