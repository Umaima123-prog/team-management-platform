import { WorkspaceScoped } from '../database/workspace-scoped.repository';

/** Workspace-wide authorization role (distinct from a team's own
 * OWNER/LEAD/MEMBER membership role in membership.schema.ts - that is
 * a per-team business concept; this is the coarser "what can this
 * person do in this workspace at all" gate RolesGuard enforces). */
export const USER_ROLES = ['ADMIN', 'EMPLOYEE'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserDocument extends WorkspaceScoped {
  name: string;
  email: string;
  /** bcrypt hash - never the plaintext password, never logged. */
  passwordHash: string;
  role: UserRole;
  /** A deactivated user can no longer log in or authenticate an
   * existing session - RequestContextGuard re-checks this on every
   * request, not just at login. */
  active: boolean;
  /** Bumped on logout/password change to invalidate every refresh
   * token issued before that point, without needing a separate
   * token-blacklist collection - see auth.service.ts. */
  tokenVersion: number;
  createdAt: Date;
}
