import { IndexDescription } from 'mongodb';

export interface CollectionIndexSpec {
  collection: string;
  indexes: IndexDescription[];
}

/**
 * Index bootstrap registry for management_db collections. Applied
 * idempotently on every application bootstrap by IndexBootstrapService
 * - this file only declares *what* indexes should exist.
 *
 * Phase 3 introduces the first domain collections (users, teams,
 * memberships, projects, boards, work_items, counters) - see
 * docs/ARCHITECTURE.md for collection ownership and
 * docs/DECISIONS.md for why each uniqueness constraint exists.
 */
export const INDEX_REGISTRY: CollectionIndexSpec[] = [
  {
    collection: 'users',
    indexes: [
      { key: { workspaceId: 1 }, name: 'workspace_idx' },
      { key: { workspaceId: 1, email: 1 }, name: 'workspace_email_unique', unique: true },
    ],
  },
  {
    collection: 'teams',
    indexes: [
      { key: { workspaceId: 1, code: 1 }, name: 'workspace_code_unique', unique: true },
      { key: { workspaceId: 1, archivedAt: 1 }, name: 'workspace_archived_idx' },
    ],
  },
  {
    collection: 'memberships',
    indexes: [
      // "unique teamId + userId membership" - scoped to ACTIVE
      // memberships only (partial index) so a removed-then-re-added
      // member doesn't collide with their own history.
      {
        key: { teamId: 1, userId: 1 },
        name: 'active_team_user_unique',
        unique: true,
        partialFilterExpression: { removedAt: null },
      },
      { key: { workspaceId: 1, teamId: 1 }, name: 'workspace_team_idx' },
      { key: { workspaceId: 1, userId: 1 }, name: 'workspace_user_idx' },
    ],
  },
  {
    collection: 'projects',
    indexes: [
      { key: { workspaceId: 1, projectKey: 1 }, name: 'workspace_project_key_unique', unique: true },
      { key: { workspaceId: 1, teamId: 1 }, name: 'workspace_team_idx' },
      { key: { workspaceId: 1, archivedAt: 1 }, name: 'workspace_archived_idx' },
    ],
  },
  {
    collection: 'boards',
    indexes: [
      { key: { workspaceId: 1, projectId: 1 }, name: 'workspace_project_unique', unique: true },
    ],
  },
  {
    collection: 'work_items',
    indexes: [
      { key: { workspaceId: 1, issueKey: 1 }, name: 'workspace_issue_key_unique', unique: true },
      // Stable keyset-pagination index: filtering by (workspaceId,
      // projectId) and sorting/paginating by _id is served directly by
      // this compound index, with no in-memory sort.
      { key: { workspaceId: 1, projectId: 1, _id: 1 }, name: 'workspace_project_id_idx' },
      // Column ordering (maxRankInColumn / listColumnOrdered / move).
      { key: { workspaceId: 1, boardId: 1, columnId: 1, rank: 1 }, name: 'board_column_rank_idx' },
      // Filtering.
      { key: { workspaceId: 1, projectId: 1, assigneeId: 1 }, name: 'project_assignee_idx' },
      { key: { workspaceId: 1, projectId: 1, priority: 1 }, name: 'project_priority_idx' },
      { key: { workspaceId: 1, projectId: 1, type: 1 }, name: 'project_type_idx' },
      { key: { workspaceId: 1, projectId: 1, labels: 1 }, name: 'project_labels_idx' },
      // Free-text search over title/description (the `q` filter).
      { key: { title: 'text', description: 'text' }, name: 'title_description_text_idx' },
    ],
  },
  {
    // The transactional outbox (Phase 4) - see docs/ARCHITECTURE.md
    // "Transactional outbox" and src/messaging/outbox/.
    collection: 'outbox_events',
    indexes: [
      // "unique eventId" - the assignment-required dedup/uniqueness
      // guarantee for the outbox's own primary business key (distinct
      // from the Mongo _id).
      { key: { eventId: 1 }, name: 'event_id_unique', unique: true },
      // "efficient unpublished-event lookup using publishedAt / retry
      // fields" - serves OutboxRelayService.claimBatch's equality
      // filter (publishedAt: null, failedAt: null) and its
      // `sort: { occurredAt: 1 }` directly from the index.
      {
        key: { publishedAt: 1, failedAt: 1, occurredAt: 1 },
        name: 'unpublished_lookup_idx',
      },
    ],
  },
];
