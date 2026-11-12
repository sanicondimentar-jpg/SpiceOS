import { Injectable } from '@nestjs/common';
import type { FiscalSettings } from '@prisma/client';
import type { ArcaCertificateInput, FiscalSettingsInput } from '@spiceos/contracts';
import { BusinessRuleError } from '../../shared/domain/errors';
import { EncryptionService } from '../../shared/crypto/encryption.service';
import { PrismaService, type Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { checkCertificate, generateKeyAndCsr, normalizePem } from './arca/certificate';
import { ARCA_URLS } from './arca/soap';
import { login, type Ticket } from './arca/wsaa';
import { WsfeClient } from './arca/wsfe';
import { invoiceKind } from './domain/invoice-rules';

/** Si no hay datos fiscales cargados, se asume monotributo (no se suma IVA a los pedidos). */
export const DEFAULT_CONDITION = 'MONOTRIBUTO' as const;

/** ¿Se suma 21 % de IVA a los pedidos con factura? Solo como Responsable Inscripto. */
export async function addsVat(tx: Tx): Promise<boolean> {
  const s = await tx.fiscalSettings.findFirst({ select: { taxCondition: true } });
  return (s?.taxCondition ?? DEFAULT_CONDITION) === 'RESPONSABLE_INSCRIPTO';
}

/**
 * Datos fiscales del emisor y conexión con ARCA, desde Configuración → Facturación.
 * La clave privada se genera acá, se guarda cifrada y nunca se devuelve.
 */
@Injectable()
export class FiscalSettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly prisma: PrismaService,
    private readonly crypto: EncryptionService,
  ) {}

  get() {
    return this.uow.read(async (tx) => {
      const s = await tx.fiscalSettings.findFirst();
      const since = new Date(Date.now() - 365 * 86_400_000);
      const rows = await tx.invoice.groupBy({
        by: ['type'],
        where: { testing: false, arcaType: { not: null }, issueDate: { gte: since } },
        _sum: { total: true },
      });
      // Lo facturado en los últimos 12 meses (facturas menos notas de crédito), para el tope del monotributo.
      const invoiced = rows.reduce((acc, r) => acc + (r.type.startsWith('NC') ? -1 : 1) * Number(r._sum.total ?? 0), 0);
      return { settings: s && this.view(s), invoicedLast12Months: invoiced };
    });
  }

  private view(s: FiscalSettings) {
    return {
      taxCondition: s.taxCondition,
      cuit: s.cuit,
      legalName: s.legalName,
      address: s.address,
      grossIncomeId: s.grossIncomeId,
      activityStart: s.activityStart?.toISOString().slice(0, 10) ?? null,
      pointOfSale: s.pointOfSale,
      environment: s.environment,
      monotributoCategory: s.monotributoCategory,
      annualCap: s.annualCap === null ? null : Number(s.annualCap),
      hasKey: !!s.encryptedPrivateKey,
      csr: s.csr,
      hasCertificate: !!s.certificate,
      certificateExpiresAt: s.certificateExpiresAt,
      ready: !!(s.certificate && s.encryptedPrivateKey && s.pointOfSale),
    };
  }

  async save(input: FiscalSettingsInput) {
    const ctx = RequestContextStore.get();
    await this.uow.run(async (tx, scope) => {
      const existing = await tx.fiscalSettings.findFirst();
      const data = {
        taxCondition: input.taxCondition,
        cuit: input.cuit,
        legalName: input.legalName,
        address: input.address,
        grossIncomeId: input.grossIncomeId || null,
        activityStart: input.activityStart ? new Date(input.activityStart) : null,
        pointOfSale: input.pointOfSale ?? null,
        environment: input.environment,
        monotributoCategory: input.monotributoCategory?.toUpperCase() || null,
        annualCap: input.annualCap ?? null,
      };
      // El certificado está atado al CUIT; el ticket de acceso, al ambiente de ARCA.
      const cuitChanged = existing && existing.cuit !== input.cuit;
      const envChanged = existing && existing.environment !== input.environment;
      const reset = {
        ...(cuitChanged && { encryptedPrivateKey: null, csr: null, certificate: null, certificateExpiresAt: null }),
        ...((cuitChanged || envChanged) && { encryptedTicket: null, ticketExpiresAt: null }),
      };
      if (existing) await tx.fiscalSettings.update({ where: { id: existing.id }, data: { ...data, ...reset } });
      else await tx.fiscalSettings.create({ data: { ...data, tenantId: ctx.tenantId } });
      // Las facturas de prueba (homologación) no valen y usan otra numeración: al pasar a producción se borran.
      if (envChanged && input.environment === 'PRODUCTION') {
        await tx.invoice.deleteMany({ where: { testing: true } });
      }
      scope.auditLog({
        action: existing ? 'fiscal_settings.update' : 'fiscal_settings.create',
        entityType: 'fiscal_settings',
        entityId: ctx.tenantId,
        before: existing ? { taxCondition: existing.taxCondition, cuit: existing.cuit, pointOfSale: existing.pointOfSale, environment: existing.environment } : undefined,
        after: { taxCondition: data.taxCondition, cuit: data.cuit, pointOfSale: data.pointOfSale, environment: data.environment },
      });
    });
    return this.get();
  }

  /** Genera la clave privada y el pedido de certificado (CSR) para subir a ARCA. Reemplaza los anteriores. */
  async generateCsr() {
    const s = await this.require();
    const { privateKeyPem, csrPem } = generateKeyAndCsr({ cuit: s.cuit, legalName: s.legalName });
    await this.uow.run(async (tx, scope) => {
      await tx.fiscalSettings.update({
        where: { id: s.id },
        data: { encryptedPrivateKey: this.crypto.encrypt(privateKeyPem), csr: csrPem, certificate: null, certificateExpiresAt: null, encryptedTicket: null, ticketExpiresAt: null },
      });
      scope.auditLog({ action: 'fiscal_settings.csr', entityType: 'fiscal_settings', entityId: s.tenantId });
    });
    return this.get();
  }

  async saveCertificate(input: ArcaCertificateInput) {
    const s = await this.require();
    if (!s.encryptedPrivateKey) throw new BusinessRuleError('Primero generá el pedido de certificado');
    let info;
    try {
      info = checkCertificate(input.certificate, this.crypto.decrypt(s.encryptedPrivateKey));
    } catch (e) {
      throw new BusinessRuleError((e as Error).message);
    }
    if (info.subjectCuit && info.subjectCuit !== s.cuit) throw new BusinessRuleError(`El certificado es del CUIT ${info.subjectCuit}, no del ${s.cuit}`);
    if (info.notAfter < new Date()) throw new BusinessRuleError('El certificado está vencido');
    await this.uow.run(async (tx, scope) => {
      await tx.fiscalSettings.update({
        where: { id: s.id },
        data: { certificate: normalizePem(input.certificate), certificateExpiresAt: info.notAfter, encryptedTicket: null, ticketExpiresAt: null },
      });
      scope.auditLog({ action: 'fiscal_settings.certificate', entityType: 'fiscal_settings', entityId: s.tenantId, after: { expiresAt: info.notAfter } });
    });
    return this.get();
  }

  /** Prueba la conexión: ingresa a ARCA y lista los puntos de venta de web services. */
  async test() {
    const s = await this.require();
    const wsfe = await this.client(s);
    const pointsOfSale = await wsfe.pointsOfSale();
    const kind = invoiceKind(s.taxCondition, 'CF');
    const lastNumber = s.pointOfSale ? await wsfe.lastAuthorized(s.pointOfSale, kind.arcaType) : null;
    return { pointsOfSale, lastNumber, kind: kind.type };
  }

  /** Configuración completa para emitir, o error con lo que falta. */
  async requireReady() {
    const s = await this.require();
    if (!s.encryptedPrivateKey || !s.certificate) throw new BusinessRuleError('Falta conectar ARCA: cargá el certificado en Configuración → Facturación');
    if (!s.pointOfSale) throw new BusinessRuleError('Falta el punto de venta en Configuración → Facturación');
    return s as FiscalSettings & { pointOfSale: number; certificate: string; encryptedPrivateKey: Uint8Array };
  }

  async client(s: FiscalSettings) {
    const ticket = await this.ticket(s);
    return new WsfeClient(ARCA_URLS[s.environment].wsfe, { token: ticket.token, sign: ticket.sign, cuit: s.cuit });
  }

  /**
   * Ticket de acceso de WSAA. Se reutiliza mientras le queden más de 5 minutos: ARCA no entrega otro
   * mientras haya uno vigente. Se pide con un bloqueo para que dos facturas a la vez no pidan dos.
   */
  private async ticket(s: FiscalSettings): Promise<Ticket> {
    if (!s.certificate || !s.encryptedPrivateKey) throw new BusinessRuleError('Falta conectar ARCA: cargá el certificado en Configuración → Facturación');
    const fresh = (t: FiscalSettings) => t.encryptedTicket && t.ticketExpiresAt && t.ticketExpiresAt.getTime() - Date.now() > 5 * 60_000;
    if (fresh(s)) return JSON.parse(this.crypto.decrypt(s.encryptedTicket!)) as Ticket;
    return this.prisma.tx(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wsaa:${s.tenantId}`}))`;
        const current = await tx.fiscalSettings.findUniqueOrThrow({ where: { id: s.id } });
        if (fresh(current)) return JSON.parse(this.crypto.decrypt(current.encryptedTicket!)) as Ticket;
        let ticket: Ticket;
        try {
          ticket = await login(ARCA_URLS[s.environment].wsaa, s.certificate!, this.crypto.decrypt(s.encryptedPrivateKey!));
        } catch (e) {
          throw new BusinessRuleError((e as Error).message);
        }
        await tx.fiscalSettings.update({ where: { id: s.id }, data: { encryptedTicket: this.crypto.encrypt(JSON.stringify(ticket)), ticketExpiresAt: ticket.expiresAt } });
        return ticket;
      },
      undefined,
      { timeout: 45_000 },
    );
  }

  private async require() {
    const s = await this.uow.read((tx) => tx.fiscalSettings.findFirst());
    if (!s) throw new BusinessRuleError('Primero cargá los datos fiscales en Configuración → Facturación');
    return s;
  }
}
