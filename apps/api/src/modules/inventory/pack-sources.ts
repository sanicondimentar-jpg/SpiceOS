/**
 * Reglas puras para abrir cajas solas cuando un pedido necesita sueltos.
 * Un sobre suelto ("Sobre suelto 25 g (caja de 25)") puede salir de cualquier caja del mismo
 * producto que traiga ese mismo sobre: "Caja 15 sobres × 25 g", "Caja 25 sobres × 25 g", "Caja 50 sobres × 25 g".
 */

const KINDS: Record<string, string> = { sobre: 'sobre', sobres: 'sobre', paquete: 'paquete', paquetes: 'paquete', frasco: 'frasco', frascos: 'frasco', carton: 'carton', cartones: 'carton' };

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const size = (s: string) => plain(s).replace(/\s+/g, '').replace(/×/g, 'x');

/** Qué es un suelto: "Sobre suelto 25 g (caja de 50)" → sobre de 25g. */
export function unitContent(name: string): { kind: string; size: string } | null {
  const m = /^(\S+)\s+suelt[oa]\s+(.+?)\s*\(caja de \d+\)/.exec(plain(name).trim());
  const kind = m && KINDS[m[1]];
  return kind ? { kind, size: size(m[2]) } : null;
}

/** Qué trae una caja: "Caja 50 sobres × 25 g" → 50 sobres de 25g. */
export function packContent(name: string): { units: number; kind: string; size: string } | null {
  const m = /^caja\s+(\d+)\s+(\S+)\s*[×x]\s*(.+)$/.exec(plain(name).trim());
  const kind = m && KINDS[m[2]];
  const units = m ? Number(m[1]) : NaN;
  return kind && Number.isInteger(units) && units > 0 ? { units, kind, size: size(m[3]) } : null;
}

/** Cuántos sueltos salen de abrir la caja, o null si la caja no trae ese suelto. */
export function unitsFromPack(unit: { sku: string; name: string }, pack: { sku: string; name: string }): number | null {
  if (/-U$/i.test(pack.sku)) return null;
  const p = packContent(pack.name);
  if (!p) return null;
  const u = unitContent(unit.name);
  // Si el nombre del suelto no se entiende, solo vale su caja de siempre ("60-U" → "60").
  if (!u) return pack.sku === unit.sku.replace(/-U$/i, '') ? p.units : null;
  return u.kind === p.kind && u.size === p.size ? p.units : null;
}

export interface PackSource {
  variantId: string;
  sku: string;
  /** Cajas disponibles (existente − reservado). */
  available: number;
  /** Sueltos por caja. */
  perPack: number;
}

/**
 * Qué cajas abrir para cubrir `missing` sueltos: de a una caja, siempre la presentación con más
 * cajas en stock en ese momento (si empatan, la que trae más sueltos). Si no alcanzan, abre todas.
 */
export function pickPacks(missing: number, sources: PackSource[]): { variantId: string; sku: string; perPack: number; packs: number }[] {
  const left = new Map(sources.map((s) => [s.variantId, Math.floor(Math.max(s.available, 0))]));
  const opened = new Map<string, number>();
  let remaining = missing;
  while (remaining > 1e-9) {
    const best = sources
      .filter((s) => (left.get(s.variantId) ?? 0) >= 1)
      .sort((a, b) => left.get(b.variantId)! - left.get(a.variantId)! || b.perPack - a.perPack || a.sku.localeCompare(b.sku))[0];
    if (!best) break;
    left.set(best.variantId, left.get(best.variantId)! - 1);
    opened.set(best.variantId, (opened.get(best.variantId) ?? 0) + 1);
    remaining -= best.perPack;
  }
  return sources.filter((s) => opened.has(s.variantId)).map((s) => ({ variantId: s.variantId, sku: s.sku, perPack: s.perPack, packs: opened.get(s.variantId)! }));
}

/** Sueltos que se pueden conseguir abriendo todas las cajas disponibles. */
export function openableUnits(sources: PackSource[]): number {
  return sources.reduce((s, x) => s + Math.floor(Math.max(x.available, 0)) * x.perPack, 0);
}
