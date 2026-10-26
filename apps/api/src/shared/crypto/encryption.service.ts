import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Cifrado de datos sensibles (tokens OAuth, credenciales de WhatsApp) con AES-256-GCM.
 * Formato: [12 bytes IV][16 bytes tag][ciphertext]. En producción la clave vive en un KMS / Vault.
 */
@Injectable()
export class EncryptionService {
  private readonly key = Buffer.from(env().DATA_ENCRYPTION_KEY, 'base64');

  encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }

  decrypt(blob: Uint8Array): string {
    const buf = Buffer.from(blob);
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
