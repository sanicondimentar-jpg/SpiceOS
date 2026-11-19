import { Injectable, Logger } from '@nestjs/common';
import type { ReceiptReading } from '@spiceos/contracts';
import { LlmService } from '../../shared/ai/llm.service';
import { BusinessRuleError } from '../../shared/domain/errors';
import { UnitOfWork } from '../../shared/unit-of-work';
import { MAX_IMAGE_BYTES, MAX_READ_BYTES, READABLE_TYPES, READER_SYSTEM, RAW_READING_SCHEMA, catalogForPrompt, toReading, type CatalogVariant, type RawReading } from './receipt-reading';

export interface ReceiptFile {
  data: Buffer;
  mediaType: string;
}

/** Lee un remito de compra (foto o PDF) con IA y lo cruza con el catálogo de la empresa. */
@Injectable()
export class ReceiptReaderService {
  private readonly logger = new Logger(ReceiptReaderService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly uow: UnitOfWork,
  ) {}

  static assertReadable(file: ReceiptFile): void {
    const type = file.mediaType.split(';')[0].trim().toLowerCase();
    if (!(READABLE_TYPES as readonly string[]).includes(type)) throw new BusinessRuleError('Mandá una foto (JPG o PNG) o un PDF del remito');
    if (file.data.length > MAX_READ_BYTES) throw new BusinessRuleError('El archivo es muy grande (máximo 5 MB)');
    // La IA acepta fotos de hasta 5 MB ya codificadas (≈3,7 MB del archivo).
    if (type !== 'application/pdf' && file.data.length > MAX_IMAGE_BYTES) throw new BusinessRuleError('La foto es muy pesada: mandala con menos resolución (hasta 3,5 MB)');
  }

  async read(file: ReceiptFile): Promise<ReceiptReading> {
    ReceiptReaderService.assertReadable(file);
    const catalog = await this.catalog();
    let raw: RawReading;
    try {
      raw = await this.llm.extractJsonFromFile<RawReading>(
        READER_SYSTEM,
        { data: file.data, mediaType: file.mediaType.split(';')[0].trim().toLowerCase() },
        `${catalogForPrompt(catalog)}\n\nLeé el remito adjunto.`,
        RAW_READING_SCHEMA as unknown as Record<string, unknown>,
      );
    } catch (e) {
      this.logger.warn(`No se pudo leer el remito: ${(e as Error).message}`);
      throw new BusinessRuleError('No se pudo leer el remito. Probá con una foto más nítida o cargalo a mano.');
    }
    return toReading(raw, catalog);
  }

  private catalog(): Promise<CatalogVariant[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.productVariant.findMany({
        where: { isActive: true },
        select: { id: true, sku: true, name: true, currentCost: true, product: { select: { name: true } } },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      });
      return rows.map((v) => ({ id: v.id, sku: v.sku, product: v.product.name, presentation: v.name, cost: Number(v.currentCost) || null }));
    });
  }
}
