import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../../../shared/ai/ai-tool.decorator';
import {
  FindInactiveCustomersQuery,
  GetCustomer360Query,
  InactiveCustomerRow,
  ListCustomersQuery,
} from '../../application/queries/customer.queries';

/** Tools del copiloto para CRM: llaman a los mismos queries que la API REST. */
@Injectable()
export class CrmAiTools {
  constructor(private readonly queries: QueryBus) {}

  @AiTool({
    name: 'crm_search_customers',
    description:
      'Busca clientes por nombre, razón social, CUIT o código. Usala para obtener el id de un cliente antes de consultar su ficha o generar una cotización.',
    input: z.object({ query: z.string().describe('Texto a buscar'), limit: z.number().int().max(20).default(5) }),
    permissions: [PERMISSIONS.crm.customerRead],
  })
  searchCustomers({ query, limit }: { query: string; limit: number }) {
    return this.queries.execute(new ListCustomersQuery({ q: query, page: 1, pageSize: limit }));
  }

  @AiTool({
    name: 'crm_customer_360',
    description:
      'Devuelve la vista 360 de un cliente: datos, contactos, ventas de 12 meses, margen, productos más comprados, oportunidades abiertas, deuda, riesgo, conversaciones y tareas.',
    input: z.object({ customerId: z.string().uuid() }),
    permissions: [PERMISSIONS.crm.customerRead],
  })
  customer360({ customerId }: { customerId: string }) {
    return this.queries.execute(new GetCustomer360Query(customerId));
  }

  @AiTool({
    name: 'crm_inactive_customers',
    description:
      'Lista clientes activos que no compran hace más de N días, ordenados por facturación de los últimos 12 meses. Responde preguntas como "¿qué clientes no compran hace más de 60 días?".',
    input: z.object({
      days: z.number().int().min(1).default(60),
      onlyMine: z.boolean().default(false).describe('Solo clientes del vendedor que pregunta'),
    }),
    permissions: [PERMISSIONS.crm.customerRead],
    agents: ['commercial', 'executive'],
  })
  async inactiveCustomers({ days }: { days: number; onlyMine: boolean }) {
    const rows: InactiveCustomerRow[] = await this.queries.execute(new FindInactiveCustomersQuery(days));
    return rows.slice(0, 50);
  }
}
