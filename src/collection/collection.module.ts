import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';
import { DiscrepancyLifecycleService } from './discrepancy-lifecycle.service';

@Module({
  imports: [PersistenceModule],
  controllers: [CollectionController],
  providers: [DiscrepancyLifecycleService, CollectionService],
  exports: [CollectionService],
})
export class CollectionModule {}
