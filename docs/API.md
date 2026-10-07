# Management Service API (Phase 4)

Base URL: `http://localhost:3000` (local dev). All routes below return
JSON. All routes except `GET /health` and `GET /health/ready` require
the `X-Dev-User-Id` header - see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) ("Request context / trust
model") for why, and the management-service README for how to get a
real user id via `npm run seed`. Every request/response also carries
`X-Correlation-Id` (accepted if you supply a valid one, generated
otherwise) - see "Correlation / observability" in `ARCHITECTURE.md`.

This document describes **Phase 3's REST surface (teams, memberships,
projects, boards, work items) plus Phase 4's messaging additions**
(the `GET /api/projects/:projectId/insights` query endpoint and
extended `GET /health/ready` diagnostics). Each mutating endpoint below
now also durably records the documented domain fact in the
transactional outbox for asynchronous publication - see
[`docs/EVENT_CATALOG.md`](EVENT_CATALOG.md) for exactly which endpoint
emits which event. There is no admin UI yet, and no Python-side
projection/insights data yet (Phase 5) - the insights endpoint always
returns a typed `pending`/`unavailable`/`not_ready` response until a
real responder exists.

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

## Health

### `GET /health`

Liveness only - never touches MongoDB or NATS: `{ "status": "ok", "service": "management-service" }`.

### `GET /health/ready`

200 or 503, gated on MongoDB connectivity only (see
`docs/DECISIONS.md` #13 for why NATS doesn't gate this too):

```json
{
  "status": "ok",
  "database": "management_db",
  "messaging": {
    "natsConnected": true,
    "jetstreamReady": true,
    "unpublishedOutboxCount": 0,
    "failedOutboxCount": 0
  }
}
```

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

### `GET /api/projects/:projectId/insights` (Phase 4)

Synchronous project insights, backed by Core NATS request/reply to the
Activity & Insights Service (not implemented yet - Phase 5). 404 if
the project doesn't exist in this workspace; otherwise always **200**
with a typed `status`:

```json
// status: "ok" (once a real Python responder exists)
{ "status": "ok", "data": { "projectId": "...", "generatedAt": "...", "workloadByAssignee": [...], "countsByStatus": [...], "lastProcessedSequence": 42 } }
```
```json
// status: "not_ready" - responder exists but projection isn't caught up yet
{ "status": "not_ready", "reason": "..." }
```
```json
// status: "pending" - responder is subscribed but didn't reply within INSIGHTS_QUERY_TIMEOUT_MS
{ "status": "pending", "reason": "TIMEOUT" }
```
```json
// status: "unavailable" - nothing is listening on the query subject (today's state - Phase 5 responder doesn't exist yet), or NATS itself is unreachable, or the reply was malformed
{ "status": "unavailable", "reason": "NO_RESPONDER" }
```

Never blocks indefinitely (bounded by `INSIGHTS_QUERY_TIMEOUT_MS`,
default 2000ms) and never 500s for these states - see
`docs/ARCHITECTURE.md` "Core NATS request/reply" and TM-12.

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
