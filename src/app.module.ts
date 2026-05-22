import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentContextModule } from './agent-context/agent-context.module';
import { AgentsModule } from './agents/agents.module';
import { ApiModule } from './api/api.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CollectionModule } from './collection/collection.module';
import configuration from './config/configuration';
import { IngestionModule } from './ingestion/ingestion.module';
import { RejectsModule } from './rejects/rejects.module';
import { TerminationModule } from './termination/termination.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    IngestionModule,
    RejectsModule,
    TerminationModule,
    CollectionModule,
    AuthorizationModule,
    AuthModule,
    AgentContextModule,
    AgentsModule,
    ApiModule,
    HealthModule,
  ],
})
export class AppModule {}
