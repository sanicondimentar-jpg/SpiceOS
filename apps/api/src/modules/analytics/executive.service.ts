import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../shared/unit-of-work';

export interface ExecutiveKpis {
  revenue_mtd: number;
  revenue_prev_mtd: number;
  margin_mtd: number;
  orders_mtd: number;
  active_customers_90d: number;
  inactive_customers_60d: number;
  overdue_total: number;
  open_pipeline_weighted: number;
  stock_alerts: number;
  expiring_lots_30d: number;
}

/** Read model del tablero ejecutivo (CQRS: lectura separada; en fase 2 sale de vistas materializadas). */
@Injectable()
export class ExecutiveService {
  constructor(private readonly uow: UnitOfWork) {}

  async kpis(): Promise<ExecutiveKpis> {
    const [row] = await this.uow.read((tx) =>
      tx.$queryRaw<ExecutiveKpis[]>`
        SELECT
          (SELECT coalesce(sum(total),0) FROM sales_orders WHERE status NOT IN ('DRAFT','CANCELLED') AND created_at >= date_trunc('month', now()))::float AS revenue_mtd,
          (SELECT coalesce(sum(total),0) FROM sales_orders WHERE status NOT IN ('DRAFT','CANCELLED')
             AND created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < now() - interval '1 month')::float AS revenue_prev_mtd,
          (SELECT coalesce(sum(margin_total),0) FROM sales_orders WHERE status NOT IN ('DRAFT','CANCELLED') AND created_at >= date_trunc('month', now()))::float AS margin_mtd,
          (SELECT count(*) FROM sales_orders WHERE status NOT IN ('DRAFT','CANCELLED') AND created_at >= date_trunc('month', now()))::int AS orders_mtd,
          (SELECT count(*) FROM customers WHERE last_order_at > now() - interval '90 days')::int AS active_customers_90d,
          (SELECT count(*) FROM customers WHERE status = 'ACTIVE' AND last_order_at < now() - interval '60 days')::int AS inactive_customers_60d,
          (SELECT coalesce(sum(overdue),0) FROM customer_accounts)::float AS overdue_total,
          (SELECT coalesce(sum(o.amount * s.probability / 100.0),0) FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.closed_at IS NULL)::float AS open_pipeline_weighted,
          (SELECT count(*) FROM product_variants v WHERE v.is_active AND
             (SELECT coalesce(sum(on_hand - reserved),0) FROM stock_items s WHERE s.variant_id = v.id) <= v.reorder_point)::int AS stock_alerts,
          (SELECT count(*) FROM lots WHERE expires_at <= current_date + 30)::int AS expiring_lots_30d`,
    );
    return row;
  }

  revenueByMonth(months = 12) {
    return this.uow.read((tx) =>
      tx.$queryRaw<{ month: string; revenue: number; margin: number }[]>`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               sum(total)::float AS revenue, sum(margin_total)::float AS margin
        FROM sales_orders
        WHERE status NOT IN ('DRAFT','CANCELLED') AND created_at > date_trunc('month', now()) - make_interval(months => ${months}::int)
        GROUP BY 1 ORDER BY 1`,
    );
  }
}
