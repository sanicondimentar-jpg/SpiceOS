import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateQuoteInput, PERMISSIONS, createQuoteSchema } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { QuotesService } from './quotes.service';

@ApiTags('Ventas')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('quotes')
  @RequirePermissions(PERMISSIONS.sales.quoteWrite)
  createQuote(@Body(new ZodPipe(createQuoteSchema)) body: CreateQuoteInput) {
    return this.quotes.create(body);
  }

  @Get('quotes/:id')
  @RequirePermissions(PERMISSIONS.sales.quoteRead)
  getQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Post('quotes/:id/approve')
  @RequirePermissions(PERMISSIONS.sales.quoteApprove)
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.approve(id);
  }

  @Get('opportunities')
  @RequirePermissions(PERMISSIONS.sales.opportunityRead)
  opportunities(@Query('ownerId') ownerId?: string) {
    return this.quotes.openOpportunities(ownerId);
  }

  @Get('pipeline')
  @RequirePermissions(PERMISSIONS.sales.opportunityRead)
  pipeline() {
    return this.quotes.pipelineSummary();
  }
}
