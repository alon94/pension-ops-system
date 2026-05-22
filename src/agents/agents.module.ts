import { Module, OnModuleInit } from '@nestjs/common';
import { AgentContextModule } from '../agent-context/agent-context.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CollectionModule } from '../collection/collection.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { RejectsModule } from '../rejects/rejects.module';
import { TerminationModule } from '../termination/termination.module';
import { A1MeetingQualityAgent } from './a1.meeting-quality';
import { A11AuditAgent } from './a11.audit';
import { A2InternalRejectAgent, A3ManufacturerRejectAgent } from './a2-a3.rejects';
import { A4SalesProductionAgent, A5EmployerAllocationAgent, A7CollectionAgent } from './a4-a5-a7.collection';
import { A6TerminationAgent } from './a6.termination';
import { A9CommunicationAgent, A10KnowledgeAgent } from './a8-a9-a10.stubs';
import { A8DocumentUnderstandingAgent } from './a8.document-understanding';
import { Form161VisionExtractor } from './a8-vision/form-161-extractor';
import { AgentsController } from './agents.controller';
import { OrchestratorService } from './orchestrator.service';

@Module({
  imports: [PersistenceModule, RejectsModule, TerminationModule, CollectionModule, AuthorizationModule, AgentContextModule],
  controllers: [AgentsController],
  providers: [
    OrchestratorService,
    Form161VisionExtractor,
    A1MeetingQualityAgent,
    A2InternalRejectAgent, A3ManufacturerRejectAgent,
    A4SalesProductionAgent, A5EmployerAllocationAgent, A7CollectionAgent,
    A6TerminationAgent,
    A8DocumentUnderstandingAgent, A9CommunicationAgent, A10KnowledgeAgent,
    A11AuditAgent,
  ],
  exports: [OrchestratorService, A8DocumentUnderstandingAgent],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly orch: OrchestratorService,
    private readonly a1: A1MeetingQualityAgent,
    private readonly a2: A2InternalRejectAgent,
    private readonly a3: A3ManufacturerRejectAgent,
    private readonly a4: A4SalesProductionAgent,
    private readonly a5: A5EmployerAllocationAgent,
    private readonly a6: A6TerminationAgent,
    private readonly a7: A7CollectionAgent,
    private readonly a8: A8DocumentUnderstandingAgent,
    private readonly a9: A9CommunicationAgent,
    private readonly a10: A10KnowledgeAgent,
    private readonly a11: A11AuditAgent,
  ) {}

  onModuleInit(): void {
    for (const a of [this.a1, this.a2, this.a3, this.a4, this.a5, this.a6, this.a7, this.a8, this.a9, this.a10, this.a11]) {
      this.orch.register(a);
    }
  }
}
