import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MembershipsRepository } from './memberships.repository';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

@Module({
  imports: [IdentityModule],
  controllers: [TeamsController],
  providers: [TeamsRepository, MembershipsRepository, TeamsService],
  exports: [TeamsRepository, MembershipsRepository, TeamsService],
})
export class TeamsModule {}
