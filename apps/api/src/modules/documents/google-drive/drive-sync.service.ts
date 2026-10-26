import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS } from '@spiceos/contracts';
import { EncryptionService } from '../../../shared/crypto/encryption.service';
import { PrismaService, SystemPrismaService } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { isScheduler } from '../../../shared/process-role';
import { DocumentsService } from '../documents.service';
import { extractText } from '../text-extractor';
import { DriveFileMeta, DriveTokens, GoogleDriveClient } from './google-drive.client';

const FOLDER = 'application/vnd.google-apps.folder';

type Connection = Awaited<ReturnType<SystemPrismaService['driveConnection']['findFirstOrThrow']>>;

/**
 * Sincronización incremental con la Changes API de Drive.
 * Primera vez: recorrido completo de las carpetas raíz. Después: solo cambios desde el último pageToken.
 */
@Injectable()
export class DriveSyncService {
  private readonly logger = new Logger(DriveSyncService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveClient,
    private readonly crypto: EncryptionService,
    private readonly documents: DocumentsService,
  ) {}

  @Cron('*/5 * * * *')
  async syncAll(): Promise<void> {
    if (!isScheduler()) return;
    const connections = await this.system.driveConnection.findMany({ where: { status: 'ACTIVE' } });
    for (const conn of connections) {
      await RequestContextStore.run(this.ctxFor(conn.tenantId), () =>
        this.sync(conn).catch((err) => this.logger.error(`Drive ${conn.googleAccount}: ${String(err)}`)),
      );
    }
  }

  async sync(conn: Connection): Promise<void> {
    const tokens = await this.tokens(conn);
    if (!conn.changesPageToken) {
      const startToken = await this.drive.startPageToken(tokens.access_token);
      for (const root of conn.rootFolderIds) await this.crawl(conn, tokens.access_token, root);
      await this.saveConnection(conn.id, { changesPageToken: startToken, lastSyncAt: new Date() });
      return;
    }

    const tracked = new Set([
      ...conn.rootFolderIds,
      ...(await this.prisma.tx((tx) => tx.driveFile.findMany({ where: { connectionId: conn.id, mimeType: FOLDER }, select: { driveFileId: true } }))).map(
        (f) => f.driveFileId,
      ),
    ]);
    let pageToken: string | undefined = conn.changesPageToken;
    let newStart: string | undefined;
    while (pageToken) {
      const page = await this.drive.changes(tokens.access_token, pageToken);
      for (const change of page.changes) {
        if (change.removed || change.file?.trashed) {
          await this.markRemoved(conn.id, change.fileId);
        } else if (change.file && change.file.parents?.some((p) => tracked.has(p))) {
          if (change.file.mimeType === FOLDER) tracked.add(change.file.id);
          await this.process(conn, tokens.access_token, change.file);
        }
      }
      pageToken = page.nextPageToken;
      newStart = page.newStartPageToken ?? newStart;
    }
    await this.saveConnection(conn.id, { changesPageToken: newStart ?? conn.changesPageToken, lastSyncAt: new Date() });
  }

  private async crawl(conn: Connection, accessToken: string, folderId: string): Promise<void> {
    let pageToken: string | undefined;
    do {
      const page = await this.drive.listFolder(accessToken, folderId, pageToken);
      for (const file of page.files) {
        await this.process(conn, accessToken, file);
        if (file.mimeType === FOLDER) await this.crawl(conn, accessToken, file.id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  private async process(conn: Connection, accessToken: string, file: DriveFileMeta): Promise<void> {
    const existing = await this.prisma.tx((tx) =>
      tx.driveFile.findUnique({ where: { connectionId_driveFileId: { connectionId: conn.id, driveFileId: file.id } } }),
    );
    const unchanged = existing && existing.syncStatus === 'INDEXED' && existing.modifiedTime.toISOString() === new Date(file.modifiedTime).toISOString();
    const record = await this.prisma.tx((tx) =>
      tx.driveFile.upsert({
        where: { connectionId_driveFileId: { connectionId: conn.id, driveFileId: file.id } },
        create: {
          tenantId: conn.tenantId,
          connectionId: conn.id,
          driveFileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          parents: file.parents ?? [],
          webViewLink: file.webViewLink,
          md5: file.md5Checksum,
          modifiedTime: new Date(file.modifiedTime),
        },
        update: { name: file.name, parents: file.parents ?? [], md5: file.md5Checksum, modifiedTime: new Date(file.modifiedTime) },
      }),
    );
    if (file.mimeType === FOLDER || unchanged) return;

    try {
      const { data, mimeType } = await this.drive.download(accessToken, file);
      const text = await extractText(data, mimeType);
      if (!text) {
        await this.prisma.tx((tx) => tx.driveFile.update({ where: { id: record.id }, data: { syncStatus: 'SKIPPED' } }));
        return;
      }
      const result = await this.documents.addVersion({
        documentId: record.documentId ?? undefined,
        title: file.name,
        kind: guessKind(file.name),
        mimeType,
        content: data,
        extractedText: text,
        driveRevisionId: file.headRevisionId,
      });
      await this.prisma.tx((tx) =>
        tx.driveFile.update({
          where: { id: record.id },
          data: { syncStatus: 'INDEXED', lastError: null, ...(result && { documentId: result.documentId }) },
        }),
      );
    } catch (err) {
      await this.prisma.tx((tx) => tx.driveFile.update({ where: { id: record.id }, data: { syncStatus: 'ERROR', lastError: String(err) } }));
      throw err;
    }
  }

  private async markRemoved(connectionId: string, driveFileId: string) {
    await this.prisma.tx(async (tx) => {
      const f = await tx.driveFile.findUnique({ where: { connectionId_driveFileId: { connectionId, driveFileId } } });
      if (f?.documentId) await tx.document.update({ where: { id: f.documentId }, data: { deletedAt: new Date() } });
    });
  }

  private async tokens(conn: Connection): Promise<DriveTokens> {
    const current = JSON.parse(this.crypto.decrypt(conn.encryptedTokens)) as DriveTokens;
    const fresh = await this.drive.refresh(current);
    if (fresh.access_token !== current.access_token) {
      await this.saveConnection(conn.id, { encryptedTokens: this.crypto.encrypt(JSON.stringify(fresh)) });
    }
    return fresh;
  }

  private saveConnection(id: string, data: { changesPageToken?: string; lastSyncAt?: Date; encryptedTokens?: Buffer }) {
    return this.prisma.tx((tx) => tx.driveConnection.update({ where: { id }, data }));
  }

  private ctxFor(tenantId: string) {
    return {
      tenantId,
      userId: '00000000-0000-0000-0000-000000000000',
      actor: 'integration:google-drive',
      actorType: 'INTEGRATION' as const,
      roleKey: 'system',
      permissions: new Set(ALL_PERMISSIONS),
      branchScope: [],
      maxDiscount: 0,
      correlationId: randomUUID(),
    };
  }
}

function guessKind(name: string) {
  const n = name.toLowerCase();
  if (n.includes('certific')) return 'CERTIFICATE' as const;
  if (n.includes('ficha')) return 'TECHNICAL_SHEET' as const;
  if (n.includes('análisis') || n.includes('analisis') || n.includes('laboratorio')) return 'LAB_ANALYSIS' as const;
  if (n.includes('catálogo') || n.includes('catalogo')) return 'CATALOG' as const;
  if (n.includes('lista de precios')) return 'PRICE_LIST' as const;
  if (n.includes('manual') || n.includes('procedimiento')) return 'MANUAL' as const;
  return 'OTHER' as const;
}
