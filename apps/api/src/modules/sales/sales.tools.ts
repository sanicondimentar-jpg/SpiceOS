import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, createQuoteSchema } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { QuotesService } from './quotes.service';

@Injectable()
export class SalesAiTools {
  constructor(private readonly quotes: QuotesService) {}

  @AiTool({
    name: 'sales_open_opportunities',
    description: 'Lista oportunidades abiertas con etapa, monto, probabilidad, cliente y fecha estimada de cierre. Responde "¿qué oportunidades tengo abiertas?".',
    input: z.object({ onlyMine: z.boolean().default(true) }),
    permissions: [PERMISSIONS.sales.opportunityRead],
    agents: ['commercial', 'executive'],
  })
  openOpportunities({ onlyMine }: { onlyMine: boolean }) {
    const ctx = RequestContextStore.get();
    return this.quotes.openOpportunities(onlyMine ? (ctx.onBehalfOf ?? ctx.userId) : undefined);
  }

  @AiTool({
    name: 'sales_pipeline_summary',
    description: 'Resumen del embudo comercial por etapa: cantidad, monto y monto ponderado por probabilidad.',
    input: z.object({}),
    permissions: [PERMISSIONS.sales.opportunityRead],
    agents: ['commercial', 'executive'],
  })
  pipeline() {
    return this.quotes.pipelineSummary();
  }

  @AiTool({
    name: 'sales_create_quote',
    description:
      'Crea una cotización en borrador para un cliente con precios de su lista. Antes buscá el cliente (crm_search_customers) y los productos (catalog_search_products). Si el descuento o el margen requieren aprobación, queda pendiente y avisá al usuario.',
    input: createQuoteSchema,
    permissions: [PERMISSIONS.sales.quoteWrite],
    write: true,
    agents: ['commercial', 'pricing'],
  })
  createQuote(input: z.infer<typeof createQuoteSchema>) {
    return this.quotes.create(input);
  }
}
