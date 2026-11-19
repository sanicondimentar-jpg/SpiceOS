import { Injectable } from '@nestjs/common';
import type { ApiKeySummary, CreateApiKeyInput } from '@spiceos/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { ConflictError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';

export const API_KEY_PREFIX = 'spk_';
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Claves de acceso para integraciones. La clave se muestra una sola vez; se guarda solo su hash. */
@Injectable()
export class ApiKeysService {
  constructor(private readonly uow: UnitOfWork) {}

  list(): Promise<ApiKeySummary[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
      return rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scope: k.scope,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
      }));
    });
  }

  create(input: CreateApiKeyInput): Promise<{ id: string; key: string }> {
    const ctx = RequestContextStore.get();
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    return this.uow.run(async (tx, scope) => {
      const row = await tx.apiKey.create({
        data: { tenantId: ctx.tenantId, name: input.name, prefix: key.slice(0, 10), keyHash: hashApiKey(key), scope: 'receipts', createdBy: ctx.userId },
      });
      scope.auditLog({ action: 'api_key.create', entityType: 'api_key', entityId: row.id, after: { name: input.name, scope: 'receipts' } });
      return { id: row.id, key };
    });
  }

  revoke(id: string) {
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!count) throw new ConflictError('La clave no existe o ya estaba revocada');
      scope.auditLog({ action: 'api_key.revoke', entityType: 'api_key', entityId: id });
      return { id };
    });
  }
}
