/**
 * Datos iniciales: permisos, empresa demo "Sani Condimentar", roles, embudo,
 * catálogo base de especias y las reglas de automatización de ejemplo.
 * Corre con el usuario dueño (MIGRATION_DATABASE_URL), que no está sujeto a RLS.
 */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS } from '@spiceos/contracts';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });

const ROLES: { key: string; name: string; maxDiscount: number; permissions: string[] }[] = [
  { key: 'admin', name: 'Administrador', maxDiscount: 100, permissions: ALL_PERMISSIONS },
  {
    key: 'gerente',
    name: 'Gerencia',
    maxDiscount: 30,
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith('core.user')),
  },
  {
    key: 'vendedor',
    name: 'Vendedor',
    maxDiscount: 10,
    permissions: [
      PERMISSIONS.crm.customerRead, PERMISSIONS.crm.customerWrite,
      PERMISSIONS.sales.opportunityRead, PERMISSIONS.sales.opportunityWrite,
      PERMISSIONS.sales.quoteRead, PERMISSIONS.sales.quoteWrite,
      PERMISSIONS.catalog.read, PERMISSIONS.orders.read, PERMISSIONS.orders.write,
      PERMISSIONS.inventory.read, PERMISSIONS.receivables.read, PERMISSIONS.documents.read,
      PERMISSIONS.messaging.read, PERMISSIONS.messaging.send, PERMISSIONS.copilot.use,
    ],
  },
  {
    key: 'deposito',
    name: 'Depósito',
    maxDiscount: 0,
    permissions: [PERMISSIONS.catalog.read, PERMISSIONS.inventory.read, PERMISSIONS.inventory.adjust, PERMISSIONS.orders.read, PERMISSIONS.documents.read, PERMISSIONS.copilot.use],
  },
  {
    key: 'cobranzas',
    name: 'Cobranzas',
    maxDiscount: 0,
    permissions: [PERMISSIONS.crm.customerRead, PERMISSIONS.receivables.read, PERMISSIONS.receivables.write, PERMISSIONS.messaging.read, PERMISSIONS.messaging.send, PERMISSIONS.copilot.use],
  },
];

const PRODUCTS = [
  { code: 'PIM-DUL', name: 'Pimentón dulce', origin: 'Argentina', shelfLifeDays: 540 },
  { code: 'PIM-AHU', name: 'Pimentón ahumado', origin: 'España', shelfLifeDays: 540 },
  { code: 'ORE', name: 'Orégano', origin: 'Argentina', shelfLifeDays: 720 },
  { code: 'COM-MOL', name: 'Comino molido', origin: 'India', shelfLifeDays: 540 },
  { code: 'AJI-MOL', name: 'Ají molido', origin: 'Argentina', shelfLifeDays: 540 },
  { code: 'PIM-NEG', name: 'Pimienta negra en grano', origin: 'Vietnam', shelfLifeDays: 1080 },
  { code: 'CUR', name: 'Cúrcuma', origin: 'India', shelfLifeDays: 720 },
  { code: 'CHI', name: 'Chimichurri', origin: 'Argentina', shelfLifeDays: 365 },
];

const PRESENTATIONS = [
  { suffix: '100G', name: '100 g', kg: 0.1, factor: 0.14 },
  { suffix: '1KG', name: '1 kg', kg: 1, factor: 1 },
  { suffix: '25KG', name: 'Bolsa 25 kg', kg: 25, factor: 22 },
];

