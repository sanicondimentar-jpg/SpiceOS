/** Matcher mínimo de cron (minuto hora díaMes mes díaSemana) a resolución horaria. */
export const CronExpressionParser = {
  matchesHour(expr: string, date: Date): boolean {
    const [, hour, dom, month, dow] = expr.trim().split(/\s+/);
    return (
      field(hour, date.getHours()) && field(dom, date.getDate()) && field(month, date.getMonth() + 1) && field(dow, date.getDay())
    );
  },
};

function field(spec: string | undefined, value: number): boolean {
  if (!spec || spec === '*') return true;
  return spec.split(',').some((part) => {
    const [range, step] = part.split('/');
    const [lo, hi] = range === '*' ? [0, 99] : range.split('-').map(Number);
    const inRange = value >= lo && value <= (hi ?? lo);
    return inRange && (!step || (value - lo) % Number(step) === 0);
  });
}
