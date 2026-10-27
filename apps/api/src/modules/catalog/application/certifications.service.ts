import { Injectable } from '@nestjs/common';
import type { CertificationInput, ProductCertificationInput } from '@spiceos/contracts';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { UnitOfWork } from '../../../shared/unit-of-work';

/** Certificaciones (Sin TACC, Kosher, Orgánico…) y su vigencia por producto. */
@Injectable()
export class CertificationsService {
  constructor(private readonly uow: UnitOfWork) {}

  list() {
    return this.uow.read((tx) =>
      tx.certification.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }),
    );
  }

  create(input: CertificationInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      if (await tx.certification.findFirst({ where: { name: input.name }, select: { id: true } })) {
        throw new ConflictError(`Ya existe la certificación ${input.name}`);
      }
      const cert = await tx.certification.create({ data: { ...input, tenantId: ctx.tenantId } });
      scope.auditLog({ action: 'certification.create', entityType: 'certification', entityId: cert.id, after: input });
      return cert;
    });
  }

  /** product_certifications no tiene tenant_id: producto y certificación se validan antes con RLS. */
  assign(productId: string, input: ProductCertificationInput) {
    return this.uow.run(async (tx, scope) => {
      const [product, cert] = await Promise.all([
        tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } }),
        tx.certification.findFirst({ where: { id: input.certificationId }, select: { id: true } }),
      ]);
      if (!product) throw new NotFoundError('Producto', productId);
      if (!cert) throw new NotFoundError('Certificación', input.certificationId);
      if (input.documentId && !(await tx.document.findFirst({ where: { id: input.documentId }, select: { id: true } }))) {
        throw new NotFoundError('Documento', input.documentId);
      }
      const data = {
        certificateNo: input.certificateNo ?? null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        documentId: input.documentId ?? null,
      };
      await tx.productCertification.upsert({
        where: { productId_certificationId: { productId, certificationId: input.certificationId } },
        create: { productId, certificationId: input.certificationId, ...data },
        update: data,
      });
      scope.auditLog({ action: 'product.certification', entityType: 'product', entityId: productId, after: input });
      return { productId, certificationId: input.certificationId };
    });
  }

  unassign(productId: string, certificationId: string) {
    return this.uow.run(async (tx, scope) => {
      const product = await tx.product.findFirst({ where: { id: productId }, select: { id: true } });
      if (!product) throw new NotFoundError('Producto', productId);
      await tx.productCertification.deleteMany({ where: { productId, certificationId } });
      scope.auditLog({ action: 'product.certification_removed', entityType: 'product', entityId: productId, before: { certificationId } });
      return { productId, certificationId };
    });
  }

  /** Certificados que vencen en los próximos N días (incluye los ya vencidos). */
  expiring(days: number) {
    const until = new Date(Date.now() + days * 86_400_000);
    return this.uow.read((tx) =>
      tx.productCertification.findMany({
        where: { validUntil: { lte: until }, product: { deletedAt: null, isActive: true } },
        orderBy: { validUntil: 'asc' },
        include: { product: { select: { id: true, code: true, name: true } }, certification: { select: { name: true } } },
      }),
    );
  }
}
