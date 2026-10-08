import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../identity/user.schema';

export const ROLES_KEY = 'roles';

/**
 * Declares which workspace-wide role(s) may call this route - the
 * single, centralized place authorization requirements are declared,
 * rather than scattered `if (ctx.role !== 'ADMIN') throw ...` checks
 * repeated across controllers. Enforced by RolesGuard (a global
 * APP_GUARD, runs after RequestContextGuard has already established a
 * verified identity). A route with no `@Roles(...)` is reachable by
 * any authenticated role - most read endpoints are intentionally left
 * that way (see docs/DECISIONS.md for the exact per-route policy).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
