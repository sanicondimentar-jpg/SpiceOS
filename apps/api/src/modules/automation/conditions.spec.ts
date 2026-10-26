import { evaluate, render } from './conditions';

const event = { type: 'quote.created', payload: { total: 2_500_000, requiresApproval: false, intent: 'purchase_intent' } };

describe('motor de reglas', () => {
  it('SI presupuesto supera un monto', () => {
    expect(evaluate({ field: 'payload.total', op: 'gt', value: 2_000_000 }, event)).toBe(true);
  });

  it('combina all / any / not', () => {
    const rule = {
      all: [
        { field: 'payload.total', op: 'gte' as const, value: 1_000_000 },
        { any: [{ field: 'payload.intent', op: 'eq' as const, value: 'purchase_intent' }, { field: 'payload.x', op: 'exists' as const }] },
        { not: { field: 'payload.requiresApproval', op: 'eq' as const, value: true } },
      ],
    };
    expect(evaluate(rule, event)).toBe(true);
  });

  it('renderiza plantillas', () => {
    expect(render('Cotización por ${{payload.total}}', event)).toBe('Cotización por $2500000');
  });
});
