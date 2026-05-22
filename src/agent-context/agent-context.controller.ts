import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { AgentContextService } from './agent-context.service';

@Controller('agent-context')
export class AgentContextController {
  constructor(private readonly svc: AgentContextService) {}

  @Get(':customerId')
  async get(@Param('customerId') customerId: string) {
    const ctx = await this.svc.refresh(customerId); // מבטיח גרסה עדכנית
    if (!ctx) throw new NotFoundException(`לקוח לא נמצא: ${customerId}`);
    return ctx;
  }

  @Post(':customerId/refresh')
  async refresh(@Param('customerId') customerId: string) {
    const ctx = await this.svc.refresh(customerId);
    if (!ctx) throw new NotFoundException(`לקוח לא נמצא: ${customerId}`);
    return ctx;
  }

  @Post(':customerId/briefing')
  async briefing(@Param('customerId') customerId: string, @Body() body: { reason?: string }) {
    const out = await this.svc.briefing(customerId, body?.reason);
    if (!out) throw new NotFoundException(`לקוח לא נמצא: ${customerId}`);
    return out;
  }

  // נוחות ל-UI: GET עם reason ב-querystring כך שניתן לקרוא ישירות מהדפדפן
  @Get(':customerId/briefing')
  async briefingGet(@Param('customerId') customerId: string, @Query('reason') reason?: string) {
    const out = await this.svc.briefing(customerId, reason);
    if (!out) throw new NotFoundException(`לקוח לא נמצא: ${customerId}`);
    return out;
  }
}
