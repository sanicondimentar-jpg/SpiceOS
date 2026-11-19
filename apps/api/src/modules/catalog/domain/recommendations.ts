/**
 * Productos recomendados por tipo de cliente. Los usan la web (al elegir "compro por menor" o el rubro
 * mayorista) y el asistente de WhatsApp, así los dos recomiendan lo mismo. Se editan en
 * Configuración → Recomendados; sin cambios guardados se usan estas listas (aprobadas por Nacho, 19/11/2026).
 */
export const SEGMENTS = ['MINORISTA', 'ROTISERIA', 'CATERING', 'PIZZERIA', 'PASTELERIA'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  MINORISTA: 'Minorista',
  ROTISERIA: 'Rotisería',
  CATERING: 'Catering',
  PIZZERIA: 'Pizzería',
  PASTELERIA: 'Pastelería',
};

/** Minoristas: sueltos ("-U"). Mayoristas: cajas y bolsas. En el orden en que se muestran. */
export const DEFAULT_RECOMMENDATIONS: Record<Segment, string[]> = {
  // Lo del combo básico y después variedad.
  MINORISTA: ['179-U', '41-U', '141-U', '60-U', '330-U', '329-U', '373-U', '105-U', '48-U', '82-U', '148-U'],
  // Pimentón, ají, pimienta, orégano, ajo, chimichurri, aves, provenzal, perejil (1 kg); comino y arroz 500 g; laurel.
  ROTISERIA: ['245', '253', '174', '133', '361', '231', '386', '359', '249', '99', '240', '122'],
  // Pimienta blanca 500 g, nuez moscada 250 g, pimienta en grano, ajo granulado, provenzal, perejil, pescado, aves,
  // pimentón flor selecto, salsa blanca (1 kg), comino 500 g, salsa de soja caja 12.
  CATERING: ['155', '124', '183', '379', '359', '249', '362', '386', '181', '205', '99', '514'],
  // Orégano, adobo, ají, ajo en polvo, ajo granulado, albahaca, pimentón, pimienta, provenzal (1 kg);
  // cajas de 50 sobres de orégano y adobo para pizza.
  PIZZERIA: ['133', '52', '253', '361', '379', '345', '245', '174', '359', '141', '50'],
  // Impalpable, canela, coco, bicarbonato (1 kg); polvo para hornear y granas caja 50; vainilla caja 24;
  // nuez moscada y anís 250 g.
  PASTELERIA: ['75', '77', '480', '344', '438', '271', '204', '124', '278'],
};

/** Combo básico para minoristas (definido con Nacho): sobres sueltos de 25 g; el precio sale del catálogo. */
export const RETAIL_COMBO = {
  name: 'Combo básico',
  items: [
    { sku: '179-U', quantity: 10 }, // Pimienta negra molida, sobre 25 g
    { sku: '41-U', quantity: 10 }, // Pimentón seleccionado, sobre 25 g
    { sku: '141-U', quantity: 10 }, // Orégano en hojas, sobre 25 g
    { sku: '60-U', quantity: 10 }, // Ají molido, sobre 25 g
  ],
  /** Descuento sobre el combo solo en la primera compra del cliente. */
  firstPurchaseDiscountPct: 10,
};

/** Limpia una lista: códigos en mayúscula, sin espacios ni repetidos, en el orden dado. */
export function normalizeSkus(skus: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skus) {
    const sku = raw.trim().toUpperCase();
    if (sku && !seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

/** Las listas vigentes: lo guardado para cada tipo de cliente o, si no hay nada, la lista por defecto. */
export function resolveRecommendations(stored: { segment: string; skus: string[] }[]): Record<Segment, string[]> {
  const bySegment = new Map(stored.map((s) => [s.segment, s.skus]));
  return Object.fromEntries(SEGMENTS.map((s) => [s, bySegment.get(s) ?? DEFAULT_RECOMMENDATIONS[s]])) as Record<Segment, string[]>;
}

/** Deja solo los códigos que existen y están activos, sin cambiar el orden. */
export function onlyActive(lists: Record<Segment, string[]>, active: Set<string>): Record<Segment, string[]> {
  return Object.fromEntries(SEGMENTS.map((s) => [s, lists[s].filter((sku) => active.has(sku.toUpperCase()))])) as Record<Segment, string[]>;
}

/** Para el asistente: qué recomendar primero según el tipo de cliente. */
export function recommendationsText(lists: Record<Segment, string[]>, describe: (sku: string) => string | null): string {
  const lines = SEGMENTS.map((s) => {
    const items = lists[s].map((sku) => describe(sku)).filter((d): d is string => !!d);
    return items.length ? `- ${SEGMENT_LABELS[s]}: ${items.join('; ')}` : null;
  }).filter(Boolean);
  if (!lines.length) return '';
  return [
    'Recomendados por tipo de cliente (los mismos que muestra la web; ofrecé de estos primero según el rubro, y si el rubro es otro, lo más parecido):',
    ...lines,
  ].join('\n');
}
