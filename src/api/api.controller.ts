import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { RejectFilters } from './ui-query.types';
import { AuditSearchFilters } from './ui-query-v2.types';

/** GET endpoints ייעודיים ל-UI (פרק 12). */
@Controller()
export class ApiController {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  @Get('dashboard/stats')
  stats() {
    return this.repo.dashboardStats(new Date());
  }

  @Get('rejects')
  rejects(@Query() q: RejectFilters) {
    return this.repo.listRejectsForUi({
      status: q.status, severity: q.severity, rejectType: q.rejectType,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get('customers')
  customers(@Query('q') q = '', @Query('limit') limit = '50') {
    return this.repo.searchCustomers(q, Number(limit));
  }

  @Get('customers/:id')
  async customer(@Param('id') id: string) {
    const out = await this.repo.customer360(id, new Date());
    if (!out) throw new NotFoundException(`לקוח לא נמצא: ${id}`);
    return out;
  }

  // ---------- מסכים נוספים (§12.2) ----------
  @Get('collection/view/:month')
  collectionView(@Param('month') month: string) {
    return this.repo.collectionMonthView(month);
  }

  @Get('terminations')
  terminations(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.repo.listTerminationsForUi({ status, limit: limit ? Number(limit) : undefined });
  }

  @Get('terminations/:id')
  async termination(@Param('id') id: string) {
    const out = await this.repo.terminationDetailForUi(id);
    if (!out) throw new NotFoundException(`אירוע סיום עבודה לא נמצא: ${id}`);
    return out;
  }

  @Get('authorizations/view')
  authorizationsView() {
    return this.repo.authorizationsView(new Date());
  }

  @Get('dashboard/manager-stats')
  @Roles('MANAGER')
  managerStats() {
    return this.repo.managerStats(new Date());
  }

  @Get('audit')
  @Roles('AUDITOR', 'MANAGER')
  audit(@Query() q: AuditSearchFilters) {
    return this.repo.searchAuditLog({
      actor: q.actor, action: q.action, entity: q.entity, since: q.since,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get('regulation-versions')
  @Roles('AUDITOR', 'MANAGER')
  regulationVersions() {
    return this.repo.listRegulationVersions();
  }

  @Get('ingestion/runs')
  @Roles('OPERATOR', 'MANAGER', 'AUDITOR')
  ingestionRuns(@Query('limit') limit?: string) {
    return this.repo.listIngestionRuns(limit ? Number(limit) : 50);
  }

  @Get('ingestion/runs/:id')
  @Roles('OPERATOR', 'MANAGER', 'AUDITOR')
  async ingestionRun(@Param('id') id: string) {
    const out = await this.repo.getIngestionRunDetail(id);
    if (!out) throw new NotFoundException(`ריצה לא נמצאה: ${id}`);
    return out;
  }
}
