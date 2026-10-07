# Management Service API (Phase 6)

Base URL: `http://localhost:3000` (local dev). All routes below return
JSON. All routes except `GET /health` and `GET /health/ready` require
the `X-Dev-User-Id` header - see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) ("Request context / trust
model") for why, and the management-service README for how to get a
real user id via `npm run seed`. Every request/response also carries
`X-Correlation-Id` (accepted if you supply a valid one, generated
otherwise) - see "Correlation / observability" in `ARCHITECTURE.md`.

CORS is enabled (Phase 6, for the `admin-ui/` browser app) for an
explicit, configurable origin allow-list only - never a wildcard - see
`ADMIN_UI_ORIGIN` in `.env.example` and `src/main.ts`.

This document describes **Phase 3's REST surface (teams, memberships,
projects, boards, work items) plus Phase 4/5's messaging additions**
(`GET /api/projects/:projectId/insights` and
`GET /api/projects/:projectId/activity`, both now backed by the real
Python Activity & Insights Service - see docs/ARCHITECTURE.md "Python
inbox and projections") **plus Phase 6's admin-UI-driven additions**
(`GET /api/users`, CORS). Each mutating endpoint below now also
durably records the documented domain fact in the transactional
outbox for asynchronous publication - see
[`docs/EVENT_CATALOG.md`](EVENT_CATALOG.md) for exactly which endpoint
emits which event.

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

## Users

### `GET /api/users` (Phase 3 scaffold, documented in Phase 6)

Read-only, workspace-scoped. Implemented since Phase 3
(`src/identity/`) for exactly this purpose - populating assignee/
reporter/member pickers in the future admin UI - but was not yet
documented here until Phase 6 actually built that UI. No create/
update/delete routes exist for users (seed-only - `npm run seed` - per
`docs/ARCHITECTURE.md`'s Phase 3 scope).

```json
// 200 Response
{ "items": [ { "id": "...", "workspaceId": "...", "name": "Alice Owner", "email": "alice@example.test", "createdAt": "..." } ] }
```

Sorted by `name`. Scoped to the caller's own workspace, same as every
other list endpoint - never accepts a client-supplied `workspaceId`.

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

### `GET /api/projects/:projectId/insights` (Phase 4/5)

Synchronous project insights, backed by Core NATS request/reply to the
real Python Activity & Insights Service. 404 if the project doesn't
exist in this workspace; otherwise always **200** with a typed
`status`:

```json
// status: "ok"
{ "status": "ok", "data": { "projectId": "...", "generatedAt": "...", "workloadByAssignee": [{"assigneeId": "..." , "count": 1}], "countsByStatus": [{"columnId": "...", "count": 1}], "workloadByPriority": [{"priority": "HIGH", "count": 1}], "lastProcessedSequence": 42 } }
```
```json
// status: "not_ready" - responder is up but has no projection data for this project yet (e.g. events haven't propagated yet, or a workspace mismatch)
{ "status": "not_ready", "reason": "NO_DATA_YET_FOR_PROJECT" }
```
```json
// status: "pending" - responder is subscribed but didn't reply within INSIGHTS_QUERY_TIMEOUT_MS
{ "status": "pending", "reason": "TIMEOUT" }
```
```json
// status: "unavailable" - nothing is listening on the query subject (the Python service is down), NATS itself is unreachable, or the reply was malformed
{ "status": "unavailable", "reason": "NO_RESPONDER" }
```

`workloadByPriority` is additive beyond the assignment's own named
fields (`workloadByAssignee`/`countsByStatus`) - present whenever
`status` is `"ok"`, safe to ignore if unused. Never blocks indefinitely
(bounded by `INSIGHTS_QUERY_TIMEOUT_MS`, default 2000ms) and never
500s for these states - see `docs/ARCHITECTURE.md` "Core NATS
request/reply" and TM-12.

### `GET /api/projects/:projectId/activity` (Phase 6)

The project's real, asynchronously-built activity timeline (the admin
UI's Activity screen), proxied over Core NATS request/reply to the
same Python service, mirroring `insights` above exactly - same 404
rule, same always-200-with-typed-status contract, same bounded
timeout:

```json
// status: "ok"
{ "status": "ok", "data": { "projectId": "...", "generatedAt": "...", "entries": [{ "eventId": "...", "eventType": "workitem.moved", "aggregateType": "WorkItem", "aggregateId": "...", "actorId": "...", "occurredAt": "..." }], "lastProcessedSequence": 42 } }
```
```json
// status: "not_ready" | "pending" | "unavailable" - identical shape/reasons to insights above
{ "status": "not_ready", "reason": "NO_DATA_YET_FOR_PROJECT" }
```

`entries` is newest-first (most recent activity at index 0), capped at
50 by default (bounded, not paginated - a dev-tool-scale view, not an
audit log replacement).

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
