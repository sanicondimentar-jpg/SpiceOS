import { Injectable } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { EncryptionService } from '../../shared/crypto/encryption.service';

interface AccountCredentials {
  phoneNumberId: string;
  encryptedToken: Uint8Array;
}

/** Cliente mínimo de WhatsApp Business Cloud API (Graph API). */
@Injectable()
export class WhatsappClient {
  constructor(private readonly crypto: EncryptionService) {}

  private base() {
    return `https://graph.facebook.com/${env().WHATSAPP_GRAPH_VERSION}`;
  }

  async sendText(account: AccountCredentials, to: string, body: string): Promise<string> {
    return this.send(account, { messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body } });
  }

  /** Fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas por Meta. */
  async sendTemplate(account: AccountCredentials, to: string, name: string, lang: string, params: string[]): Promise<string> {
    return this.send(account, {
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name,
        language: { code: lang },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    });
  }

  async downloadMedia(account: AccountCredentials, mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const token = this.crypto.decrypt(account.encryptedToken);
    const meta = (await (await fetch(`${this.base()}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      url: string;
      mime_type: string;
    };
    const file = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    return { data: Buffer.from(await file.arrayBuffer()), mimeType: meta.mime_type };
  }

  private async send(account: AccountCredentials, payload: unknown): Promise<string> {
    const res = await fetch(`${this.base()}/${account.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.crypto.decrypt(account.encryptedToken)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok || !json.messages?.[0]) throw new Error(`WhatsApp: ${json.error?.message ?? res.status}`);
    return json.messages[0].id;
  }
}
