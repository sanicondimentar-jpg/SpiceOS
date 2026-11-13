import { webOrderSchema, type WebOrderInput } from '@spiceos/contracts';

/**
 * Lee un pedido armado en la web saboracasa.com.ar que llegó como mensaje de WhatsApp.
 *
 * Si la web no pudo registrar el pedido (por ejemplo, el sistema no respondía), el cliente igual
 * lo puede mandar por WhatsApp "sin número de pedido". Ese texto lo arma la web con un formato fijo:
 *
 *   *Pedido — Sabor a Casa*
 *   Modo: Mayorista
 *   Cliente: Rotiseria la Salvadora
 *   Teléfono: 116361-4127
 *
 *   1) [386] Condimento para Aves 151 — × 1 kg
 *      1 × $ 13.700 = $ 13.700
 *
 *   *TOTAL: $ 53.500*
 *   (Precios netos en ARS, sin IVA)
 *
 *   Observaciones: ...
 *
 * Devuelve null si el mensaje no es un pedido de la web o si ya trae número (ya está registrado).
 */
export function parseWebOrderMessage(text: string | null | undefined, senderPhone: string): WebOrderInput | null {
  if (!text) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  const header = lines.findIndex((l) => l.trim() !== '');
  if (header < 0) return null;
  const head = lines[header].trim().replace(/\*/g, '');
  // "Pedido — Sabor a Casa" sin número. Con número ("Pedido PED-… — Sabor a Casa") ya se registró en la web.
  if (!/^Pedido\s*[—–-]\s*Sabor a Casa$/i.test(head)) return null;

  const field = (name: string) => {
    const re = new RegExp(`^${name}:\\s*(.*)$`, 'i');
    for (const l of lines) {
      const m = l.trim().match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  const minorista = /minorista/i.test(field('Modo') ?? '');
  const items: { sku: string; quantity: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i].trim().match(/^\d+\)\s*\[([^\]]+)\]/);
    if (!item) continue;
    const qty = lines[i + 1]?.trim().match(/^(\d+)\s*[×x]/);
    if (!qty) continue;
    const code = item[1].trim();
    items.push({ sku: minorista && !code.endsWith('-U') ? `${code}-U` : code, quantity: Number(qty[1]) });
  }
  if (!items.length) return null;

  const totalLine = lines.find((l) => /^\*?TOTAL:/i.test(l.trim()));
  const total = totalLine ? Number(totalLine.replace(/[^\d,]/g, '').replace(',', '.')) : undefined;

  // Las observaciones pueden ocupar varias líneas: van hasta el final (o hasta el link de seguimiento).
  let notes: string | undefined;
  const obs = lines.findIndex((l) => /^Observaciones:/i.test(l.trim()));
  if (obs >= 0) {
    const rest = [lines[obs].trim().replace(/^Observaciones:\s*/i, '')];
    for (const l of lines.slice(obs + 1)) {
      if (/^Seguí tu pedido/i.test(l.trim())) break;
      rest.push(l);
    }
    notes = rest.join('\n').trim() || undefined;
  }

  const phone = field('Teléfono') ?? field('Telefono');
  const parsed = webOrderSchema.safeParse({
    name: field('Cliente') ?? 'Cliente web',
    // Si el teléfono que escribió no sirve, queda el número desde el que mandó el WhatsApp.
    phone: phone && phone.replace(/\D/g, '').length >= 8 ? phone : senderPhone,
    notes: notes?.slice(0, 1000),
    mode: minorista ? 'minorista' : 'mayorista',
    lines: items,
    total: Number.isFinite(total) ? total : undefined,
  });
  return parsed.success ? parsed.data : null;
}
