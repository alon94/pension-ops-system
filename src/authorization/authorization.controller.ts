import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { AuthorizationService } from './authorization.service';
import { NewAuthorization } from './authorization.types';
import { InquiryRequirement } from './scope';

@Controller('authorizations')
export class AuthorizationController {
  constructor(private readonly svc: AuthorizationService) {}

  @Post()
  @Roles('MANAGER')
  create(@Body() body: NewAuthorization) {
    return this.svc.create(body);
  }

  @Post(':id/revoke')
  @Roles('MANAGER')
  revoke(@Body() body: { by: 'customer' | 'agent' | 'system_auto'; reason: string }, @Param('id') id: string) {
    return this.svc.revoke(id, body.by, body.reason);
  }

  @Post('expire-due')
  @Roles('MANAGER')
  expire() {
    return this.svc.expireDueAuthorizations();
  }

  @Post('customer/:customerId/check')
  @Roles('OPERATOR', 'MANAGER')
  check(@Param('customerId') customerId: string, @Body() body: InquiryRequirement) {
    return this.svc.assertCanInquire(customerId, body);
  }

  @Get('customer/:customerId/export')
  @Roles('AUDITOR', 'MANAGER')
  exportData(@Param('customerId') customerId: string) {
    return this.svc.exportForCustomer(customerId);
  }
}
