import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CreateQuoteInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { DomainEvent } from '../../shared/domain/domain-event';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { NotFoundError, BusinessRuleError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { CatalogFacade } from '../catalog/catalog.facade';
import { CrmFacade } from '../crm/crm.facade';
import { priceLines } from './quote-pricing';

class QuoteEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogFacade,
    private readonly crm: CrmFacade,
  ) {}

  create(input: CreateQuoteInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const { priceListId } = await this.crm.assertCanOrder(tx, input.customerId);
      const catalog = await this.catalog.price(tx, input.lines, priceListId);
      const pricing = priceLines(input.lines, catalog, ctx.maxDiscount);
      const requiresApproval = pricing.approvalReasons.length > 0;
      const id = randomUUID();
      const number = await nextNumber(tx, input.branchId, 'quote', 'COT-');

      await tx.quote.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          number,
          customerId: input.customerId,
          opportunityId: input.opportunityId,
          status: requiresApproval ? 'PENDING_APPROVAL' : 'DRAFT',
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          validUntil: new Date(Date.now() + input.validDays * 86_400_000),
          notes: input.notes,
          requiresApproval,
          createdByAgent: ctx.actorType === 'AGENT' ? ctx.actor : null,
          createdBy: ctx.actorType === 'USER' ? ctx.userId : ctx.onBehalfOf,
          lines: {
            create: pricing.lines.map((l) => ({
              variantId: l.variantId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              unitCost: l.unitCost,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });

      const events = new QuoteEvents();
      events.emit(
        new DomainEvent('quote.created', 'quote', id, {
          quoteId: id,
          customerId: input.customerId,
          total: pricing.total,
          currency: 'ARS',
          requiresApproval,
        }),
      );
      if (requiresApproval) {
        events.emit(new DomainEvent('quote.approval_requested', 'quote', id, { quoteId: id, reasons: pricing.approvalReasons }));
      }
      scope.track(events);
      scope.auditLog({ action: 'quote.create', entityType: 'quote', entityId: id, after: { number, ...pricing } });
      return { id, number, status: requiresApproval ? 'PENDING_APPROVAL' : 'DRAFT', ...pricing };
    });
  }

  approve(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const quote = await tx.quote.findFirst({ where: { id } });
      if (!quote) throw new NotFoundError('Cotización', id);
      if (quote.status !== 'PENDING_APPROVAL') throw new BusinessRuleError('La cotización no está pendiente de aprobación');
      await tx.quote.update({ where: { id }, data: { status: 'DRAFT', approvedBy: ctx.userId, version: { increment: 1 } } });
      const events = new QuoteEvents();
      events.emit(new DomainEvent('quote.approved', 'quote', id, { quoteId: id, approvedBy: ctx.userId }));
      scope.track(events);
      scope.auditLog({ action: 'quote.approve', entityType: 'quote', entityId: id });
      return { id, status: 'DRAFT' };
    });
  }

  get(id: string) {
    return this.uow.read(async (tx) => {
      const q = await tx.quote.findFirst({ where: { id }, include: { lines: true, customer: { select: { legalName: true } } } });
      if (!q) throw new NotFoundError('Cotización', id);
      return q;
    });
  }

  openOpportunities(ownerId?: string) {
    return this.uow.read((tx) =>
      tx.opportunity.findMany({
        where: { closedAt: null, ...(ownerId && { ownerId }) },
        include: { stage: { select: { name: true, probability: true } }, customer: { select: { id: true, legalName: true } } },
        orderBy: [{ expectedClose: 'asc' }],
        take: 100,
      }),
    );
  }

  pipelineSummary() {
    return this.uow.read((tx) =>
      tx.$queryRaw<{ stage: string; position: number; count: number; amount: number; weighted: number }[]>`
        SELECT s.name AS stage, s.position, count(o.id)::int AS count,
               coalesce(sum(o.amount), 0)::float AS amount,
               coalesce(sum(o.amount * s.probability / 100.0), 0)::float AS weighted
        FROM pipeline_stages s
        LEFT JOIN opportunities o ON o.stage_id = s.id AND o.closed_at IS NULL
        GROUP BY s.id ORDER BY s.position`,
    );
  }
}

export type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { lines: true } }>;
