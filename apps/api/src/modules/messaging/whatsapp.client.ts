import { Injectable } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { EncryptionService } from '../../shared/crypto/encryption.service';

interface AccountCredentials {
  phoneNumberId: string;
  encryptedToken: Uint8Array;
}

export interface WhatsappBusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profile_picture_url?: string;
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

  /** Alta del número en la Cloud API (una sola vez); el PIN queda como verificación en dos pasos. */
  async register(phoneNumberId: string, token: string, pin: string): Promise<void> {
    await this.graph(`${phoneNumberId}/register`, token, 'POST', { messaging_product: 'whatsapp', pin });
  }

  /** Perfil público del número (info, descripción, dirección, email, webs, rubro y foto). */
  async getProfile(phoneNumberId: string, token: string): Promise<WhatsappBusinessProfile> {
    const json = await this.graph<{ data?: WhatsappBusinessProfile[] }>(
      `${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
      token,
    );
    return json.data?.[0] ?? {};
  }

  async updateProfile(phoneNumberId: string, token: string, profile: Omit<WhatsappBusinessProfile, 'profile_picture_url'> & { profile_picture_handle?: string }) {
    await this.graph(`${phoneNumberId}/whatsapp_business_profile`, token, 'POST', { messaging_product: 'whatsapp', ...profile });
  }

  /**
   * Sube una imagen con la API de subida reanudable de Meta y devuelve el "handle" que pide el perfil.
   * La subida va a nombre de la app dueña del token (se averigua con debug_token).
   */
  async uploadProfilePicture(token: string, data: Buffer, mimeType: string): Promise<string> {
    const debug = await this.graph<{ data?: { app_id?: string } }>(`debug_token?input_token=${encodeURIComponent(token)}`, token);
    const appId = debug.data?.app_id;
    if (!appId) throw new Error('No se pudo saber a qué app de Meta pertenece el token');
    const session = await this.graph<{ id: string }>(`${appId}/uploads?file_length=${data.length}&file_type=${encodeURIComponent(mimeType)}`, token, 'POST');
    const res = await fetch(`${this.base()}/${session.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': mimeType },
      body: new Uint8Array(data),
    });
    const json = (await res.json().catch(() => ({}))) as { h?: string; error?: { message: string } };
    if (!res.ok || !json.h) throw new Error(json.error?.message ?? `Error ${res.status} al subir la foto`);
    return json.h;
  }

  private async graph<T>(path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(`${this.base()}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
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
