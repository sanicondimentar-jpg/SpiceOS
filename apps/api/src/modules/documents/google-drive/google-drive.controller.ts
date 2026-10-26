import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@spiceos/contracts';
import { Public, RequirePermissions } from '../../../shared/auth/decorators';
import { env } from '../../../shared/config/env';
import { EncryptionService } from '../../../shared/crypto/encryption.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { GoogleDriveClient } from './google-drive.client';

@ApiTags('Integraciones')
@ApiBearerAuth()
@Controller('integrations/google-drive')
export class GoogleDriveController {
  constructor(
    private readonly drive: GoogleDriveClient,
    private readonly crypto: EncryptionService,
    private readonly prisma: PrismaService,
  ) {}

  /** Devuelve la URL de consentimiento de Google; el state firmado ata el callback a la empresa. */
  @Get('connect')
  @RequirePermissions(PERMISSIONS.admin.settings)
  connect(@Query('folderIds') folderIds: string) {
    const { tenantId } = RequestContextStore.get();
    const payload = Buffer.from(JSON.stringify({ tenantId, folderIds: folderIds.split(','), ts: Date.now() })).toString('base64url');
    return { url: this.drive.authUrl(`${payload}.${sign(payload)}`) };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const [payload, signature] = state.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) throw new BadRequestException('state inválido');
    const { tenantId, folderIds, ts } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      tenantId: string;
      folderIds: string[];
      ts: number;
    };
    if (Date.now() - ts > 10 * 60_000) throw new BadRequestException('state vencido');

    const tokens = await this.drive.exchangeCode(code);
    const { email, ...secret } = tokens;
    await this.prisma.tx(
      (tx) =>
        tx.driveConnection.upsert({
          where: { tenantId_googleAccount: { tenantId, googleAccount: email } },
          create: { tenantId, googleAccount: email, encryptedTokens: this.crypto.encrypt(JSON.stringify(secret)), rootFolderIds: folderIds },
          update: { encryptedTokens: this.crypto.encrypt(JSON.stringify(secret)), rootFolderIds: folderIds, status: 'ACTIVE', changesPageToken: null },
        }),
      tenantId,
    );
    res.redirect(`${env().CORS_ORIGINS.split(',')[0]}/settings/integrations?drive=connected`);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.documents.read)
  status() {
    return this.prisma.tx(async (tx) => ({
      connections: await tx.driveConnection.findMany({
        select: { id: true, googleAccount: true, rootFolderIds: true, lastSyncAt: true, status: true },
      }),
      files: await tx.driveFile.groupBy({ by: ['syncStatus'], _count: true }),
    }));
  }

  @Post('disconnect')
  @RequirePermissions(PERMISSIONS.admin.settings)
  disconnect(@Body('connectionId') connectionId: string) {
    return this.prisma.tx((tx) => tx.driveConnection.update({ where: { id: connectionId }, data: { status: 'DISCONNECTED' } }));
  }
}

function sign(payload: string) {
  return createHmac('sha256', env().DATA_ENCRYPTION_KEY).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
