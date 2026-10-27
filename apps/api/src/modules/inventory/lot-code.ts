/**
 * Lote a usar para un ingreso. Si no hay número de lote pero sí vencimiento, el lote se arma con la fecha
 * ("V2027-12-01"): así el vencimiento queda registrado y el FEFO lo respeta igual.
 */
export function lotCodeFor(lotCode: string | undefined, expiresAt: Date | undefined | null): string | undefined {
  if (lotCode) return lotCode;
  return expiresAt ? `V${expiresAt.toISOString().slice(0, 10)}` : undefined;
}
