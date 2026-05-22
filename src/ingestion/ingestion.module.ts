import { Module } from '@nestjs/common';
import { ParserFactory } from '../mevne-ahid/parser.factory';
import { PersistenceModule } from '../persistence/persistence.module';
import { RejectsModule } from '../rejects/rejects.module';
import { TerminationModule } from '../termination/termination.module';
import { AgentContextModule } from '../agent-context/agent-context.module';
import { FileWatcherService } from './file-watcher.service';
import { ValidationService } from '../validation/validation.service';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { PostProcessService } from './post-process.service';
import { VaultService } from './vault.service';

@Module({
  imports: [PersistenceModule, RejectsModule, TerminationModule, AgentContextModule],
  controllers: [IngestionController],
  providers: [
    ParserFactory,
    ValidationService,
    VaultService,
    PostProcessService,
    IngestionService,
    FileWatcherService,
  ],
  exports: [IngestionService, FileWatcherService],
})
export class IngestionModule {}
