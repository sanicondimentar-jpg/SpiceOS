import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { Injectable } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/decorators';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { ExecutiveService } from './executive.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly executive: ExecutiveService) {}

  @Get('executive')
  @RequirePermissions(PERMISSIONS.analytics.executive)
  kpis() {
    return this.executive.kpis();
  }

  @Get('revenue-by-month')
  @RequirePermissions(PERMISSIONS.analytics.executive)
  revenue(@Query('months') months = '12') {
    return this.executive.revenueByMonth(Number(months));
  }
}

@Injectable()
export class AnalyticsAiTools {
  constructor(private readonly executive: ExecutiveService) {}

  @AiTool({
    name: 'analytics_executive_kpis',
    description:
      'Indicadores ejecutivos del mes: facturación vs mismo período del mes anterior, margen, pedidos, clientes activos e inactivos, deuda vencida, embudo ponderado, alertas de stock y lotes por vencer.',
    input: z.object({}),
    permissions: [PERMISSIONS.analytics.executive],
    agents: ['executive'],
  })
  kpis() {
    return this.executive.kpis();
  }

  @AiTool({
    name: 'analytics_revenue_by_month',
    description: 'Facturación y margen por mes de los últimos N meses, para tendencias y comparaciones.',
    input: z.object({ months: z.number().int().min(1).max(36).default(12) }),
    permissions: [PERMISSIONS.analytics.executive],
    agents: ['executive', 'pricing'],
  })
  revenue({ months }: { months: number }) {
    return this.executive.revenueByMonth(months);
  }
}
