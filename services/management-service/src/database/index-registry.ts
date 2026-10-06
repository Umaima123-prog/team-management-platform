import { IndexDescription } from 'mongodb';

export interface CollectionIndexSpec {
  collection: string;
  indexes: IndexDescription[];
}

/**
 * Index bootstrap registry for management_db collections.
 *
 * Intentionally empty in Phase 2: no domain collections
 * (workspaces/users/teams/memberships/projects/boards/columns/work_items)
 * exist yet. When a later phase introduces one, it registers its
 * indexes here; IndexBootstrapService applies whatever is registered,
 * idempotently, on application bootstrap - it does not need to change.
 *
 * Example of what a future entry looks like (not active):
 *   {
 *     collection: 'work_items',
 *     indexes: [
 *       { key: { workspaceId: 1, boardId: 1 }, name: 'workspace_board_idx' },
 *     ],
 *   }
 */
export const INDEX_REGISTRY: CollectionIndexSpec[] = [];
