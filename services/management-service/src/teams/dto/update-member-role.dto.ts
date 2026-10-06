import { IsIn } from 'class-validator';
import { TEAM_ROLES, TeamRole } from '../membership.schema';

export class UpdateMemberRoleDto {
  @IsIn(TEAM_ROLES)
  role!: TeamRole;
}
