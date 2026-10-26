import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Prisma } from '@prisma/client';
import type { ListQuery } from '@spiceos/contracts';
import { UnitOfWork } from '../../../../shared/unit-of-work';
import { NotFoundError } from '../../../../shared/domain/errors';
import { RequestContextStore } from '../../../../shared/tenancy/request-context';

// ---------- Listado paginado ----------
export class ListCustomersQuery {
  constructor(readonly query: ListQuery & { status?: string; ownerId?: string; segmentId?: string }) {}
}

@QueryHandler(ListCustomersQuery)
export class ListCustomersHandler implements IQueryHandler<ListCustomersQuery> {
  constructor(private readonly uow: UnitOfWork) {}

  execute({ query }: ListCustomersQuery) {
    const { branchScope } = RequestContextStore.get();
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status as Prisma.EnumCustomerStatusFilter['equals'] }),
      ...(query.ownerId && { ownerId: query.ownerId }),
      ...(query.segmentId && { segments: { some: { segmentId: query.segmentId } } }),
      ...(branchScope.length && { OR: [{ branchId: null }, { branchId: { in: branchScope } }] }),
      ...(query.q && {
        AND: [
          {
            OR: [
              { legalName: { contains: query.q, mode: 'insensitive' } },
              { tradeName: { contains: query.q, mode: 'insensitive' } },
              { taxId: { contains: query.q } },
              { code: { equals: query.q } },
            ],
          },
        ],
      }),
    };
    return this.uow.read(async (tx) => {
      const [items, total] = await Promise.all([
        tx.customer.findMany({
          where,
          orderBy: { legalName: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true, code: true, legalName: true, tradeName: true, status: true, industry: true,
            phone: true, lastOrderAt: true, riskScore: true, ownerId: true, tags: true,
          },
        }),
        tx.customer.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}

// ---------- Customer 360 ----------
export class GetCustomer360Query {
  constructor(readonly id: string) {}
}

@QueryHandler(GetCustomer360Query)
export class GetCustomer360Handler implements IQueryHandler<GetCustomer360Query> {
  constructor(private readonly uow: UnitOfWork) {}

  execute({ id }: GetCustomer360Query) {
    return this.uow.read(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, deletedAt: null },
        include: {
          contacts: { where: { deletedAt: null } },
          addresses: true,
          segments: { include: { segment: true } },
          account: { include: { riskAssessments: { orderBy: { assessedAt: 'desc' }, take: 1 } } },
          priceList: { select: { id: true, name: true } },
        },
      });
      if (!customer) throw new NotFoundError('Cliente', id);

      const [kpis] = await tx.$queryRaw<
        { orders_12m: bigint; revenue_12m: Prisma.Decimal | null; margin_12m: Prisma.Decimal | null; avg_ticket: Prisma.Decimal | null }[]
      >`
        SELECT count(*) AS orders_12m,
               sum(total) AS revenue_12m,
               sum(margin_total) AS margin_12m,
               avg(total) AS avg_ticket
        FROM sales_orders
        WHERE customer_id = ${id}::uuid AND status NOT IN ('DRAFT','CANCELLED')
          AND created_at > now() - interval '12 months'`;

      const [topProducts, openOpportunities, recentOrders, timeline, conversations, openTasks] = await Promise.all([
        tx.$queryRaw<{ variant_id: string; name: string; qty: Prisma.Decimal; revenue: Prisma.Decimal }[]>`
          SELECT l.variant_id, v.name, sum(l.quantity) AS qty, sum(l.line_total) AS revenue
          FROM sales_order_lines l
          JOIN sales_orders o ON o.id = l.order_id
          JOIN product_variants v ON v.id = l.variant_id
          WHERE o.customer_id = ${id}::uuid AND o.status NOT IN ('DRAFT','CANCELLED')
          GROUP BY l.variant_id, v.name ORDER BY revenue DESC LIMIT 10`,
        tx.opportunity.findMany({ where: { customerId: id, closedAt: null }, include: { stage: true } }),
        tx.salesOrder.findMany({
          where: { customerId: id },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, number: true, status: true, total: true, createdAt: true },
        }),
        tx.activity.findMany({
          where: { entityType: 'customer', entityId: id },
          orderBy: { occurredAt: 'desc' },
          take: 30,
        }),
        tx.conversation.findMany({
          where: { customerId: id },
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
          select: { id: true, lastMessageAt: true, summary: true, sentiment: true },
        }),
        tx.task.findMany({ where: { entityType: 'customer', entityId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      ]);

      return {
        customer,
        kpis: {
          orders12m: Number(kpis?.orders_12m ?? 0),
          revenue12m: Number(kpis?.revenue_12m ?? 0),
          margin12m: Number(kpis?.margin_12m ?? 0),
          avgTicket: Number(kpis?.avg_ticket ?? 0),
          daysSinceLastOrder: customer.lastOrderAt
            ? Math.floor((Date.now() - customer.lastOrderAt.getTime()) / 86_400_000)
            : null,
        },
        topProducts,
        openOpportunities,
        recentOrders,
        timeline,
        conversations,
        openTasks,
      };
    });
  }
}

// ---------- Clientes sin compras ----------
export class FindInactiveCustomersQuery {
  constructor(
    readonly days: number,
    readonly ownerId?: string,
  ) {}
}

export interface InactiveCustomerRow {
  id: string;
  code: string;
  legal_name: string;
  owner_id: string | null;
  last_order_at: Date | null;
  days_inactive: number | null;
  revenue_12m: number;
}

@QueryHandler(FindInactiveCustomersQuery)
export class FindInactiveCustomersHandler implements IQueryHandler<FindInactiveCustomersQuery> {
  constructor(private readonly uow: UnitOfWork) {}

  execute({ days, ownerId }: FindInactiveCustomersQuery) {
    return this.uow.read((tx) =>
      tx.$queryRaw<InactiveCustomerRow[]>`
        SELECT c.id, c.code, c.legal_name, c.owner_id, c.last_order_at,
               (current_date - c.last_order_at::date) AS days_inactive,
               coalesce((SELECT sum(o.total) FROM sales_orders o
                         WHERE o.customer_id = c.id AND o.status NOT IN ('DRAFT','CANCELLED')
                           AND o.created_at > now() - interval '12 months'), 0)::float AS revenue_12m
        FROM customers c
        WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'
          AND c.last_order_at IS NOT NULL
          AND c.last_order_at < now() - make_interval(days => ${days}::int)
          ${ownerId ? Prisma.sql`AND c.owner_id = ${ownerId}::uuid` : Prisma.empty}
        ORDER BY revenue_12m DESC
        LIMIT 200`,
    );
  }
}
