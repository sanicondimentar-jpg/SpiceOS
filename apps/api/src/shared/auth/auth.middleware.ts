import { Injectable, Logger, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import type { PermissionKey } from '@spiceos/contracts';
import { env } from '../config/env';
import { SystemPrismaService } from '../prisma/prisma.service';
import { RequestContext, RequestContextStore } from '../tenancy/request-context';

interface KeycloakToken extends JWTPayload {
  email?: string;
  name?: string;
  // Keycloak Organizations: { "<alias>": { "id": "<orgId>" } }
  organization?: Record<string, { id?: string }> | string[];
}

interface CachedIdentity {
  ctx: Omit<RequestContext, 'correlationId' | 'ip'>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
/** Única ruta que acepta clave de acceso (ver ReceiptsController.create). */
const API_KEY_ROUTE = '/api/v1/receipts/pending';

/**
 * Verifica el JWT de Keycloak, resuelve empresa + membresía y ejecuta el resto
 * del request dentro de un RequestContext (AsyncLocalStorage).
 * El tenant sale SIEMPRE del token; el header x-spiceos-org solo elige entre
 * organizaciones que el token ya incluye.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly jwks = createRemoteJWKSet(new URL(`${env().KEYCLOAK_ISSUER}/protocol/openid-connect/certs`));
  private readonly cache = new Map<string, CachedIdentity>();
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly db: SystemPrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey) return this.useApiKey(req, apiKey, next);
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(); // el guard decide si el endpoint es público

    let token: KeycloakToken;
    try {
      const { payload } = await jwtVerify(header.slice(7), this.jwks, {
        issuer: env().KEYCLOAK_ISSUER,
        audience: env().KEYCLOAK_AUDIENCE,
      });
      token = payload as KeycloakToken;
    } catch (e) {
      // Solo el motivo (vencido, audiencia, emisor, firma), nunca el token.
      this.logger.warn(`Token rechazado: ${(e as { code?: string }).code ?? (e as Error).message}`);
      throw new UnauthorizedException('Token inválido o vencido');
    }

    const orgIds = this.orgIdsFrom(token);
    const requested = req.headers['x-spiceos-org'] as string | undefined;
    const orgId = requested ?? orgIds[0];
    if (!orgId || !orgIds.includes(orgId)) throw new ForbiddenException('El usuario no pertenece a la organización');

    const identity = await this.resolve(token.sub!, orgId);
    const ctx: RequestContext = {
      ...identity,
      correlationId: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      ip: req.ip,
    };
    RequestContextStore.run(ctx, () => next());
  }

  /**
   * Clave de acceso de una integración (Claude): solo puede dejar remitos por confirmar.
   * Cualquier otra ruta se rechaza acá, antes de llegar a los controladores.
   */
  private async useApiKey(req: Request, key: string, next: NextFunction) {
    const path = (req.originalUrl ?? req.url).split('?')[0].replace(/\/+$/, '');
    if (req.method !== 'POST' || path !== API_KEY_ROUTE) throw new ForbiddenException('La clave de acceso solo sirve para cargar remitos');
    const hash = createHash('sha256').update(key).digest('hex');
    const row = await this.db.apiKey.findUnique({ where: { keyHash: hash } });
    if (!row || row.revokedAt) throw new UnauthorizedException('Clave de acceso inválida o revocada');
    const company = await this.db.company.findFirst({ where: { id: row.tenantId, status: 'ACTIVE' }, select: { id: true } });
    if (!company) throw new ForbiddenException('La empresa no está activa');
    await this.db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    const ctx: RequestContext = {
      tenantId: row.tenantId,
      userId: row.createdBy,
      actor: `apikey:${row.name}`,
      actorType: 'INTEGRATION',
      roleKey: 'integration',
      permissions: new Set(),
      branchScope: [],
      maxDiscount: 0,
      correlationId: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      ip: req.ip,
    };
    RequestContextStore.run(ctx, () => next());
  }

  private orgIdsFrom(token: KeycloakToken): string[] {
    const org = token.organization;
    if (!org) return [];
    if (Array.isArray(org)) return org;
    // Se aceptan el alias y el id: según cómo esté configurado el mapper, el claim trae uno u otro.
    return Object.entries(org).flatMap(([alias, o]) => (o.id ? [alias, o.id] : [alias]));
  }

  private async resolve(keycloakId: string, orgId: string): Promise<CachedIdentity['ctx']> {
    const key = `${keycloakId}:${orgId}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.ctx;

    const membership = await this.db.membership.findFirst({
      where: { isActive: true, user: { keycloakId, isActive: true }, company: { keycloakOrgId: orgId, status: 'ACTIVE' } },
      include: { role: { include: { permissions: true } } },
    });
    if (!membership) throw new ForbiddenException('Sin membresía activa en esta empresa');

    const ctx: CachedIdentity['ctx'] = {
      tenantId: membership.tenantId,
      userId: membership.userId,
      actor: membership.userId,
      actorType: 'USER',
      roleKey: membership.role.key,
      permissions: new Set(membership.role.permissions.map((p) => p.permissionKey as PermissionKey)),
      branchScope: membership.branchScope,
      maxDiscount: Number(membership.role.maxDiscount),
    };
    this.cache.set(key, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
    return ctx;
  }
}
