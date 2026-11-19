import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  convertQuoteSchema,
  createQuoteSchema,
  quoteListQuerySchema,
  quoteStatusSchema,
  updateQuoteSchema,
  type ConvertQuoteInput,
  type CreateQuoteInput,
  type QuoteListQuery,
  type QuoteStatusInput,
  type UpdateQuoteInput,
} from '@spiceos/contracts';
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

  @Get('quotes')
  @RequirePermissions(PERMISSIONS.sales.quoteRead)
  listQuotes(@Query(new ZodPipe(quoteListQuerySchema)) query: QuoteListQuery) {
    return this.quotes.list(query);
  }

  @Patch('quotes/:id')
  @RequirePermissions(PERMISSIONS.sales.quoteWrite)
  updateQuote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateQuoteSchema)) body: UpdateQuoteInput) {
    return this.quotes.update(id, body);
  }

  @Post('quotes/:id/status')
  @RequirePermissions(PERMISSIONS.sales.quoteWrite)
  setQuoteStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(quoteStatusSchema)) body: QuoteStatusInput) {
    return this.quotes.setStatus(id, body);
  }

  /** Pasa el presupuesto a pedido en borrador. */
  @Post('quotes/:id/convert')
  @RequirePermissions(PERMISSIONS.sales.quoteWrite, PERMISSIONS.orders.write)
  convertQuote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(convertQuoteSchema)) body: ConvertQuoteInput) {
    return this.quotes.convert(id, body);
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
