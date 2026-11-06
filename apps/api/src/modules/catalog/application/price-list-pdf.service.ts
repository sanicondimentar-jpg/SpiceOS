import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/domain/errors';
import { PrismaService, SystemPrismaService, type Tx } from '../../../shared/prisma/prisma.service';
import { UnitOfWork } from '../../../shared/unit-of-work';
import { buildPriceListDoc, buildSections, isoDateAr, renderPdf, type PriceRow } from '../domain/price-list-pdf';

export interface PriceListPdf {
  filename: string;
  buffer: Buffer;
}

/**
 * Lista de precios mayorista en PDF, armada en el momento con los precios vigentes:
 * la lista Mayorista (o la lista por defecto) más los sueltos de la lista Minorista. Nunca incluye costos.
 */
@Injectable()
export class PriceListPdfService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly system: SystemPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  /** Para usuarios de SpiceOS (empresa de la sesión). */
  async forCurrentCompany(): Promise<PriceListPdf> {
    return this.render(await this.uow.read((tx) => this.load(tx)));
  }

  /** Para la web pública, por alias de la empresa (ej. "sani-condimentar"). */
  async forOrg(orgAlias: string): Promise<PriceListPdf> {
    const company = await this.system.company.findUnique({ where: { keycloakOrgId: orgAlias }, select: { id: true, status: true } });
    if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Empresa', orgAlias);
    return this.render(await this.prisma.tx((tx) => this.load(tx), company.id));
  }

  /** El PDF se dibuja fuera de la transacción: la base solo se usa para leer los precios. */
  private async render({ wholesale, retail }: { wholesale: PriceRow[]; retail: PriceRow[] }): Promise<PriceListPdf> {
    const now = new Date();
    const buffer = await renderPdf(buildPriceListDoc(buildSections(wholesale, retail), now));
    return { filename: `lista-de-precios-sabor-a-casa-${isoDateAr(now)}.pdf`, buffer };
  }

  private async load(tx: Tx): Promise<{ wholesale: PriceRow[]; retail: PriceRow[] }> {
    const lists = await tx.priceList.findMany({ select: { id: true, name: true, isDefault: true } });
    const wholesale = lists.find((l) => l.name.toLowerCase() === 'mayorista') ?? lists.find((l) => l.isDefault);
    if (!wholesale) throw new NotFoundError('Lista de precios', 'Mayorista');
    const retail = lists.find((l) => l.name.toLowerCase() === 'minorista');

    // En secuencia: es una sola conexión dentro de la transacción.
    return { wholesale: await this.rows(tx, wholesale.id), retail: retail ? await this.rows(tx, retail.id) : [] };
  }

  private async rows(tx: Tx, priceListId: string): Promise<PriceRow[]> {
    const items = await tx.priceListItem.findMany({
      // Precio por unidad (cantidad mínima 1); todos los productos activos, haya stock o no.
      where: { priceListId, minQuantity: 1, variant: { isActive: true, product: { isActive: true, deletedAt: null } } },
      select: { price: true, variant: { select: { sku: true, name: true, netWeightKg: true, product: { select: { name: true } } } } },
    });
    return items.map((i) => ({
      sku: i.variant.sku,
      product: i.variant.product.name,
      variant: i.variant.name,
      netWeightKg: i.variant.netWeightKg === null ? null : Number(i.variant.netWeightKg),
      price: Number(i.price),
    }));
  }
}
