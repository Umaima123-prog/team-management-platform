import { Module } from '@nestjs/common';
import { BoardsModule } from '../boards/boards.module';
import { IdentityModule } from '../identity/identity.module';
import { ProjectsModule } from '../projects/projects.module';
import { TeamsModule } from '../teams/teams.module';
import { CountersRepository } from './counters.repository';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemsService } from './work-items.service';

@Module({
  imports: [IdentityModule, TeamsModule, ProjectsModule, BoardsModule],
  controllers: [WorkItemsController],
  providers: [WorkItemsRepository, CountersRepository, WorkItemsService],
  exports: [WorkItemsRepository],
})
export class WorkItemsModule {}
