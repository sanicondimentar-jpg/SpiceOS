import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { PERMISSIONS, type PermissionKey } from '@spiceos/contracts';
import { BusinessRuleError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { samePhone } from '../../shared/staff/staff-phone';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { PriceListsService } from '../catalog/application/price-lists.service';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { ConversationsService, MANUAL_PAUSE } from '../messaging/conversations.service';
import { OrdersService, ACTIVE_STATUSES } from '../orders/orders.service';
import { SupplierAccountsService } from '../purchasing/supplier-accounts.service';
import { CollectionsService } from '../receivables/collections.service';
import { money } from '../sales-assistant/domain/assistant';
import { AiOrdersService } from './ai-orders.service';
import { argentinaDate, orderStatusLabel, STAGE_BY_WORD } from './domain/staff';

type Input = Record<string, unknown>;

export interface ToolOutcome {
  /** En palabras, para el registro de "Órdenes a la IA". */
  summary: string;
  data: unknown;
}

export interface StaffTool {
  def: Anthropic.Tool;
  permissions: PermissionKey[];
  /**
   * Acción delicada: no se ejecuta en el momento. `prepare` valida y arma el resumen que se le muestra al usuario;
   * `run` corre recién cuando responde "sí", con la entrada que devolvió `prepare` (no la que mande el modelo después).
   */
  prepare?: (input: Input) => Promise<{ summary: string; input: Input }>;
  run: (input: Input) => Promise<ToolOutcome>;
}

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): Anthropic.Tool.InputSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: 'string', description });
const tool = (name: string, description: string, input_schema: Anthropic.Tool.InputSchema): Anthropic.Tool =>
  ({ name, description, input_schema, strict: true }) as Anthropic.Tool;

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const fmtDate = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' });

/**
 * Herramientas del asistente interno (dueños y equipo por WhatsApp). Cada una pide sus permisos: el usuario
 * solo ve las que su rol tiene. Usan los mismos casos de uso que las pantallas, así que quedan auditadas
 * como acciones de la IA en nombre del usuario.
 */
