import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

/**
 * Puerto único hacia el modelo de lenguaje. Los módulos no instancian SDKs:
 * cambiar de proveedor o de modelo se hace aquí y en AI_MODEL.
 */
@Injectable()
export class LlmService {
  readonly client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  readonly model = env().AI_MODEL;

  /** Llamada simple sin tools (clasificación, resúmenes, extracción). */
  async complete(system: string, user: string, maxTokens = 2048): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('El modelo rechazó la solicitud');
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  /** Extracción estructurada con JSON validado por el esquema. */
  async extractJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('El modelo rechazó la solicitud');
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as T;
  }

  /** Extracción estructurada a partir de una foto o un PDF (remitos, facturas). */
  async extractJsonFromFile<T>(
    system: string,
    file: { data: Buffer; mediaType: string },
    instruction: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const data = file.data.toString('base64');
    const source: Anthropic.ContentBlockParam =
      file.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: file.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data } };
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: instruction }] }],
    });
    if (res.stop_reason === 'refusal') throw new Error('El modelo rechazó la solicitud');
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as T;
  }
}
