import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/auth/decorators';
import { PriceListPdfService } from './application/price-list-pdf.service';
import { PublicCatalogService } from './application/public-catalog.service';

/** Catálogo público para la web (saboracasa.com.ar): sin login, de solo lectura y cacheable. */
@ApiTags('Catálogo público')
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly pdf: PriceListPdfService,
  ) {}

  /** Lista de precios mayorista en PDF, para el link "Descargar lista de precios" de la web. */
  @Public()
  @Get(':org/lista-de-precios.pdf')
  async priceListPdf(@Param('org') org: string, @Res() res: Response) {
    const { filename, buffer } = await this.pdf.forOrg(org);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=300',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .send(buffer);
  }

  @Public()
  @Get(':org')
  // Lo lee el navegador desde otro dominio, sin credenciales.
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=60')
  get(@Param('org') org: string) {
    return this.catalog.get(org);
  }
}