@Injectable()
export class StaffTools {
  readonly tools: StaffTool[];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly priceLists: PriceListsService,
    private readonly invoicing: InvoicingService,
    private readonly suppliers: SupplierAccountsService,
    private readonly collections: CollectionsService,
    private readonly conversations: ConversationsService,
    private readonly aiOrders: AiOrdersService,
  ) {
    this.tools = [
      // ─────────────── Consultas ───────────────
      {
        def: tool(
          'buscar_productos',
          'Busca productos por nombre o código (SKU) y devuelve presentación, precios por lista y, si el usuario puede verlo, stock disponible (existente menos reservado) y costo. Con solo_stock_bajo=true lista lo que está por debajo del punto de reposición. Si no encuentra, probá con otra palabra o sin tildes.',
          obj({ texto: str('Palabra o código a buscar. Vacío si solo_stock_bajo.'), solo_stock_bajo: { type: 'boolean' } }),
        ),
        permissions: [PERMISSIONS.catalog.read],
        run: (i) => this.searchProducts(s(i.texto), i.solo_stock_bajo === true),
      },
      {
        def: tool(
          'resumen_ventas',
          'Ventas entre dos fechas (inclusive, por fecha de carga del pedido, sin cancelados): cantidad de pedidos, total, por canal, por etapa y productos más vendidos. "Hoy" = desde y hasta hoy; "la semana" = desde el lunes.',
          obj({ desde: str('YYYY-MM-DD'), hasta: str('YYYY-MM-DD') }),
        ),
        permissions: [PERMISSIONS.orders.read],
        run: (i) => this.salesSummary(s(i.desde), s(i.hasta)),
      },
      {
        def: tool(
          'ver_pedidos',
          'Lista pedidos (máximo 25, los más nuevos primero). Filtrá por etapa, por nombre de cliente o por número. Con número devuelve también los productos.',
          obj({
            etapa: { type: 'string', enum: ['en_curso', 'por_revisar', 'confirmado', 'en_preparacion', 'listo', 'despachado', 'entregado', 'cancelado', 'todos'] },
            cliente: str('Parte del nombre del cliente, o vacío.'),
            numero: str('Número de pedido (PED-00000012 o 12), o vacío.'),
          }),
        ),
        permissions: [PERMISSIONS.orders.read],
        run: (i) => this.listOrders(s(i.etapa) || 'en_curso', s(i.cliente), s(i.numero)),
      },
      {
        def: tool(
          'buscar_clientes',
          'Busca clientes por nombre, código o teléfono. Devuelve el id (para cargar_pedido y mensaje_a_cliente), teléfono, dirección y lista de precios.',
          obj({ texto: str('Nombre, código o teléfono.') }),
        ),
        permissions: [PERMISSIONS.crm.customerRead],
        run: (i) => this.searchCustomers(s(i.texto)),
      },
      {
        def: tool(
          'deudas_clientes',
          'Cuentas corrientes de clientes: total a cobrar, vencido y los clientes que deben (los que más deben primero). Con cliente filtra por nombre.',
          obj({ cliente: str('Parte del nombre, o vacío para todos.') }),
        ),
        permissions: [PERMISSIONS.receivables.read],
        run: (i) => this.customerDebts(s(i.cliente)),
      },
      {
        def: tool(
          'cuentas_proveedores',
          'Cuenta corriente con cada proveedor: comprado, pagado, saldo que se le debe, compras sin pagar y fecha del último pago.',
          obj({}),
        ),
        permissions: [PERMISSIONS.purchasing.read],
        run: () => this.supplierAccounts(),
      },

      // ─────────────── Acciones ───────────────
      {
        def: tool(
          'cargar_pedido',
          'Carga un pedido para un cliente (queda en borrador, con los precios de su lista). Pedí antes el cliente (usá buscar_clientes para el id) y los productos con sus códigos (buscar_productos). Para confirmarlo después, usá cambiar_etapa_pedido.',
          obj({
            cliente_id: str('id del cliente (de buscar_clientes).'),
            items: {
              type: 'array',
              items: obj({ sku: str('Código del producto.'), cantidad: { type: 'number' } }),
            },
            con_factura: { type: 'boolean', description: 'true solo si pidió que vaya con factura.' },
            notas: str('Aclaraciones (entrega, horario), o vacío.'),
          }),
        ),
        permissions: [PERMISSIONS.orders.write],
        run: (i) => this.createOrder(i),
      },
      {
        def: tool(
          'cambiar_etapa_pedido',
          'Mueve un pedido a la etapa siguiente: confirmado (reserva stock), en_preparacion, listo, despachado (descuenta stock) o entregado. Para cancelar usá cancelar_pedido.',
          obj({
            numero: str('Número de pedido.'),
            etapa: { type: 'string', enum: Object.keys(STAGE_BY_WORD) },
          }),
        ),
        permissions: [PERMISSIONS.orders.write],
        run: (i) => this.changeStage(s(i.numero), s(i.etapa)),
      },
      {
        def: tool(
          'asistente_con_cliente',
          'Pausa o reactiva el asistente de ventas en el chat de WhatsApp de un cliente (pausado no le contesta más hasta reactivarlo). Indicá el id del cliente o su teléfono.',
          obj({
            cliente_id: str('id del cliente, o vacío.'),
            telefono: str('Teléfono, o vacío.'),
            accion: { type: 'string', enum: ['pausar', 'reactivar'] },
          }),
        ),
        permissions: [PERMISSIONS.messaging.send],
        run: (i) => this.assistantForCustomer(s(i.cliente_id), s(i.telefono), s(i.accion) === 'pausar' ? 'pause' : 'resume'),
      },
      {
        def: tool(
          'mensaje_a_cliente',
          'DELICADA: prepara un mensaje de WhatsApp a un cliente (no lo manda). Solo se puede si el cliente escribió en las últimas 24 h (regla de WhatsApp). Mostrá el texto y pedí el sí.',
          obj({ cliente_id: str('id del cliente, o vacío.'), telefono: str('Teléfono, o vacío.'), texto: str('El mensaje tal cual le va a llegar.') }),
        ),
        permissions: [PERMISSIONS.messaging.send],
        prepare: (i) => this.prepareMessage(i),
        run: (i) => this.sendMessage(i),
      },
      {
        def: tool(
          'ajustar_stock',
          'DELICADA: prepara un ajuste de stock del depósito principal (no lo hace). sumar / restar una cantidad, o contado = la cantidad pasa a ser el stock. Devuelve el stock actual y cómo queda.',
          obj({
            sku: str('Código del producto.'),
            modo: { type: 'string', enum: ['sumar', 'restar', 'contado'] },
            cantidad: { type: 'number' },
            motivo: str('Por qué (rotura, conteo, vencido...).'),
          }),
        ),
        permissions: [PERMISSIONS.inventory.adjust],
        prepare: (i) => this.prepareAdjust(i),
        run: (i) => this.adjust(i),
      },
      {
        def: tool(
          'cambiar_precio',
          'DELICADA: prepara el cambio de precio de un producto en una lista (no lo hace). Devuelve el precio actual y el nuevo.',
          obj({ sku: str('Código del producto.'), lista: str('Nombre de la lista (Mayorista, Minorista...). Vacío = Mayorista.'), precio: { type: 'number' } }),
        ),
        permissions: [PERMISSIONS.catalog.write],
        prepare: (i) => this.preparePrice(i),
        run: (i) => this.setPrice(i),
      },
      {
        def: tool('facturar_pedido', 'DELICADA: prepara la factura electrónica (ARCA) de un pedido (no la emite).', obj({ numero: str('Número de pedido.') })),
        permissions: [PERMISSIONS.invoicing.issue],
        prepare: (i) => this.prepareInvoice(i),
        run: (i) => this.invoice(i),
      },
      {
        def: tool('cancelar_pedido', 'DELICADA: prepara la cancelación de un pedido (no lo cancela). Libera lo reservado.', obj({ numero: str('Número de pedido.'), motivo: str('Por qué.') })),
        permissions: [PERMISSIONS.orders.confirm],
        prepare: (i) => this.prepareCancel(i),
        run: (i) => this.cancel(i),
      },

      // ─────────────── Indicaciones para el asistente de ventas ───────────────
      {
        def: tool(
          'agregar_indicacion',
          'Guarda una indicación para el asistente de ventas de WhatsApp (cómo atender a los clientes). Escribila clara, como una instrucción al vendedor.',
          obj({ texto: str('La indicación.'), hasta: str('Último día que vale, YYYY-MM-DD, o vacío = hasta que la quiten.') }),
        ),
        permissions: [PERMISSIONS.ai.give],
        run: (i) => this.addInstruction(s(i.texto), s(i.hasta)),
      },
      {
        def: tool('ver_indicaciones', 'Indicaciones vigentes para el asistente de ventas, con su id.', obj({})),
        permissions: [PERMISSIONS.ai.give],
        run: async () => {
          const list = await this.aiOrders.instructions();
          return { summary: 'Consultó las indicaciones vigentes', data: list.map((x) => ({ id: x.id, texto: x.text, hasta: x.until, la_dio: x.createdBy })) };
        },
      },
      {
        def: tool('quitar_indicacion', 'Corta una indicación vigente (usá ver_indicaciones para el id).', obj({ id: str('id de la indicación.') })),
        permissions: [PERMISSIONS.ai.give],
        run: async (i) => {
          const list = await this.aiOrders.instructions();
          const found = list.find((x) => x.id === s(i.id));
          if (!found) throw new BusinessRuleError('No hay una indicación vigente con ese id');
          await this.aiOrders.revokeInstruction(found.id);
          return { summary: `Cortó la indicación "${found.text}"`, data: { ok: true } };
        },
      },
    ];
  }

  // ───────────────────────────── Consultas ─────────────────────────────

  private async searchProducts(text: string, onlyLow: boolean): Promise<ToolOutcome> {
    const perms = RequestContextStore.get().permissions;
    const canStock = perms.has(PERMISSIONS.inventory.read);
    const canCost = perms.has(PERMISSIONS.catalog.costRead);
    if (onlyLow && !canStock) throw new BusinessRuleError('Tu usuario no puede ver el stock');
    const stock = canStock ? await this.inventory.stock({ q: onlyLow ? undefined : text || undefined, onlyLow }) : null;
    const data = await this.uow.read(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: {
          isActive: true,
          product: { isActive: true, deletedAt: null },
          ...(stock
            ? { id: { in: stock.slice(0, 40).map((r) => r.variantId) } }
            : {
                OR: [
                  { sku: { equals: text, mode: 'insensitive' } },
                  { name: { contains: text, mode: 'insensitive' } },
                  { product: { name: { contains: text, mode: 'insensitive' } } },
                ],
              }),
        },
        take: 40,
        select: {
          id: true,
          sku: true,
          name: true,
          currentCost: true,
          product: { select: { name: true } },
          priceListItems: { where: { minQuantity: 1 }, select: { price: true, priceList: { select: { name: true } } } },
        },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      });
      const byId = new Map(stock?.map((r) => [r.variantId, r]) ?? []);
      return variants.map((v) => {
        const st = byId.get(v.id);
        return {
          sku: v.sku,
          producto: `${v.product.name} ${v.name}`,
          precios: Object.fromEntries(v.priceListItems.map((p) => [p.priceList.name, money(Number(p.price))])),
          ...(st && { disponible: st.available, reservado: st.reserved, existencia: st.onHand, stock_bajo: st.low, proximo_vencimiento: st.nextExpiry ? fmtDate(st.nextExpiry) : null }),
          ...(canCost && { costo: money(Number(v.currentCost)) }),
        };
      });
    });
    return { summary: onlyLow ? 'Consultó el stock bajo' : `Buscó productos: "${text}"`, data: data.length ? data : { nota: 'No se encontraron productos.' } };
  }

  private async salesSummary(from: string, to: string): Promise<ToolOutcome> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BusinessRuleError('Fechas en formato YYYY-MM-DD');
    const canCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    const data = await this.uow.read(async (tx) => {
      const tz = 'America/Argentina/Buenos_Aires';
      const [totals] = await tx.$queryRaw<{ orders: number; total: number; tax: number; margin: number }[]>`
        SELECT count(*)::int AS orders, coalesce(sum(total), 0)::float AS total, coalesce(sum(tax_total), 0)::float AS tax, coalesce(sum(margin_total), 0)::float AS margin
        FROM sales_orders
        WHERE status <> 'CANCELLED' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date`;
      const byChannel = await tx.$queryRaw<{ channel: string; orders: number; total: number }[]>`
        SELECT channel, count(*)::int AS orders, coalesce(sum(total), 0)::float AS total
        FROM sales_orders
        WHERE status <> 'CANCELLED' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY channel ORDER BY 3 DESC`;
      const byStatus = await tx.$queryRaw<{ status: string; orders: number }[]>`
        SELECT status::text, count(*)::int AS orders
        FROM sales_orders
        WHERE status <> 'CANCELLED' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY status`;
      const top = await tx.$queryRaw<{ product: string; quantity: number; total: number }[]>`
        SELECT p.name || ' ' || v.name AS product, sum(l.quantity)::float AS quantity, sum(l.line_total)::float AS total
        FROM sales_order_lines l
        JOIN sales_orders o ON o.id = l.order_id
        JOIN product_variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE o.status <> 'CANCELLED' AND (o.created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1 ORDER BY 3 DESC LIMIT 10`;
      return {
        desde: from,
        hasta: to,
        pedidos: totals.orders,
        total_sin_iva: money(totals.total),
        iva_facturado: money(totals.tax),
        ...(canCost && { margen: money(totals.margin) }),
        por_canal: byChannel.map((c) => ({ canal: c.channel, pedidos: c.orders, total: money(c.total) })),
        por_etapa: byStatus.map((x) => ({ etapa: orderStatusLabel(x.status), pedidos: x.orders })),
        mas_vendidos: top.map((t) => ({ producto: t.product, cantidad: t.quantity, total: money(t.total) })),
      };
    });
    return { summary: `Consultó las ventas del ${from} al ${to}`, data };
  }

  private async listOrders(stage: string, customer: string, number: string): Promise<ToolOutcome> {
    const statusFor: Record<string, string[] | null> = {
      en_curso: ACTIVE_STATUSES,
      por_revisar: ['PENDING_REVIEW', 'DRAFT'],
      confirmado: ['CONFIRMED'],
      en_preparacion: ['PICKING'],
      listo: ['READY'],
      despachado: ['DISPATCHED'],
      entregado: ['DELIVERED', 'INVOICED'],
      cancelado: ['CANCELLED'],
      todos: null,
    };
    const statuses = number ? null : (statusFor[stage] ?? ACTIVE_STATUSES);
    const data = await this.uow.read(async (tx) => {
      const ids = number ? (await findOrder(tx, number)).map((o) => o.id) : null;
      const rows = await tx.salesOrder.findMany({
        where: {
          ...(ids && { id: { in: ids } }),
          ...(statuses && { status: { in: statuses as never[] } }),
          ...(customer && {
            customer: { OR: [{ legalName: { contains: customer, mode: 'insensitive' } }, { tradeName: { contains: customer, mode: 'insensitive' } }] },
          }),
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          number: true,
          status: true,
          channel: true,
          createdAt: true,
          total: true,
          taxTotal: true,
          withInvoice: true,
          notes: true,
          customer: { select: { legalName: true, tradeName: true } },
          lines: number ? { select: { quantity: true, lineTotal: true, variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } } : false,
        },
      });
      return rows.map((o) => ({
        numero: o.number,
        fecha: fmtDate(o.createdAt),
        cliente: o.customer.tradeName ?? o.customer.legalName,
        etapa: orderStatusLabel(o.status),
        canal: o.channel,
        total: money(Number(o.total) + Number(o.taxTotal)),
        con_factura: o.withInvoice,
        ...(number && {
          notas: o.notes,
          productos: (o.lines as unknown as { quantity: unknown; lineTotal: unknown; variant: { sku: string; name: string; product: { name: string } } }[]).map(
            (l) => `${Number(l.quantity)} × [${l.variant.sku}] ${l.variant.product.name} ${l.variant.name} = ${money(Number(l.lineTotal))}`,
          ),
        }),
      }));
    });
    const what = number ? `el pedido ${number}` : `pedidos (${stage.replace('_', ' ')}${customer ? `, cliente "${customer}"` : ''})`;
    return { summary: `Consultó ${what}`, data: data.length ? data : { nota: 'No hay pedidos con ese filtro.' } };
  }

  private async searchCustomers(text: string): Promise<ToolOutcome> {
    if (text.length < 2) throw new BusinessRuleError('Pasame al menos dos letras del nombre');
    const digits = text.replace(/\D/g, '');
    const data = await this.uow.read(async (tx) => {
      const rows = await tx.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { legalName: { contains: text, mode: 'insensitive' } },
            { tradeName: { contains: text, mode: 'insensitive' } },
            { code: { equals: text, mode: 'insensitive' } },
            ...(digits.length >= 6 ? [{ phone: { contains: digits.slice(-8) } }] : []),
          ],
        },
        take: 10,
        select: {
          id: true,
          code: true,
          legalName: true,
          tradeName: true,
          phone: true,
          status: true,
          priceList: { select: { name: true } },
          addresses: { orderBy: { isDefault: 'desc' }, take: 1, select: { street: true, city: true } },
        },
      });
      return rows.map((c) => ({
        id: c.id,
        codigo: c.code,
        nombre: c.tradeName ?? c.legalName,
        razon_social: c.legalName,
        telefono: c.phone,
        direccion: c.addresses[0] ? `${c.addresses[0].street}, ${c.addresses[0].city}` : null,
        lista: c.priceList?.name ?? null,
        estado: c.status,
      }));
    });
    return { summary: `Buscó clientes: "${text}"`, data: data.length ? data : { nota: 'No hay clientes con ese nombre.' } };
  }

  private async customerDebts(name: string): Promise<ToolOutcome> {
    const sum = await this.collections.summary();
    const q = name.toLowerCase();
    const customers = sum.customers
      .filter((c) => c.balance > 0.5 && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 20)
      .map((c) => ({
        cliente: c.name,
        debe: money(c.balance),
        vencido: money(c.overdue),
        dias_de_atraso: c.maxDaysOverdue,
        ultimo_pago: c.lastPaymentAt ? fmtDate(new Date(c.lastPaymentAt)) : null,
      }));
    return {
      summary: name ? `Consultó la deuda de "${name}"` : 'Consultó las deudas de clientes',
      data: { total_a_cobrar: money(sum.receivable), vencido: money(sum.overdue), clientes: customers },
    };
  }

  private async supplierAccounts(): Promise<ToolOutcome> {
    const rows = await this.suppliers.list();
    return {
      summary: 'Consultó las cuentas con proveedores',
      data: rows.map((r) => ({
        proveedor: r.name,
        comprado: money(r.purchased),
        pagado: money(r.paid),
        se_le_debe: money(r.balance),
        compras_sin_pagar: r.unpaidPurchases,
        ultimo_pago: r.lastPaymentAt ? fmtDate(new Date(r.lastPaymentAt)) : null,
      })),
    };
  }

  // ───────────────────────────── Acciones ─────────────────────────────

  private async createOrder(i: Input): Promise<ToolOutcome> {
    const items = (Array.isArray(i.items) ? i.items : []) as { sku?: unknown; cantidad?: unknown }[];
    if (!items.length) throw new BusinessRuleError('El pedido no tiene productos');
    const customerId = s(i.cliente_id);
    const { lines, branchId, warehouseId, customerName } = await this.uow.read(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { legalName: true, tradeName: true } });
      if (!customer) throw new BusinessRuleError('No encontré ese cliente: buscalo con buscar_clientes');
      const lines = [];
      for (const it of items) {
        const v = await variantBySku(tx, s(it.sku));
        const qty = n(it.cantidad);
        if (!(qty > 0)) throw new BusinessRuleError(`Cantidad inválida para ${s(it.sku)}`);
        lines.push({ variantId: v.id, quantity: qty, discountPct: 0 });
      }
      const wh = await mainWarehouse(tx);
      return { lines, ...wh, customerName: customer.tradeName ?? customer.legalName };
    });
    const r = await this.orders.create({
      customerId,
      branchId,
      warehouseId,
      channel: 'copilot',
      withInvoice: i.con_factura === true,
      notes: [s(i.notas), 'Cargado por WhatsApp (órdenes a la IA).'].filter(Boolean).join('\n'),
      lines,
    });
    return {
      summary: `Cargó el pedido ${r.number} para ${customerName} por ${money(r.total + r.taxTotal)}`,
      data: { numero: r.number, etapa: 'borrador', total: money(r.total), iva: money(r.taxTotal), a_cobrar: money(r.total + r.taxTotal) },
    };
  }

  private async changeStage(number: string, word: string): Promise<ToolOutcome> {
    const to = STAGE_BY_WORD[word];
    if (!to) throw new BusinessRuleError('Etapa inválida');
    if (to === 'CONFIRMED' && !RequestContextStore.get().permissions.has(PERMISSIONS.orders.confirm)) throw new BusinessRuleError('Tu usuario no puede confirmar pedidos');
    const order = await this.uow.read(async (tx) => one(await findOrder(tx, number), number));
    const r = to === 'CONFIRMED' ? await this.orders.confirm(order.id) : await this.orders.transition(order.id, { to });
    const shortages = 'shortages' in r && Array.isArray(r.shortages) && r.shortages.length ? r.shortages : null;
    const opened = 'openedPacks' in r && r.openedPacks.length ? r.openedPacks.map((p) => `${p.packs} × ${p.description} (${p.sku})`).join(', ') : null;
    return {
      summary: `Pasó el pedido ${order.number} a ${orderStatusLabel(to)}`,
      data: {
        numero: order.number,
        etapa: orderStatusLabel(to),
        ...(opened && { cajas_abiertas: `Para los sueltos se abrieron: ${opened}` }),
        ...(shortages && { aviso: 'Faltó stock de algunos productos: quedaron en la nota de pedido al proveedor.' }),
      },
    };
  }

  private async assistantForCustomer(customerId: string, phone: string, action: 'pause' | 'resume'): Promise<ToolOutcome> {
    const conv = await this.uow.read((tx) => findConversation(tx, customerId, phone));
    await this.uow.run(async (tx, scope) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: action === 'pause' ? { assistantHandoff: MANUAL_PAUSE, assistantHandoffAt: new Date() } : { assistantHandoff: null, assistantHandoffAt: null, assistantPausedUntil: null },
      });
      scope.auditLog({ action: `conversation.assistant_${action}`, entityType: 'conversation', entityId: conv.id, after: { by: RequestContextStore.get().actor } });
    });
    const who = conv.name;
    return {
      summary: `${action === 'pause' ? 'Pausó' : 'Reactivó'} el asistente de ventas con ${who}`,
      data: { ok: true, chat: who, asistente: action === 'pause' ? 'pausado' : 'activo' },
    };
  }

  private async prepareMessage(i: Input) {
    const text = s(i.texto);
    if (!text) throw new BusinessRuleError('Falta el texto del mensaje');
    const conv = await this.uow.read((tx) => findConversation(tx, s(i.cliente_id), s(i.telefono)));
    if (!conv.windowOpen) {
      throw new BusinessRuleError(`${conv.name} no escribió en las últimas 24 h: WhatsApp no deja mandarle un mensaje libre hasta que vuelva a escribir`);
    }
    return { summary: `Mandarle a ${conv.name} por WhatsApp: "${text}"`, input: { conversationId: conv.id, name: conv.name, texto: text } };
  }

  private async sendMessage(i: Input): Promise<ToolOutcome> {
    await this.conversations.send(s(i.conversationId), s(i.texto));
    return { summary: `Le mandó un mensaje a ${s(i.name)}`, data: { enviado: true } };
  }

  private async prepareAdjust(i: Input) {
    const mode = s(i.modo);
    const qty = n(i.cantidad);
    const reason = s(i.motivo);
    if (!['sumar', 'restar', 'contado'].includes(mode)) throw new BusinessRuleError('Modo inválido');
    if (!(qty >= 0) || (mode !== 'contado' && qty === 0)) throw new BusinessRuleError('Cantidad inválida');
    if (reason.length < 3) throw new BusinessRuleError('Falta el motivo del ajuste');
    return this.uow.read(async (tx) => {
      const v = await variantBySku(tx, s(i.sku));
      const { warehouseId } = await mainWarehouse(tx);
      const items = await tx.stockItem.findMany({
        where: { warehouseId, variantId: v.id },
        select: { lotId: true, onHand: true, lot: { select: { expiresAt: true } } },
      });
      const withStock = items.filter((x) => Number(x.onHand) !== 0);
      const current = items.reduce((t, x) => t + Number(x.onHand), 0);
      let lotId: string | null = null;
      if (withStock.length === 1) lotId = withStock[0].lotId;
      else if (withStock.length > 1) {
        if (mode !== 'restar') throw new BusinessRuleError('Ese producto tiene stock en varios vencimientos: ese ajuste hacelo desde Inventario, eligiendo el lote');
        // Para restar se toma el que vence primero (FEFO), si alcanza.
        const fefo = [...withStock].sort((a, b) => (a.lot?.expiresAt?.getTime() ?? Infinity) - (b.lot?.expiresAt?.getTime() ?? Infinity))[0];
        if (Number(fefo.onHand) < qty) throw new BusinessRuleError('Ese producto tiene stock en varios vencimientos y el primero no alcanza: hacelo desde Inventario');
        lotId = fefo.lotId;
      }
      const after = mode === 'contado' ? qty : mode === 'sumar' ? current + qty : current - qty;
      if (after < 0) throw new BusinessRuleError(`Hay ${current} y no se pueden restar ${qty}`);
      const desc = `[${v.sku}] ${v.product.name} ${v.name}`;
      return {
        summary: `Ajustar stock de ${desc}: de ${current} a ${after} (${mode === 'contado' ? 'conteo' : `${mode} ${qty}`}). Motivo: ${reason}`,
        input: { warehouseId, variantId: v.id, lotId, mode: mode === 'contado' ? 'count' : 'delta', quantity: mode === 'restar' ? -qty : qty, reason, desc, after },
      };
    });
  }

  private async adjust(i: Input): Promise<ToolOutcome> {
    const r = await this.inventory.adjust({
      warehouseId: s(i.warehouseId),
      variantId: s(i.variantId),
      lotId: (i.lotId as string | null) ?? null,
      type: 'ADJUSTMENT',
      mode: i.mode === 'count' ? 'count' : 'delta',
      quantity: n(i.quantity),
      reason: `${s(i.reason)} (por WhatsApp)`,
    });
    return { summary: `Ajustó el stock de ${s(i.desc)}: quedó en ${n(i.after)}`, data: { ok: true, movimiento: r.delta } };
  }

  private async preparePrice(i: Input) {
    const price = n(i.precio);
    if (!(price > 0)) throw new BusinessRuleError('Precio inválido');
    return this.uow.read(async (tx) => {
      const v = await variantBySku(tx, s(i.sku));
      const listName = s(i.lista) || 'Mayorista';
      const list = await tx.priceList.findFirst({ where: { name: { equals: listName, mode: 'insensitive' } }, select: { id: true, name: true } });
      if (!list) {
        const names = (await tx.priceList.findMany({ select: { name: true } })).map((l) => l.name).join(', ');
        throw new BusinessRuleError(`No existe la lista "${listName}". Las listas son: ${names}`);
      }
      const current = await tx.priceListItem.findFirst({ where: { priceListId: list.id, variantId: v.id, minQuantity: 1 }, select: { price: true } });
      const desc = `[${v.sku}] ${v.product.name} ${v.name}`;
      return {
        summary: `Cambiar el precio de ${desc} en la lista ${list.name}: de ${current ? money(Number(current.price)) : 'sin precio'} a ${money(price)}`,
        input: { priceListId: list.id, list: list.name, variantId: v.id, price, desc },
      };
    });
  }

  private async setPrice(i: Input): Promise<ToolOutcome> {
    const r = await this.priceLists.upsertItems(s(i.priceListId), { items: [{ variantId: s(i.variantId), price: n(i.price), minQuantity: 1 }] });
    return { summary: `Cambió el precio de ${s(i.desc)} en ${s(i.list)} a ${money(n(i.price))}`, data: { ok: true, avisos: r.warnings } };
  }

  private async prepareInvoice(i: Input) {
    return this.uow.read(async (tx) => {
      const order = one(await findOrder(tx, s(i.numero)), s(i.numero));
      if (order.status === 'CANCELLED') throw new BusinessRuleError('El pedido está cancelado');
      const invoiced = await tx.invoice.findFirst({ where: { orderId: order.id, status: { not: 'CANCELLED' } }, select: { id: true } });
      if (invoiced) throw new BusinessRuleError(`El pedido ${order.number} ya tiene factura`);
      return {
        summary: `Facturar en ARCA el pedido ${order.number} de ${order.customer} por ${money(order.toCharge)}`,
        input: { orderId: order.id, number: order.number },
      };
    });
  }

  private async invoice(i: Input): Promise<ToolOutcome> {
    const r = (await this.invoicing.issueForOrder(s(i.orderId))) as { number?: string; cae?: string };
    return { summary: `Facturó el pedido ${s(i.number)}${r?.number ? ` (factura ${r.number})` : ''}`, data: { ok: true, factura: r?.number ?? null, cae: r?.cae ?? null } };
  }

  private async prepareCancel(i: Input) {
    const reason = s(i.motivo);
    return this.uow.read(async (tx) => {
      const order = one(await findOrder(tx, s(i.numero)), s(i.numero));
      if (['CANCELLED', 'DELIVERED', 'INVOICED', 'DISPATCHED'].includes(order.status)) {
        throw new BusinessRuleError(`El pedido ${order.number} está ${orderStatusLabel(order.status)}: no se puede cancelar`);
      }
      return {
        summary: `Cancelar el pedido ${order.number} de ${order.customer} (${money(order.toCharge)}, ${orderStatusLabel(order.status)})${reason ? `. Motivo: ${reason}` : ''}`,
        input: { orderId: order.id, number: order.number, reason },
      };
    });
  }

  private async cancel(i: Input): Promise<ToolOutcome> {
    await this.orders.transition(s(i.orderId), { to: 'CANCELLED', reason: s(i.reason) ? `${s(i.reason)} (por WhatsApp)` : 'Cancelado por WhatsApp' });
    return { summary: `Canceló el pedido ${s(i.number)}`, data: { ok: true } };
  }

  private async addInstruction(text: string, until: string): Promise<ToolOutcome> {
    if (text.length < 3) throw new BusinessRuleError('Falta la indicación');
    if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < argentinaDate(new Date()))) throw new BusinessRuleError('La fecha de fin tiene que ser hoy o después (YYYY-MM-DD)');
    const r = await this.aiOrders.addInstruction({ text: text.slice(0, 500), until: until || null }, 'whatsapp');
    return { summary: `Guardó la indicación "${text}"${until ? ` hasta el ${until.split('-').reverse().slice(0, 2).join('/')}` : ''}`, data: { ok: true, id: r.id } };
  }
}

