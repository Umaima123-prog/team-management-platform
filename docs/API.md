# Management Service API (Phase 3)

Base URL: `http://localhost:3000` (local dev). All routes below return
JSON. All routes except `GET /health` and `GET /health/ready` require
the `X-Dev-User-Id` header - see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) ("Request context / trust
model") for why, and the management-service README for how to get a
real user id via `npm run seed`.

This document describes **only what is implemented in Phase 3**:
teams, memberships, projects, boards, work items. There is no
event publishing, no outbox, and no admin UI yet.

## Error envelope

Every error response (any 4xx/5xx) has this shape:

```json
{ "error": { "code": "CONFLICT", "message": "...", "details": {} } }
```

`details` is omitted when there's nothing beyond the message. Common
`code` values: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
`RATE_LIMITED` (429), `INTERNAL_ERROR` (500 - never includes internal
details).

## Optimistic concurrency

Every mutation on a versioned aggregate (team, project, work item)
requires `expectedVersion` in the body, matching the aggregate's
current `version`. A mismatch (someone else changed it first) returns
**409** with the real current version:

```json
{ "error": { "code": "CONFLICT", "message": "Resource has been modified since you last read it.", "details": { "currentVersion": 3 } } }
```

## Pagination

List endpoints that support it use an opaque cursor, not page
numbers:

```
GET /api/projects/:projectId/items?limit=25&cursor=<opaque>
```

Response: `{ "items": [...], "nextCursor": "<opaque>" | null }`. Pass
`nextCursor` back as `cursor` to get the next page; `null` means
there is no more data.

---

## Teams

### `POST /api/teams`

Creates a team; the caller becomes its first `OWNER`.

```json
// Request
{ "code": "PAY", "name": "Payments", "description": "Payments squad" }
```

```json
// 201 Response
{ "id": "66f...", "workspaceId": "...", "code": "PAY", "name": "Payments", "description": "Payments squad", "archivedAt": null, "version": 1, "createdAt": "...", "updatedAt": "..." }
```

Duplicate `code` in the same workspace -> 409.

### `GET /api/teams?includeArchived=false`

`{ "items": [ <team>, ... ] }`

### `GET /api/teams/:teamId`

Team plus its active members: `{ ...team, "members": [ <membership>, ... ] }`.

### `PATCH /api/teams/:teamId`

Requires `OWNER` or `LEAD`. Body: `{ "expectedVersion": 1, "name"?, "description"? }`.

### `POST /api/teams/:teamId/archive`

Requires `OWNER`. Body: `{ "expectedVersion": 1 }`. Soft-delete only -
`archivedAt` is set, the document is never removed.

### `POST /api/teams/:teamId/members`

Requires `OWNER` or `LEAD`. Body: `{ "userId": "...", "role": "MEMBER" }`
(`role` one of `OWNER` | `LEAD` | `MEMBER`). `userId` must be a user in
the same workspace (400 otherwise). Already an active member -> 409.

### `PATCH /api/teams/:teamId/members/:userId`

Requires `OWNER` or `LEAD`. Body: `{ "role": "LEAD" }`.

### `DELETE /api/teams/:teamId/members/:userId`

Requires `OWNER` or `LEAD`. Soft-removes the membership (`removedAt`
set) - re-adding the same user later reactivates that same record
rather than creating a duplicate.

---

## Projects

### `POST /api/projects`

```json
// Request
{ "projectKey": "PAY", "name": "Payments Platform", "ownerId": "...", "teamId": "..." }
```

`ownerId` and `teamId` must belong to the same workspace, and `teamId`
must not be archived (400 otherwise). Duplicate `projectKey` in the
workspace -> 409. Creating a project also creates its board (see
below) with the default columns.

### `GET /api/projects?includeArchived=false`, `GET /api/projects/:projectId`

Same shape as teams' list/view.

### `PATCH /api/projects/:projectId`

Body: `{ "expectedVersion": 1, "name"?, "description"?, "ownerId"?, "teamId"?, "startDate"?, "endDate"? }`.
Changing `ownerId`/`teamId` re-validates the same-workspace/not-archived rules.

### `POST /api/projects/:projectId/archive`

Body: `{ "expectedVersion": 1 }`.

---

## Board

### `GET /api/projects/:projectId/board`

```json
{
  "id": "...", "projectId": "...", "version": 1,
  "columns": [
    { "id": "c1", "name": "Backlog", "order": 0, "wipLimit": null },
    { "id": "c2", "name": "To Do", "order": 1, "wipLimit": null },
    { "id": "c3", "name": "In Progress", "order": 2, "wipLimit": null },
    { "id": "c4", "name": "Review", "order": 3, "wipLimit": null },
    { "id": "c5", "name": "Done", "order": 4, "wipLimit": null }
  ]
}
```

There is no API to add/remove/reorder columns in Phase 3 - only the
default set created with the project.

---

## Work items

### `POST /api/projects/:projectId/items`

```json
// Request
{ "type": "BUG", "priority": "HIGH", "title": "Checkout fails on retry", "assigneeId": "...", "labels": ["checkout"] }
```

- `issueKey` is generated automatically (`<projectKey>-<n>`, e.g.
  `PAY-104`) from an atomic per-project counter - never client-supplied,
  never reused.
- `columnId` defaults to the board's first column (lowest `order`) if
  omitted.
- `reporterId` defaults to the caller if omitted; either way it must
  be a user in the same workspace.
- `assigneeId`, if given, must be an active member of the project's
  owning team (400 otherwise).

```json
// 201 Response
{ "id": "...", "issueKey": "PAY-104", "projectId": "...", "boardId": "...", "columnId": "...", "rank": 1024, "type": "BUG", "priority": "HIGH", "title": "...", "assigneeId": "...", "labels": ["checkout"], "archivedAt": null, "version": 1, ... }
```

### `GET /api/projects/:projectId/items`

Query params: `assigneeId`, `priority`, `type`, `label`, `q` (free-text
over title/description), `cursor`, `limit` (default 25, max 100),
`includeArchived` (`"true"`/`"false"`).

### `GET /api/items/:itemId`

### `PATCH /api/items/:itemId`

Body: `{ "expectedVersion": 1, "title"?, "description"?, "type"?, "priority"?, "labels"?, "dueDate"?, "acceptanceNotes"? }`.
Does not change `columnId`/`rank` - use `/move` for that.

### `POST /api/items/:itemId/assign`

Body: `{ "expectedVersion": 1, "assigneeId": "..." }` (omit or `null`
to unassign). Same owning-team-membership rule as creation.

### `POST /api/items/:itemId/move`

```json
{ "expectedVersion": 1, "targetColumnId": "c3", "beforeItemId": "...", "afterItemId": "..." }
```

Moves the item to `targetColumnId`, positioned between `beforeItemId`
and `afterItemId` (either/both may be omitted - omit both to move to
the end of the column, omit `beforeItemId` to move to the top). Rank is
computed deterministically (midpoint of the two neighbors' ranks,
rebalancing the column automatically if ranks have become too dense to
split further). Backend-only - no drag/drop UI exists yet.

### `POST /api/items/:itemId/archive`

Body: `{ "expectedVersion": 1 }`. Soft-delete only.
