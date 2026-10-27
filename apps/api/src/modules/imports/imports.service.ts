import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { ImportOptions, ImportResult, ImportRowError } from '@spiceos/contracts';
import ExcelJS from 'exceljs';
import { DomainEvent } from '../../shared/domain/domain-event';
import { DomainError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork, UowScope } from '../../shared/unit-of-work';
import { PriceListsService } from '../catalog/application/price-lists.service';
import { ProductsService } from '../catalog/application/products.service';
import { slugify } from '../catalog/domain/pricing';
import { ContactsService } from '../crm/application/contacts.service';
import { CreateCustomerCommand } from '../crm/application/commands/create-customer.command';
import { UpdateCustomerCommand } from '../crm/application/commands/update-customer.command';
import { InventoryFacade } from '../inventory/inventory.facade';
import { CUSTOMER_COLUMNS, CUSTOMER_TEMPLATE_HEADERS, mapCustomerRow, type CustomerRowResult } from './customer-import';
import { PRODUCT_COLUMNS, PRODUCT_PREFIX_FIELDS, PRODUCT_TEMPLATE_HEADERS, mapProductRow, type ProductRowResult } from './product-import';
import { normalizeHeader, parseSpreadsheet } from './spreadsheet';
import { STOCK_COLUMNS, STOCK_TEMPLATE_HEADERS, isBlankStockRow, mapStockRow, type StockRowResult } from './stock-import';

type UploadedFile = { buffer: Buffer; originalname: string };
const PREVIEW_ROWS = 20;

