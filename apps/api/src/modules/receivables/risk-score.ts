export interface RiskInputs {
  overdueAmount: number;
  balance: number;
  creditLimit: number | null;
  maxDaysOverdue: number;
  bouncedChecks12m: number;
  purchaseTrendPct: number; // variación de compras últimos 90 días vs 90 previos
}

export interface RiskResult {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: Record<string, number>;
}

/** Score explicable 0-100. Cada factor suma puntos acotados; el agente de cobranza lo explica en lenguaje natural. */
export function scoreRisk(i: RiskInputs): RiskResult {
  const factors = {
    days_overdue: Math.min(40, i.maxDaysOverdue * 0.5),
    overdue_ratio: i.balance > 0 ? Math.min(25, (i.overdueAmount / i.balance) * 25) : 0,
    credit_usage: i.creditLimit ? Math.min(15, Math.max(0, (i.balance / i.creditLimit - 0.8) * 50)) : 0,
    bounced_checks: Math.min(15, i.bouncedChecks12m * 7.5),
    purchase_drop: i.purchaseTrendPct < -30 ? 5 : 0,
  };
  const score = Math.round(Object.values(factors).reduce((a, b) => a + b, 0));
  const level = score >= 70 ? 'CRITICAL' : score >= 45 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
  return { score, level, factors };
}
