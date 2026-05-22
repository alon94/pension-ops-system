import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { CollectionService } from './collection.service';
import { ClearingReport, DiscrepancyStatus, EmployerReport, ExpectedDeposit } from './collection.types';

@Controller('collection')
export class CollectionController {
  constructor(private readonly svc: CollectionService) {}

  @Post('reconcile')
  @Roles('OPERATOR', 'MANAGER')
  reconcile(@Body() body: { expected: ExpectedDeposit[]; employerReports: EmployerReport[]; clearingReports: ClearingReport[] }) {
    return this.svc.reconcileMonth(body);
  }

  @Post('discrepancies/:id/transition')
  @Roles('OPERATOR', 'MANAGER')
  transition(@Param('id') id: string, @Body() body: { to: DiscrepancyStatus; by: string; summary?: string }) {
    return this.svc.transition(id, body);
  }

  @Get('reports/:month')
  report(@Param('month') month: string) {
    return this.svc.monthlyReport(month);
  }
}
