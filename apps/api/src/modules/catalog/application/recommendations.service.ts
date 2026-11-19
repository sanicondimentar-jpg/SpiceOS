import { Injectable } from '@nestjs/common';
import type { RecommendationListInput } from '@spiceos/contracts';
import { BusinessRuleError } from '../../../shared/domain/errors';
import type { Tx } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { UnitOfWork } from '../../../shared/unit-of-work';
import {
  DEFAULT_RECOMMENDATIONS,
  SEGMENTS,
  SEGMENT_LABELS,
  normalizeSkus,
  onlyActive,
  resolveRecommendations,
  type Segment,
} from '../domain/recommendations';
import { loadCombos } from './combos';

/** Recomendados por tipo de cliente (Configuración → Recomendados). Los leen la web y el asistente de WhatsApp. */
@Injectable()
export class RecommendationsService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Las listas vigentes con solo los productos activos. Para el catálogo público y el asistente. */
  static async active(tx: Tx): Promise<Record<Segment, string[]>> {
    const [stored, variants] = await Promise.all([
      tx.recommendationList.findMany({ select: { segment: true, skus: true } }),
      tx.productVariant.findMany({ where: { isActive: true, product: { isActive: true, deletedAt: null } }, select: { sku: true } }),
    ]);
    return onlyActive(resolveRecommendations(stored), new Set(variants.map((v) => v.sku.toUpperCase())));
  }

  /** Para la pantalla de edición: cada lista con el nombre de cada producto y si está dado de baja. */
  get() {
    return this.uow.read(async (tx) => {
      const stored = await tx.recommendationList.findMany({ select: { segment: true, skus: true, updatedAt: true } });
      const lists = resolveRecommendations(stored);
      const variants = await tx.productVariant.findMany({
        where: { product: { deletedAt: null } },
        select: { sku: true, name: true, isActive: true, product: { select: { name: true, isActive: true } } },
        orderBy: { sku: 'asc' },
      });
      const bySku = new Map(variants.map((v) => [v.sku.toUpperCase(), v]));
      const describe = (sku: string) => {
        const v = bySku.get(sku.toUpperCase());
        return { sku, product: v?.product.name ?? null, presentation: v?.name ?? null, active: !!v && v.isActive && v.product.isActive };
      };
      return {
        segments: SEGMENTS.map((s) => ({
          segment: s,
          label: SEGMENT_LABELS[s],
          isDefault: !stored.some((x) => x.segment === s),
          updatedAt: stored.find((x) => x.segment === s)?.updatedAt ?? null,
          items: lists[s].map(describe),
        })),
        /** Combos (productos con SKU propio): sus sobres y precio. Se editan como cualquier producto. */
        combos: await loadCombos(tx),
        /** Para elegir productos: todo lo activo. */
        options: variants
          .filter((v) => v.isActive && v.product.isActive)
          .map((v) => ({ sku: v.sku, product: v.product.name, presentation: v.name })),
      };
    });
  }

  async save(input: RecommendationListInput) {
    const ctx = RequestContextStore.get();
    const skus = normalizeSkus(input.skus);
    await this.uow.run(async (tx, scope) => {
      const found = await tx.productVariant.findMany({ where: { sku: { in: skus, mode: 'insensitive' } }, select: { sku: true } });
      const known = new Map(found.map((v) => [v.sku.toUpperCase(), v.sku]));
      const unknown = skus.filter((s) => !known.has(s));
      if (unknown.length) throw new BusinessRuleError(`No existen estos códigos: ${unknown.join(', ')}`);
      const ordered = skus.map((s) => known.get(s)!);
      const before = await tx.recommendationList.findUnique({ where: { tenantId_segment: { tenantId: ctx.tenantId, segment: input.segment } } });
      const updatedBy = ctx.actorType === 'USER' ? ctx.userId : null;
      await tx.recommendationList.upsert({
        where: { tenantId_segment: { tenantId: ctx.tenantId, segment: input.segment } },
        create: { tenantId: ctx.tenantId, segment: input.segment, skus: ordered, updatedBy },
        update: { skus: ordered, updatedBy },
      });
      scope.auditLog({
        action: 'recommendations.update',
        entityType: 'recommendation_list',
        entityId: input.segment,
        before: { skus: before?.skus ?? DEFAULT_RECOMMENDATIONS[input.segment] },
        after: { skus: ordered },
      });
    });
    return this.get();
  }

  /** Vuelve a la lista sugerida de fábrica. */
  async reset(segment: Segment) {
    await this.uow.run(async (tx, scope) => {
      const deleted = await tx.recommendationList.deleteMany({ where: { segment } });
      if (deleted.count) scope.auditLog({ action: 'recommendations.reset', entityType: 'recommendation_list', entityId: segment, after: { skus: DEFAULT_RECOMMENDATIONS[segment] } });
    });
    return this.get();
  }
}
