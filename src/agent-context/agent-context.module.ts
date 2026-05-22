import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { AgentContextController } from './agent-context.controller';
import { AgentContextService } from './agent-context.service';
import { EmbeddingProvider } from './embedding.provider';
import { LlmProvider } from './llm.provider';

@Module({
  imports: [PersistenceModule],
  controllers: [AgentContextController],
  providers: [EmbeddingProvider, LlmProvider, AgentContextService],
  exports: [AgentContextService],
})
export class AgentContextModule {}
