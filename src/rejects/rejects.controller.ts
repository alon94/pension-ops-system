import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { RejectService } from './reject.service';
import { RejectStatus } from './reject.types';

/** API לניהול ריג'קטים (פרק 7) — לדשבורד הרפרנט ולאייג'נטים. */
@Controller('rejects')
export class RejectsController {
  constructor(private readonly rejects: RejectService) {}

  @Post(':id/transition')
  @Roles('OPERATOR', 'MANAGER')
  transition(
    @Param('id') id: string,
    @Body() body: { to: RejectStatus; by: string; note?: string; manufacturerKey?: string; resolutionSummary?: string },
  ) {
    return this.rejects.transition(id, body);
  }

  @Post('escalate-overdue')
  @Roles('OPERATOR', 'MANAGER')
  escalate() {
    return this.rejects.escalateOverdue();
  }

  @Get('customer/:customerId/risk-flags')
  riskFlags(@Param('customerId') customerId: string) {
    return this.rejects.customerRiskFlags(customerId);
  }
}
