import 'reflect-metadata';
import { ROLES_KEY } from './roles.decorator';
import { TeamsController } from '../teams/teams.controller';
import { ProjectsController } from '../projects/projects.controller';
import { WorkItemsController } from '../work-items/work-items.controller';

/**
 * A direct, fast check of the actual authorization policy declared on
 * every mutating route - the thing RolesGuard enforces at runtime
 * (roles.guard.spec.ts proves the guard's own mechanics; this proves
 * the policy it was handed matches what the assignment specifies for
 * each real endpoint, not just "the guard works in the abstract").
 * Reads metadata the exact same way Reflector/RolesGuard does -
 * `Reflect.getMetadata(ROLES_KEY, Controller.prototype.method)`.
 */
function rolesFor(target: object, methodName: string): string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (target as any)[methodName] as object;
  return Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
}

describe('RBAC policy: ADMIN-only mutations', () => {
  it.each([
    ['TeamsController', TeamsController, 'create'],
    ['TeamsController', TeamsController, 'update'],
    ['TeamsController', TeamsController, 'archive'],
    ['TeamsController', TeamsController, 'addMember'],
    ['TeamsController', TeamsController, 'updateMemberRole'],
    ['TeamsController', TeamsController, 'removeMember'],
    ['ProjectsController', ProjectsController, 'create'],
    ['ProjectsController', ProjectsController, 'update'],
    ['ProjectsController', ProjectsController, 'archive'],
    ['WorkItemsController', WorkItemsController, 'create'],
    ['WorkItemsController', WorkItemsController, 'assign'],
    ['WorkItemsController', WorkItemsController, 'archive'],
  ])('%s.%s requires ADMIN', (_label, controller, method) => {
    expect(rolesFor(controller.prototype, method as string)).toEqual(['ADMIN']);
  });
});

describe('RBAC policy: open to any authenticated role (EMPLOYEE included)', () => {
  it.each([
    ['TeamsController', TeamsController, 'list'],
    ['TeamsController', TeamsController, 'get'],
    ['ProjectsController', ProjectsController, 'list'],
    ['ProjectsController', ProjectsController, 'get'],
    ['ProjectsController', ProjectsController, 'insights'],
    ['ProjectsController', ProjectsController, 'activity'],
    // The core "doing my work" actions - an EMPLOYEE must be able to
    // move cards on the board and edit a work item's own fields
    // without being an ADMIN.
    ['WorkItemsController', WorkItemsController, 'list'],
    ['WorkItemsController', WorkItemsController, 'get'],
    ['WorkItemsController', WorkItemsController, 'update'],
    ['WorkItemsController', WorkItemsController, 'move'],
  ])('%s.%s has no @Roles() restriction', (_label, controller, method) => {
    expect(rolesFor(controller.prototype, method as string)).toBeUndefined();
  });
});
