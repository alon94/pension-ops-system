import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { Form161LifecycleService } from './form-161-lifecycle.service';
import { TerminationController } from './termination.controller';
import { TerminationLifecycleService } from './termination-lifecycle.service';
import { TerminationService } from './termination.service';

@Module({
  imports: [PersistenceModule],
  controllers: [TerminationController],
  providers: [TerminationLifecycleService, Form161LifecycleService, TerminationService],
  exports: [TerminationService],
})
export class TerminationModule {}