/**
 * Importación de clientes, productos y stock inicial desde planillas.
 * Con dryRun no se escribe nada y se devuelven los errores fila por fila; sin dryRun se importan las filas válidas.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly commands: CommandBus,
    private readonly contacts: ContactsService,
    private readonly products: ProductsService,
    private readonly priceLists: PriceListsService,
    private readonly ledger: InventoryFacade,
  ) {}

  // ---------- Clientes ----------
  async importCustomers(file: UploadedFile, options: ImportOptions): Promise<ImportResult> {
    const sheet = await parseSpreadsheet(file, CUSTOMER_COLUMNS);
    const lookups = await this.uow.read(async (tx) => {
      const [lists, members] = await Promise.all([
        tx.priceList.findMany({ select: { id: true, name: true } }),
        tx.membership.findMany({ where: { isActive: true }, select: { user: { select: { id: true, email: true, fullName: true } } } }),
      ]);
      const users = new Map<string, string>();
      for (const { user } of members) {
        users.set(user.email.toLowerCase(), user.id);
        users.set(normalizeHeader(user.fullName), user.id);
      }
      return { priceLists: new Map(lists.map((l) => [normalizeHeader(l.name), l.id])), users };
    });

    const mapped = sheet.rows.map((r) => mapCustomerRow(r, lookups));
    const seen = new Map<string, number>();
    for (const m of mapped) {
      const taxId = m.input?.taxId;
      if (!taxId) continue;
      if (seen.has(taxId)) {
        m.errors.push({ row: m.row, field: 'taxId', message: `CUIT repetido en la planilla (ya está en la fila ${seen.get(taxId)})` });
        m.input = undefined;
      } else seen.set(taxId, m.row);
    }

    const existing = await this.uow.read(async (tx) => {
      const taxIds = mapped.flatMap((m) => (m.input?.taxId ? [m.input.taxId] : []));
      const rows = taxIds.length
        ? await tx.customer.findMany({ where: { taxId: { in: taxIds }, deletedAt: null }, select: { id: true, taxId: true, version: true } })
        : [];
      return new Map(rows.map((r) => [r.taxId!, r]));
    });

    const result = this.emptyResult(options.dryRun, sheet.rows.length, sheet.unknownColumns);
    const valid = mapped.filter((m) => m.input);
    result.valid = valid.length;
    result.errors = mapped.flatMap((m) => m.errors);
    result.preview = valid.slice(0, PREVIEW_ROWS).map((m) => ({
      row: m.row,
      action: existing.has(m.input!.taxId ?? '') ? options.onDuplicate : 'create',
      ...m.input,
    }));

    for (const m of valid) {
      const match = m.input!.taxId ? existing.get(m.input!.taxId) : undefined;
      if (match && options.onDuplicate === 'skip') {
        result.skipped++;
        continue;
      }
      if (options.dryRun) {
        match ? result.updated++ : result.created++;
        continue;
      }
      try {
        await this.writeCustomer(m, match);
        match ? result.updated++ : result.created++;
      } catch (e) {
        result.errors.push(this.rowError(m.row, e));
      }
    }
    return result;
  }

  private async writeCustomer(m: CustomerRowResult, match?: { id: string; version: number }) {
    const input = m.input!;
    if (match) {
      // Solo se pisan los campos que vinieron en la planilla.
      const changes = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'source' && !(k === 'tags' && !(v as string[]).length)));
      await this.commands.execute(new UpdateCustomerCommand(match.id, { ...changes, version: match.version }));
      return;
    }
    const { id } = await this.commands.execute(new CreateCustomerCommand(input));
    if (m.contact) await this.contacts.create(id, { ...m.contact, isPrimary: true });
  }

  // ---------- Productos ----------
  async importProducts(file: UploadedFile, options: ImportOptions): Promise<ImportResult> {
    const sheet = await parseSpreadsheet(file, PRODUCT_COLUMNS, PRODUCT_PREFIX_FIELDS);
    const mapped = sheet.rows.map((r) => mapProductRow(r, sheet.extraColumns));

    const { lists, defaultListId, skus, codes } = await this.uow.read(async (tx) => {
      const allLists = await tx.priceList.findMany({ select: { id: true, name: true, isDefault: true } });
      const skuList = mapped.flatMap((m) => (m.variant ? [m.variant.sku] : []));
      const codeList = [...new Set(mapped.flatMap((m) => (m.productCode ? [m.productCode] : [])))];
      const [variantRows, productRows] = await Promise.all([
        tx.productVariant.findMany({ where: { sku: { in: skuList } }, select: { sku: true, product: { select: { code: true } } } }),
        tx.product.findMany({ where: { code: { in: codeList } }, select: { code: true } }),
      ]);
      return {
        lists: new Map(allLists.map((l) => [normalizeHeader(l.name), l.id])),
        defaultListId: allLists.find((l) => l.isDefault)?.id,
        skus: new Map(variantRows.map((v) => [v.sku, v.product.code])),
        codes: new Set(productRows.map((p) => p.code)),
      };
    });

    // Validaciones que dependen de la base o de otras filas.
    const seenSku = new Map<string, number>();
    for (const m of mapped) {
      for (const p of m.prices) {
        const id = p.list === 'default' ? defaultListId : lists.get(normalizeHeader(p.list));
        if (!id) m.errors.push({ row: m.row, field: 'price', message: p.list === 'default' ? 'No hay lista de precios por defecto para la columna Precio' : `No existe la lista de precios "${p.list}"` });
      }
      if (!m.variant) continue;
      const sku = m.variant.sku;
      if (seenSku.has(sku)) m.errors.push({ row: m.row, field: 'sku', message: `SKU repetido en la planilla (fila ${seenSku.get(sku)})` });
      else seenSku.set(sku, m.row);
      const owner = skus.get(sku);
      if (owner && owner !== m.productCode) m.errors.push({ row: m.row, field: 'sku', message: `El SKU ${sku} ya pertenece al producto ${owner}` });
      if (m.errors.length) m.variant = undefined;
    }

    const result = this.emptyResult(options.dryRun, sheet.rows.length, sheet.unknownColumns);
    const valid = mapped.filter((m) => m.variant);
    result.valid = valid.length;
    result.errors = mapped.flatMap((m) => m.errors);
    result.preview = valid.slice(0, PREVIEW_ROWS).map((m) => ({
      row: m.row,
      action: skus.has(m.variant!.sku) ? options.onDuplicate : codes.has(m.productCode!) ? 'add_variant' : 'create',
      productCode: m.productCode,
      product: m.productName,
      ...m.variant,
      prices: m.prices,
    }));

    const groups = new Map<string, ProductRowResult[]>();
    for (const m of valid) groups.set(m.productCode!, [...(groups.get(m.productCode!) ?? []), m]);

    for (const [code, rows] of groups) {
      const existingRows = rows.filter((r) => skus.has(r.variant!.sku));
      if (options.onDuplicate === 'skip') result.skipped += existingRows.length;
      const toWrite = options.onDuplicate === 'skip' ? rows.filter((r) => !skus.has(r.variant!.sku)) : rows;
      if (!toWrite.length) continue;
      if (options.dryRun) {
        for (const r of toWrite) skus.has(r.variant!.sku) ? result.updated++ : result.created++;
        continue;
      }
      try {
        await this.uow.run((tx, scope) => this.writeProductGroup(tx, scope, code, toWrite, { lists, defaultListId }));
        for (const r of toWrite) skus.has(r.variant!.sku) ? result.updated++ : result.created++;
      } catch (e) {
        // El producto entero se revierte: todas sus filas quedan con el mismo error.
        for (const r of toWrite) result.errors.push(this.rowError(r.row, e));
      }
    }
    return result;
  }

  private async writeProductGroup(
    tx: Tx,
    scope: UowScope,
    code: string,
    rows: ProductRowResult[],
    ctxLists: { lists: Map<string, string>; defaultListId?: string },
  ) {
    const ctx = RequestContextStore.get();
    const first = rows[0];
    let categoryId: string | undefined;
    if (first.category) {
      const slug = slugify(first.category);
      categoryId =
        (await tx.category.findFirst({ where: { slug }, select: { id: true } }))?.id ??
        (await tx.category.create({ data: { tenantId: ctx.tenantId, name: first.category, slug } })).id;
    }

    let product = await tx.product.findFirst({ where: { code }, select: { id: true } });
    if (!product) {
      product = await tx.product.create({
        data: {
          tenantId: ctx.tenantId, code, name: first.productName!, categoryId, origin: first.origin, shelfLifeDays: first.shelfLifeDays,
        },
        select: { id: true },
      });
      scope.auditLog({ action: 'product.import', entityType: 'product', entityId: product.id, after: { code, name: first.productName } });
    } else {
      await tx.product.update({
        where: { id: product.id },
        data: { name: first.productName, ...(categoryId && { categoryId }), ...(first.origin && { origin: first.origin }), ...(first.shelfLifeDays && { shelfLifeDays: first.shelfLifeDays }) },
      });
    }

    const pricesByList = new Map<string, { variantId: string; price: number; minQuantity: number }[]>();
    for (const r of rows) {
      const v = r.variant!;
      const existing = await tx.productVariant.findFirst({ where: { sku: v.sku }, select: { id: true } });
      let variantId: string;
      if (existing) {
        variantId = existing.id;
        await tx.productVariant.update({
          where: { id: variantId },
          data: { name: v.name, netWeightKg: v.netWeightKg ?? null, unit: v.unit, ...(v.gtin && { gtin: v.gtin }), ...(v.minMarginPct && { minMarginPct: v.minMarginPct }) },
        });
        if (v.cost > 0) await this.products.applyCost(tx, scope, variantId, v.cost, 'import');
      } else {
        variantId = (await this.products.insertVariant(tx, scope, product.id, v, 'import')).id;
      }
      for (const p of r.prices) {
        const listId = p.list === 'default' ? ctxLists.defaultListId! : ctxLists.lists.get(normalizeHeader(p.list))!;
        pricesByList.set(listId, [...(pricesByList.get(listId) ?? []), { variantId, price: p.price, minQuantity: 1 }]);
      }
    }
    for (const [listId, items] of pricesByList) await this.priceLists.writeItems(tx, scope, listId, items, 'import');
    scope.emit(
      new DomainEvent('product.updated', 'product', product.id, {
        productId: product.id, source: 'import', skus: rows.map((r) => r.variant!.sku),
      }),
    );
  }

  // ---------- Stock inicial ----------
  /**
   * Cada fila es un saldo contado. Si ese saldo (depósito, presentación, lote) ya tiene stock,
   * "skip" lo deja como está y "update" lo lleva a la cantidad de la planilla con un ajuste.
   */
  async importStock(file: UploadedFile, options: ImportOptions): Promise<ImportResult> {
    const sheet = await parseSpreadsheet(file, STOCK_COLUMNS);
    const filled = sheet.rows.filter((r) => !isBlankStockRow(r));
    const mapped = filled.map(mapStockRow);

    const { variants, warehouses, current } = await this.uow.read(async (tx) => {
      const skuList = [...new Set(mapped.flatMap((m) => (m.sku ? [m.sku] : [])))];
      const [variantRows, warehouseRows] = await Promise.all([
        tx.productVariant.findMany({ where: { sku: { in: skuList } }, select: { id: true, sku: true, currentCost: true } }),
        tx.warehouse.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
      ]);
      const items = await tx.stockItem.findMany({
        where: { variantId: { in: variantRows.map((v) => v.id) }, onHand: { gt: 0 } },
        select: { warehouseId: true, variantId: true, onHand: true, lot: { select: { code: true } } },
      });
      return {
        variants: new Map(variantRows.map((v) => [v.sku, { id: v.id, cost: Number(v.currentCost) }])),
        warehouses: new Map(warehouseRows.map((w) => [w.code.toUpperCase(), w.id])),
        current: new Map(items.map((i) => [`${i.warehouseId}|${i.variantId}|${i.lot?.code ?? ''}`, Number(i.onHand)])),
      };
    });
    const onlyWarehouse = warehouses.size === 1 ? [...warehouses.values()][0] : undefined;

    const seen = new Map<string, number>();
    const valid: (StockRowResult & { variantId: string; warehouseId: string; key: string; unitCost: number })[] = [];
    for (const m of mapped) {
      const v = m.sku ? variants.get(m.sku) : undefined;
      if (m.sku && !v) m.errors.push({ row: m.row, field: 'sku', message: `No existe la presentación con SKU ${m.sku}` });
      const warehouseId = m.warehouse ? warehouses.get(m.warehouse) : onlyWarehouse;
      if (!warehouseId) {
        m.errors.push({ row: m.row, field: 'warehouse', message: m.warehouse ? `No existe el depósito ${m.warehouse}` : 'Indicá el depósito: hay más de uno' });
      }
      if (m.errors.length || !v || !warehouseId) continue;
      const key = `${warehouseId}|${v.id}|${m.lot ?? ''}`;
      if (seen.has(key)) {
        m.errors.push({ row: m.row, field: 'sku', message: `Saldo repetido en la planilla (fila ${seen.get(key)})` });
        continue;
      }
      seen.set(key, m.row);
      valid.push({ ...m, variantId: v.id, warehouseId, key, unitCost: m.cost ?? v.cost });
    }

    const result = this.emptyResult(options.dryRun, filled.length, sheet.unknownColumns);
    result.valid = valid.length;
    result.errors = mapped.flatMap((m) => m.errors);
    result.preview = valid.slice(0, PREVIEW_ROWS).map((m) => ({
      row: m.row,
      action: current.has(m.key) ? options.onDuplicate : 'create',
      sku: m.sku,
      quantity: m.quantity,
      current: current.get(m.key) ?? 0,
      lot: m.lot,
      expiresAt: m.expiresAt?.toISOString().slice(0, 10),
    }));

    for (const m of valid) {
      const existing = current.get(m.key);
      if (existing !== undefined && options.onDuplicate === 'skip') {
        result.skipped++;
        continue;
      }
      const delta = m.quantity! - (existing ?? 0);
      if (delta === 0 || options.dryRun) {
        existing === undefined ? result.created++ : result.updated++;
        continue;
      }
      try {
        await this.uow.run(async (tx, scope) => {
          const lot = m.lot ? await this.ledger.lot(tx, m.variantId, m.lot, m.expiresAt) : null;
          // Se recalcula contra la base por si el saldo cambió desde la revisión.
          const item = await tx.stockItem.findFirst({ where: { warehouseId: m.warehouseId, variantId: m.variantId, lotId: lot?.id ?? null } });
          const change = m.quantity! - Number(item?.onHand ?? 0);
          if (change !== 0) {
            await this.ledger.post(tx, {
              warehouseId: m.warehouseId,
              variantId: m.variantId,
              lotId: lot?.id ?? null,
              type: 'ADJUSTMENT',
              quantity: change,
              unitCost: m.unitCost,
              referenceType: 'import',
              reason: existing === undefined ? 'Stock inicial (importación)' : 'Conteo (importación)',
            });
          }
          scope.auditLog({ action: 'stock.import', entityType: 'variant', entityId: m.variantId, after: { warehouseId: m.warehouseId, lot: m.lot, quantity: m.quantity } });
        });
        existing === undefined ? result.created++ : result.updated++;
      } catch (e) {
        result.errors.push(this.rowError(m.row, e));
      }
    }
    return result;
  }

  // ---------- Plantillas ----------
  async template(kind: 'customers' | 'products' | 'stock'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet({ customers: 'Clientes', products: 'Productos', stock: 'Stock' }[kind]);
    const headers = { customers: CUSTOMER_TEMPLATE_HEADERS, products: PRODUCT_TEMPLATE_HEADERS, stock: STOCK_TEMPLATE_HEADERS }[kind];
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 18));
    if (kind === 'customers') {
      sheet.addRow(['Ejemplo SRL', 'El Ejemplo', '30-71234567-1', 'RI', 'Restaurante', '011 15-4444-5555', 'compras@ejemplo.com', 30, 500000, 'Mayorista', '', 'Juana Pérez', 'Compras', 'gastronomía']);
    } else if (kind === 'stock') {
      await this.fillStockTemplate(sheet);
    } else {
      sheet.addRow(['PIM-AHU', 'Pimentón ahumado', '1 kg', 'PIM-AHU-1KG', 1, 'UN', '', 12000, 18600, 25, 'Especias', 'España', 540]);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Una fila por presentación activa, para completar cantidad, lote y vencimiento. */
  private async fillStockTemplate(sheet: ExcelJS.Worksheet) {
    const variants = await this.uow.read((tx) =>
      tx.productVariant.findMany({
        where: { isActive: true, product: { isActive: true } },
        select: { sku: true, name: true, product: { select: { name: true } } },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      }),
    );
    if (!variants.length) sheet.addRow(['PIM-AHU-1KG', 'Pimentón ahumado', '1 kg', 40, 'L2410-07', '31/10/2027', 'DEP-01']);
    for (const v of variants) sheet.addRow([v.sku, v.product.name, v.name]);
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(2).width = 34;
    sheet.getColumn(3).width = 30;
    sheet.getColumn(6).numFmt = 'dd/mm/yyyy';
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private emptyResult(dryRun: boolean, totalRows: number, unknownColumns: string[]): ImportResult {
    return { dryRun, totalRows, valid: 0, created: 0, updated: 0, skipped: 0, errors: [], preview: [], unknownColumns };
  }

  private rowError(row: number, e: unknown): ImportRowError {
    if (!(e instanceof DomainError)) this.logger.error(`Importación: fila ${row}`, e instanceof Error ? e.stack : String(e));
    return { row, message: e instanceof DomainError ? e.message : 'Error inesperado al guardar la fila' };
  }
}