async function main() {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, create: { key, module: key.split('.')[0], description: key }, update: {} });
  }

  const company = await prisma.company.upsert({
    where: { keycloakOrgId: process.env.SEED_KEYCLOAK_ORG_ID ?? 'sani-condimentar' },
    create: {
      keycloakOrgId: process.env.SEED_KEYCLOAK_ORG_ID ?? 'sani-condimentar',
      legalName: 'Sani Condimentar',
      tradeName: 'Sani Condimentar',
      taxId: '30-00000000-0',
    },
    update: {},
  });
  const tenantId = company.id;

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId, code: 'CENTRAL' } },
    create: { tenantId, code: 'CENTRAL', name: 'Casa central', isMain: true },
    update: {},
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code: 'DEP-01' } },
    create: { tenantId, branchId: branch.id, code: 'DEP-01', name: 'Depósito principal' },
    update: {},
  });

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key: r.key } },
      create: { tenantId, key: r.key, name: r.name, isSystem: true, maxDiscount: r.maxDiscount },
      update: { maxDiscount: r.maxDiscount },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })) });
  }

  const admin = await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@sanicondimentar.local' },
    create: {
      keycloakId: process.env.SEED_ADMIN_KEYCLOAK_ID ?? 'seed-admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@sanicondimentar.local',
      fullName: 'Administrador',
    },
    update: {},
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'admin' } } });
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId, userId: admin.id } },
    create: { tenantId, userId: admin.id, roleId: adminRole.id },
    update: {},
  });

  if (!(await prisma.pipeline.findFirst({ where: { tenantId } }))) {
    await prisma.pipeline.create({
      data: {
        tenantId,
        name: 'Ventas B2B',
        stages: {
          create: [
            { name: 'Nueva', position: 1, probability: 10 },
            { name: 'Calificada', position: 2, probability: 25 },
            { name: 'Muestra enviada', position: 3, probability: 40 },
            { name: 'Cotizada', position: 4, probability: 60 },
            { name: 'Negociación', position: 5, probability: 80 },
            { name: 'Ganada', position: 6, probability: 100, isWon: true },
            { name: 'Perdida', position: 7, probability: 0, isLost: true },
          ],
        },
      },
    });
  }

  for (const t of [
    { code: 'IVA21', name: 'IVA 21%', rate: 21 },
    { code: 'IVA10.5', name: 'IVA 10,5%', rate: 10.5 },
  ]) {
    await prisma.taxRate.upsert({ where: { tenantId_code: { tenantId, code: t.code } }, create: { tenantId, ...t }, update: {} });
  }

  const category = await prisma.category.upsert({
    where: { tenantId_slug: { tenantId, slug: 'especias' } },
    create: { tenantId, name: 'Especias', slug: 'especias' },
    update: {},
  });
  const priceList = await prisma.priceList.upsert({
    where: { tenantId_name: { tenantId, name: 'Mayorista' } },
    create: { tenantId, name: 'Mayorista', isDefault: true },
    update: {},
  });

  for (const [i, p] of PRODUCTS.entries()) {
    const product = await prisma.product.upsert({
      where: { tenantId_code: { tenantId, code: p.code } },
      create: { tenantId, categoryId: category.id, ...p },
      update: {},
    });
    const baseCost = 6000 + i * 900; // costo por kg, referencial
    for (const pr of PRESENTATIONS) {
      const sku = `${p.code}-${pr.suffix}`;
      const cost = Math.round(baseCost * pr.factor);
      const variant = await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId, sku } },
        create: {
          tenantId,
          productId: product.id,
          sku,
          name: pr.name,
          unit: 'UN',
          netWeightKg: pr.kg,
          currentCost: cost,
          minMarginPct: 25,
          reorderPoint: pr.kg >= 25 ? 4 : 40,
        },
        update: {},
      });
      await prisma.priceListItem.upsert({
        where: { priceListId_variantId_minQuantity: { priceListId: priceList.id, variantId: variant.id, minQuantity: 1 } },
        create: { priceListId: priceList.id, variantId: variant.id, price: Math.round(cost * 1.55), minQuantity: 1 },
        update: {},
      });
      const lot = await prisma.lot.upsert({
        where: { tenantId_variantId_code: { tenantId, variantId: variant.id, code: `L${2026}${String(i).padStart(3, '0')}` } },
        create: {
          tenantId,
          variantId: variant.id,
          code: `L${2026}${String(i).padStart(3, '0')}`,
          expiresAt: new Date(Date.now() + p.shelfLifeDays * 86_400_000),
        },
        update: {},
      });
      const exists = await prisma.stockItem.findFirst({ where: { warehouseId: warehouse.id, variantId: variant.id, lotId: lot.id } });
      if (!exists) {
        await prisma.stockItem.create({ data: { tenantId, warehouseId: warehouse.id, variantId: variant.id, lotId: lot.id, onHand: pr.kg >= 25 ? 20 : 200 } });
      }
    }
  }

  const rules = [
    {
      name: 'Cliente sin compras 60 días → tarea al vendedor',
      triggerType: 'SCHEDULE',
      schedule: '0 8 * * 1-5',
      conditions: { days: 60 },
      actions: [{ type: 'create_task', params: { title: 'Llamar a {{payload.customerName}}: {{payload.daysInactive}} días sin comprar', assignTo: 'owner', dueInHours: 48, priority: 'HIGH' } }],
    },
    {
      name: 'Intención de compra en WhatsApp → oportunidad',
      triggerType: 'EVENT',
      eventType: 'intent.detected',
      conditions: { all: [{ field: 'payload.intent', op: 'eq', value: 'purchase_intent' }, { field: 'payload.score', op: 'gte', value: 0.7 }] },
      actions: [
        { type: 'create_opportunity', params: { title: 'WhatsApp: {{payload.summary}}', stage: 'Nueva' } },
        { type: 'create_task', params: { title: 'Responder pedido por WhatsApp: {{payload.summary}}', assignTo: 'owner', dueInHours: 2, priority: 'URGENT' } },
      ],
    },
    {
      name: 'Cotización mayor a $5.000.000 → avisar a gerencia',
      triggerType: 'EVENT',
      eventType: 'quote.created',
      conditions: { field: 'payload.total', op: 'gt', value: 5_000_000 },
      actions: [{ type: 'notify', params: { role: 'gerente', title: 'Cotización grande', body: 'Se creó una cotización por ${{payload.total}}', channel: 'IN_APP' } }],
    },
  ];
  for (const r of rules) {
    const exists = await prisma.automationRule.findFirst({ where: { tenantId, name: r.name } });
    if (!exists) await prisma.automationRule.create({ data: { tenantId, ...r, createdBy: 'seed' } });
  }

  console.log(`Seed listo. Empresa ${company.legalName} (${tenantId})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
