import { lineTotal, marginPct, round2 } from '../../shared/domain/money';
import type { PricedVariant } from '../catalog/catalog.facade';

export interface LineInput {
  variantId: string;
  quantity: number;
  unitPrice?: number;
  discountPct: number;
}

export interface PricedLine extends LineInput {
  description: string;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  marginPct: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  marginTotal: number;
  approvalReasons: string[];
}

/**
 * Política de precios pura (sin I/O), testeable en aislamiento:
 * - precio de lista si no viene precio manual
 * - descuento por encima del tope del rol => aprobación
 * - margen por debajo del mínimo de la variante => aprobación
 */
export function priceLines(inputs: LineInput[], catalog: Map<string, PricedVariant>, maxDiscount: number): PricingResult {
  const approvalReasons: string[] = [];
  const lines = inputs.map((input) => {
    const v = catalog.get(input.variantId)!;
    const unitPrice = input.unitPrice ?? v.listPrice;
    if (unitPrice == null) throw new Error(`${v.name} no tiene precio en la lista del cliente; indicá un precio`);
    const total = lineTotal(input.quantity, unitPrice, input.discountPct);
    const effectivePrice = total / input.quantity;
    const margin = marginPct(effectivePrice, v.cost);
    if (input.discountPct > maxDiscount) {
      approvalReasons.push(`${v.name}: descuento ${input.discountPct}% supera el tope de ${maxDiscount}%`);
    }
    if (margin < v.minMarginPct) {
      approvalReasons.push(`${v.name}: margen ${margin}% bajo el mínimo de ${v.minMarginPct}%`);
    }
    return { ...input, description: v.name, unitPrice, unitCost: v.cost, lineTotal: total, marginPct: margin };
  });
  const gross = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const cost = round2(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0));
  return { lines, subtotal: gross, discountTotal: round2(gross - total), total, marginTotal: round2(total - cost), approvalReasons };
}
