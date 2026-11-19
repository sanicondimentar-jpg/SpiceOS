import { Badge } from '@/components/ui/badge';
import { dayAr, daysLeft } from '@/lib/documents';

/** Vencimiento de un documento: en rojo si venció, en amarillo si vence en 30 días o menos. */
export function ExpiryBadge({ validUntil }: { validUntil: string | null }) {
  const n = daysLeft(validUntil);
  if (n === null || !validUntil) return null;
  if (n < 0) return <Badge tone="bad" className="shrink-0">Venció el {dayAr(validUntil)}</Badge>;
  if (n <= 30) return <Badge tone="warn" className="shrink-0">Vence el {dayAr(validUntil)}</Badge>;
  return <span className="shrink-0 text-xs text-muted-foreground">Vence el {dayAr(validUntil)}</span>;
}