// ───────────────────────────── Búsquedas ─────────────────────────────

async function variantBySku(tx: Tx, sku: string) {
  if (!sku) throw new BusinessRuleError('Falta el código del producto');
  const v = await tx.productVariant.findFirst({
    where: { sku: { equals: sku, mode: 'insensitive' }, isActive: true },
    select: { id: true, sku: true, name: true, product: { select: { name: true } } },
  });
  if (!v) throw new BusinessRuleError(`No existe el producto con código ${sku}: buscalo con buscar_productos`);
  return v;
}

async function mainWarehouse(tx: Tx) {
  const branch =
    (await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } })) ??
    (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }));
  const wh = branch && (await tx.warehouse.findFirst({ where: { branchId: branch.id, isActive: true }, orderBy: { code: 'asc' }, select: { id: true } }));
  if (!branch || !wh) throw new BusinessRuleError('La empresa no tiene depósito configurado');
  return { branchId: branch.id, warehouseId: wh.id };
}

/** Por número completo (PED-00000012) o solo los dígitos (12). */
async function findOrder(tx: Tx, number: string) {
  const raw = number.trim().toUpperCase();
  if (!raw) throw new BusinessRuleError('Falta el número de pedido');
  const digits = raw.replace(/\D/g, '');
  const rows = await tx.salesOrder.findMany({
    where: { OR: [{ number: raw }, ...(digits ? [{ number: { endsWith: digits } }] : [])] },
    select: { id: true, number: true, status: true, total: true, taxTotal: true, customer: { select: { legalName: true, tradeName: true } } },
    take: 20,
  });
  const exact = rows.filter((r) => r.number === raw || (digits && Number(r.number.replace(/\D/g, '')) === Number(digits)));
  return exact.map((r) => ({ id: r.id, number: r.number, status: r.status as string, customer: r.customer.tradeName ?? r.customer.legalName, toCharge: Number(r.total) + Number(r.taxTotal) }));
}

