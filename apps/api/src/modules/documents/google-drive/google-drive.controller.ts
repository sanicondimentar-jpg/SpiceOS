import { BadRequestException, Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@spiceos/contracts';
import { Public, RequirePermissions } from '../../../shared/auth/decorators';
import { env } from '../../../shared/config/env';
import { EncryptionService } from '../../../shared/crypto/encryption.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { DriveSyncService } from './drive-sync.service';
import { GoogleDriveClient } from './google-drive.client';

@ApiTags('Integraciones')
@ApiBearerAuth()
@Controller('integrations/google-drive')
export class GoogleDriveController {
  private readonly logger = new Logger(GoogleDriveController.name);

  constructor(
    private readonly drive: GoogleDriveClient,
    private readonly syncer: DriveSyncService,
    private readonly crypto: EncryptionService,
    private readonly prisma: PrismaService,
  ) {}

  /** Devuelve la URL de consentimiento de Google; el state firmado ata el callback a la empresa. */
  @Get('connect')
  @RequirePermissions(PERMISSIONS.admin.settings)
  connect(@Query('folderIds') folderIds: string) {
    if (!driveConfigured()) throw new BadRequestException('Falta cargar en el servidor las claves de Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).');
    const ids = parseFolderIds(folderIds ?? '');
    if (!ids.length) throw new BadRequestException('Pegá el link de al menos una carpeta de Drive.');
    const { tenantId } = RequestContextStore.get();
    const payload = Buffer.from(JSON.stringify({ tenantId, folderIds: ids, ts: Date.now() })).toString('base64url');
    return { url: this.drive.authUrl(`${payload}.${sign(payload)}`) };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const back = `${env().CORS_ORIGINS.split(',')[0]}/settings/integrations`;
    if (error || !code || !state) return res.redirect(`${back}?drive=${error === 'access_denied' ? 'cancelled' : 'error'}`);
    const [payload, signature] = state.split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) throw new BadRequestException('state inválido');
    const { tenantId, folderIds, ts } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      tenantId: string;
      folderIds: string[];
      ts: number;
    };
    if (Date.now() - ts > 10 * 60_000) throw new BadRequestException('state vencido');

    let tokens: Awaited<ReturnType<GoogleDriveClient['exchangeCode']>>;
    try {
      tokens = await this.drive.exchangeCode(code);
    } catch (err) {
      this.logger.error(`Conexión con Drive: ${String(err)}`);
      return res.redirect(`${back}?drive=error`);
    }
    const { email, ...secret } = tokens;
    if (!secret.refresh_token) return res.redirect(`${back}?drive=error`);
    await this.prisma.tx(
      (tx) =>
        tx.driveConnection.upsert({
          where: { tenantId_googleAccount: { tenantId, googleAccount: email } },
          create: { tenantId, googleAccount: email, encryptedTokens: this.crypto.encrypt(JSON.stringify(secret)), rootFolderIds: folderIds },
          update: { encryptedTokens: this.crypto.encrypt(JSON.stringify(secret)), rootFolderIds: folderIds, status: 'ACTIVE', changesPageToken: null },
        }),
      tenantId,
    );
    res.redirect(`${back}?drive=connected`);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.documents.read)
  status() {
    return this.prisma.tx(async (tx) => ({
      configured: driveConfigured(),
      connections: await tx.driveConnection.findMany({
        where: { status: { not: 'DISCONNECTED' } },
        select: { id: true, googleAccount: true, rootFolderIds: true, lastSyncAt: true, status: true },
      }),
      files: await tx.driveFile.groupBy({ by: ['syncStatus'], where: { connection: { status: { not: 'DISCONNECTED' } }, mimeType: { not: 'application/vnd.google-apps.folder' } }, _count: true }),
      errors: await tx.driveFile.findMany({
        where: { syncStatus: 'ERROR', connection: { status: { not: 'DISCONNECTED' } } },
        select: { name: true, lastError: true },
        take: 5,
      }),
    }));
  }

  /** Sincroniza ya, sin esperar los 5 minutos del programador. Corre en segundo plano. */
  @Post('sync')
  @RequirePermissions(PERMISSIONS.admin.settings)
  async syncNow(@Body('connectionId') connectionId: string) {
    const conn = await this.prisma.tx((tx) => tx.driveConnection.findFirstOrThrow({ where: { id: connectionId, status: 'ACTIVE' } }));
    void this.syncer.sync(conn).catch((err) => this.logger.error(`Drive ${conn.googleAccount}: ${String(err)}`));
    return { started: true };
  }

  @Post('disconnect')
  @RequirePermissions(PERMISSIONS.admin.settings)
  disconnect(@Body('connectionId') connectionId: string) {
    return this.prisma.tx((tx) => tx.driveConnection.update({ where: { id: connectionId }, data: { status: 'DISCONNECTED' } }));
  }
}

const driveConfigured = () => !!env().GOOGLE_CLIENT_ID && !!env().GOOGLE_CLIENT_SECRET;

/** Acepta links de carpeta (drive.google.com/drive/folders/<id>, ?id=<id>) o ids sueltos, separados por coma o renglón. */
export function parseFolderIds(input: string): string[] {
  const ids = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.match(/\/folders\/([\w-]+)/)?.[1] ?? s.match(/[?&]id=([\w-]+)/)?.[1] ?? (/^[\w-]{10,}$/.test(s) ? s : ''))
    .filter(Boolean);
  return [...new Set(ids)];
}

function sign(payload: string) {
  return createHmac('sha256', env().DATA_ENCRYPTION_KEY).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
