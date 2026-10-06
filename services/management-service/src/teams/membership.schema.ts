import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export const TEAM_ROLES = ['OWNER', 'LEAD', 'MEMBER'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface MembershipDocument extends WorkspaceScoped {
  teamId: string;
  userId: string;
  role: TeamRole;
  // Memberships are removed, not archived like teams/projects - "remove
  // member" is a distinct, named operation from "archive team", so it
  // gets its own soft-delete marker rather than reusing archivedAt.
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