function one<T>(rows: T[], number: string): T {
  if (!rows.length) throw new BusinessRuleError(`No encontré el pedido ${number}`);
  if (rows.length > 1) throw new BusinessRuleError(`Hay más de un pedido con ${number}: pasame el número completo`);
  return rows[0];
}

/** El chat de WhatsApp de un cliente (por id o por teléfono). */
async function findConversation(tx: Tx, customerId: string, phone: string) {
  const select = { id: true, waContactId: true, contactName: true, windowExpiresAt: true, isInternal: true, customer: { select: { legalName: true, tradeName: true } } } as const;
  let conv = null;
  if (customerId) conv = await tx.conversation.findFirst({ where: { customerId }, orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } }, select });
  if (!conv && phone) {
    const d = phone.replace(/\D/g, '');
    if (d.length < 8) throw new BusinessRuleError('El teléfono tiene que tener la característica');
    const candidates = await tx.conversation.findMany({ where: { waContactId: { endsWith: d.slice(-8) } }, select });
    conv = candidates.find((c) => samePhone(c.waContactId, d) || c.waContactId.endsWith(d)) ?? null;
  }
  if (!conv) throw new BusinessRuleError('No encontré un chat de WhatsApp con ese cliente (tiene que haber escrito alguna vez)');
  if (conv.isInternal) throw new BusinessRuleError('Ese chat es de un usuario del sistema, no de un cliente');
  return {
    id: conv.id,
    name: conv.customer?.tradeName ?? conv.customer?.legalName ?? conv.contactName ?? `+${conv.waContactId}`,
    windowOpen: !!conv.windowExpiresAt && conv.windowExpiresAt > new Date(),
  };
}
