import { WEEKDAYS, createCustomerSchema, type CreateCustomerInput, type ImportRowError, type Weekday } from '@spiceos/contracts';
import { normalizePhone, normalizeTaxId } from '../crm/domain/customer';
import { normalizeHeader, parseNumber, type SheetRow } from './spreadsheet';

/** Encabezados aceptados por campo (se comparan sin acentos ni mayúsculas). */
export const CUSTOMER_COLUMNS: Record<string, string[]> = {
  legalName: ['razón social', 'razon social', 'cliente', 'nombre', 'nombre cliente'],
  tradeName: ['nombre de fantasía', 'nombre fantasia', 'fantasía', 'fantasia'],
  taxId: ['cuit', 'cuil', 'cuit/cuil', 'cuit cuil', 'nro cuit'],
  taxCondition: ['condición iva', 'condicion iva', 'iva', 'condición fiscal', 'condicion fiscal'],
  industry: ['rubro', 'actividad', 'industria', 'tipo de cliente'],
  phone: ['teléfono', 'telefono', 'tel', 'celular', 'whatsapp', 'móvil', 'movil'],
  email: ['email', 'e-mail', 'mail', 'correo'],
  street: ['dirección', 'direccion', 'domicilio', 'calle', 'dirección de entrega', 'direccion de entrega'],
  city: ['localidad', 'ciudad', 'partido', 'barrio'],
  province: ['provincia'],
  deliveryDays: ['días de entrega', 'dias de entrega', 'días de recepción', 'dias de recepcion', 'días de atención', 'dias de atencion', 'días', 'dias'],
  deliveryHours: ['horario', 'horario de entrega', 'horario de recepción', 'horario de recepcion', 'horario de atención', 'horario de atencion'],
  paymentTermsDays: ['plazo', 'plazo de pago', 'días de pago', 'dias de pago', 'condición de pago', 'condicion de pago'],
  creditLimit: ['límite de crédito', 'limite de credito', 'crédito', 'credito'],
  priceList: ['lista', 'lista de precios'],
  owner: ['vendedor', 'vendedor asignado', 'email vendedor'],
  contactName: ['contacto', 'nombre contacto', 'persona de contacto'],
  contactPosition: ['cargo', 'cargo contacto'],
  tags: ['etiquetas', 'tags'],
};

export const CUSTOMER_TEMPLATE_HEADERS = [
  'Razón social', 'Nombre de fantasía', 'CUIT', 'Condición IVA', 'Rubro', 'Teléfono', 'Dirección', 'Localidad', 'Provincia',
  'Días de entrega', 'Horario', 'Email',
  'Plazo de pago', 'Límite de crédito', 'Lista de precios', 'Vendedor', 'Contacto', 'Cargo', 'Etiquetas',
];

const TAX_CONDITIONS: Record<string, CreateCustomerInput['taxCondition']> = {
  ri: 'RI', 'responsable inscripto': 'RI', 'resp inscripto': 'RI', inscripto: 'RI',
  monotributo: 'MONOTRIBUTO', monotributista: 'MONOTRIBUTO', mt: 'MONOTRIBUTO',
  cf: 'CF', 'consumidor final': 'CF',
  exento: 'EXENTO', 'iva exento': 'EXENTO',
};

export interface CustomerLookups {
  priceLists: Map<string, string>; // nombre normalizado → id
  users: Map<string, string>; // email o nombre normalizado → id
}

export interface CustomerRowResult {
  row: number;
  input?: CreateCustomerInput;
  contact?: { fullName: string; position?: string; phone?: string; email?: string };
  errors: ImportRowError[];
}

