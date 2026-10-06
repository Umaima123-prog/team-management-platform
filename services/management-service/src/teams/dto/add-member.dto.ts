import { IsIn, IsMongoId } from 'class-validator';
import { TEAM_ROLES, TeamRole } from '../membership.schema';

export class AddMemberDto {
  @IsMongoId()
  userId!: string;

  @IsIn(TEAM_ROLES)
  role!: TeamRole;
}
