import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/auth/decorators';
import { PublicCatalogService } from './application/public-catalog.service';

/** Catálogo público para la web (saboracasa.com.ar): sin login, de solo lectura y cacheable. */
@ApiTags('Catálogo público')
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

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
