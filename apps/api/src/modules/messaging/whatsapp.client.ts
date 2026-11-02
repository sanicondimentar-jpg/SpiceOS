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

  /** Comprueba el número y el token: devuelve el número visible y el nombre verificado del negocio. */
  async phoneInfo(phoneNumberId: string, token: string): Promise<{ displayPhone: string; verifiedName: string | null }> {
    const json = await this.graph<{ display_phone_number: string; verified_name?: string }>(
      `${phoneNumberId}?fields=display_phone_number,verified_name`,
      token,
    );
    return { displayPhone: json.display_phone_number, verifiedName: json.verified_name ?? null };
  }

  /** Suscribe la app a la cuenta (WABA) para que Meta mande los mensajes al webhook. */
  async subscribeApp(wabaId: string, token: string): Promise<void> {
    await this.graph(`${wabaId}/subscribed_apps`, token, 'POST');
  }

  private async graph<T>(path: string, token: string, method = 'GET'): Promise<T> {
    const res = await fetch(`${this.base()}/${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Error ${res.status}`);
    return json;
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
