import type { ConditionLeaf, ConditionNode } from '@spiceos/contracts';

/** Evalúa el árbol de condiciones de una regla contra el evento (sin eval, solo operadores declarados). */
export function evaluate(node: ConditionNode, data: unknown): boolean {
  if ('all' in node) return node.all.every((n) => evaluate(n, data));
  if ('any' in node) return node.any.some((n) => evaluate(n, data));
  if ('not' in node) return !evaluate(node.not, data);
  return evaluateLeaf(node, data);
}

function evaluateLeaf({ field, op, value }: ConditionLeaf, data: unknown): boolean {
  const actual = get(data, field);
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'gt':
      return Number(actual) > Number(value);
    case 'gte':
      return Number(actual) >= Number(value);
    case 'lt':
      return Number(actual) < Number(value);
    case 'lte':
      return Number(actual) <= Number(value);
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(value).toLowerCase());
    case 'in':
      return Array.isArray(value) && value.includes(actual);
  }
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/** Reemplaza {{payload.campo}} en títulos y mensajes de las acciones. */
export function render(template: string, data: unknown): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => String(get(data, path) ?? ''));
}