/** Convierte una fila de planilla en el alta de cliente, con errores por campo. No toca la base. */
export function mapCustomerRow({ row, values }: SheetRow, lookups: CustomerLookups): CustomerRowResult {
  const errors: ImportRowError[] = [];
  const err = (field: string, message: string) => errors.push({ row, field, message });

  let taxId: string | undefined;
  if (values.taxId) {
    try {
      taxId = normalizeTaxId(values.taxId) ?? undefined;
    } catch {
      err('taxId', `CUIT inválido: ${values.taxId}`);
    }
  }

  let taxCondition: CreateCustomerInput['taxCondition'];
  if (values.taxCondition) {
    taxCondition = TAX_CONDITIONS[normalizeHeader(values.taxCondition)];
    if (!taxCondition) err('taxCondition', `Condición IVA desconocida: ${values.taxCondition} (usá RI, Monotributo, CF o Exento)`);
  }

  let paymentTermsDays = 0;
  if (values.paymentTermsDays) {
    const lower = normalizeHeader(values.paymentTermsDays);
    const n = lower === 'contado' ? 0 : parseNumber(lower.match(/\d+/)?.[0]);
    if (n === null) err('paymentTermsDays', `Plazo inválido: ${values.paymentTermsDays}`);
    else paymentTermsDays = n;
  }

  let creditLimit: number | undefined;
  if (values.creditLimit) {
    const n = parseNumber(values.creditLimit);
    if (n === null || n < 0) err('creditLimit', `Límite de crédito inválido: ${values.creditLimit}`);
    else creditLimit = n;
  }

  let priceListId: string | undefined;
  if (values.priceList) {
    priceListId = lookups.priceLists.get(normalizeHeader(values.priceList));
    if (!priceListId) err('priceList', `No existe la lista de precios "${values.priceList}"`);
  }

  let ownerId: string | undefined;
  if (values.owner) {
    ownerId = lookups.users.get(values.owner.toLowerCase().trim()) ?? lookups.users.get(normalizeHeader(values.owner));
    if (!ownerId) err('owner', `No existe el vendedor "${values.owner}" (usá su email)`);
  }

  if (values.phone && !normalizePhone(values.phone)) err('phone', `Teléfono inválido: ${values.phone}`);

  let deliveryDays: Weekday[] = [];
  if (values.deliveryDays) {
    const parsed = parseWeekdays(values.deliveryDays);
    if (!parsed) err('deliveryDays', `Días no reconocidos: ${values.deliveryDays} (ej.: "lunes a viernes", "mar, jue")`);
    else deliveryDays = parsed;
  }

  const candidate = {
    legalName: values.legalName,
    tradeName: values.tradeName,
    taxId,
    taxCondition,
    industry: values.industry,
    phone: values.phone,
    email: values.email?.toLowerCase(),
    address: values.street || values.city ? { street: values.street ?? '', city: values.city ?? '', province: values.province || undefined } : undefined,
    deliveryDays,
    deliveryHours: values.deliveryHours,
    ownerId,
    priceListId,
    paymentTermsDays,
    creditLimit,
    source: 'import',
    tags: values.tags ? values.tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : [],
  };
  const parsed = createCustomerSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'address' ? String(issue.path[1] ?? 'street') : String(issue.path[0] ?? '');
      if (errors.some((e) => e.field === field)) continue;
      err(field, field === 'legalName' && !values.legalName ? 'Falta la razón social' : `${field}: ${issue.message}`);
    }
  }

  const contact = values.contactName
    ? { fullName: values.contactName, position: values.contactPosition, phone: values.phone, email: values.email?.toLowerCase() }
    : undefined;
  return { row, input: errors.length ? undefined : parsed.data, contact, errors };
}

const DAY_PREFIX: [RegExp, Weekday][] = [
  [/^lu/, 'LUN'],
  [/^ma/, 'MAR'],
  [/^mi/, 'MIE'],
  [/^ju/, 'JUE'],
  [/^vi/, 'VIE'],
  [/^sa/, 'SAB'],
  [/^do/, 'DOM'],
];
const toDay = (word: string) => DAY_PREFIX.find(([re]) => re.test(word))?.[1];

/** "lunes a viernes", "mar, jue y sáb", "lun-mie" → días. null si alguna palabra no es un día. */
export function parseWeekdays(text: string): Weekday[] | null {
  const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '');
  const days = new Set<Weekday>();
  for (const part of norm.split(/[,;/]|\s+y\s+/).map((p) => p.trim()).filter(Boolean)) {
    const range = part.split(/\s+a\s+|\s*-\s*/);
    if (range.length === 2) {
      const [from, to] = range.map((w) => toDay(w.trim()));
      if (!from || !to) return null;
      const i = WEEKDAYS.indexOf(from);
      const j = WEEKDAYS.indexOf(to);
      for (let k = i; ; k = (k + 1) % 7) {
        days.add(WEEKDAYS[k]);
        if (k === j) break;
      }
      continue;
    }
    const words = part.split(/\s+/);
    for (const w of words) {
      const d = toDay(w);
      if (!d) return null;
      days.add(d);
    }
  }
  return days.size ? WEEKDAYS.filter((d) => days.has(d)) : null;
}
