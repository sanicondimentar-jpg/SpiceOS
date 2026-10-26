import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { UnitOfWork } from '../../shared/unit-of-work';

@Injectable()
export class ReceivablesAiTools {
  constructor(private readonly uow: UnitOfWork) {}

  @AiTool({
    name: 'collections_customers_at_risk',
    description:
      'Clientes en riesgo financiero: deuda vencida, días de mora máximos, saldo, límite de crédito y último score de riesgo. Responde "¿qué clientes están en riesgo?".',
    input: z.object({ minLevel: z.enum(['MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'), limit: z.number().int().max(100).default(25) }),
    permissions: [PERMISSIONS.receivables.read],
    agents: ['collections', 'executive', 'commercial'],
  })
  customersAtRisk({ minLevel, limit }: { minLevel: string; limit: number }) {
    const levels = { MEDIUM: ['MEDIUM', 'HIGH', 'CRITICAL'], HIGH: ['HIGH', 'CRITICAL'], CRITICAL: ['CRITICAL'] }[minLevel]!;
    return this.uow.read((tx) =>
      tx.$queryRaw`
        SELECT c.id AS customer_id, c.legal_name, a.balance::float, a.overdue::float, c.credit_limit::float,
               (current_date - a.oldest_due_at) AS max_days_overdue,
               r.score, r.level, r.explanation
        FROM customer_accounts a
        JOIN customers c ON c.id = a.customer_id
        JOIN LATERAL (
          SELECT score, level, explanation FROM risk_assessments
          WHERE account_id = a.id ORDER BY assessed_at DESC LIMIT 1
        ) r ON true
        WHERE r.level = ANY(${levels})
        ORDER BY r.score DESC, a.overdue DESC
        LIMIT ${limit}`,
    );
  }

  @AiTool({
    name: 'collections_aging_report',
    description: 'Antigüedad de deuda de toda la cartera por tramos (al día, 1-30, 31-60, 61-90, +90 días).',
    input: z.object({}),
    permissions: [PERMISSIONS.receivables.read],
    agents: ['collections', 'executive'],
  })
  aging() {
    return this.uow.read((tx) =>
      tx.$queryRaw`
        SELECT CASE
                 WHEN due_date >= current_date THEN 'al día'
                 WHEN current_date - due_date <= 30 THEN '1-30'
                 WHEN current_date - due_date <= 60 THEN '31-60'
                 WHEN current_date - due_date <= 90 THEN '61-90'
                 ELSE '+90' END AS bucket,
               count(*)::int AS invoices, sum(pending)::float AS amount
        FROM invoices WHERE status IN ('OPEN','PARTIALLY_PAID')
        GROUP BY 1 ORDER BY min(due_date) DESC`,
    );
  }
}
