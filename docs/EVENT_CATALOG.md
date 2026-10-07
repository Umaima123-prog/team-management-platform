# Event Catalog

**Status: implemented and live-verified (Phase 4).** The transactional
outbox, JetStream stream/consumer bootstrap, and the publisher relay
are real, verified by an automated real-local-NATS integration suite
AND by a live, end-to-end run against the real local app and real
Atlas outside the sandbox (13/13 checks - see `docs/TIMELOG.md` Phase
4/4a/4b/4c notes and `docs/DECISIONS.md` #11/#16). The subject list and envelope shape
below are the assignment's own documented contract (engineering
onboarding assignment PDF, section 8) - this file was updated to match
that exactly, superseding an earlier draft written before the full
assignment detail was available.

**Not yet implemented**: the Python consumer that actually processes
these events into `activity_projection`/`workload_projection`
(Phase 5). Phase 4 only provisions the durable consumer configuration
(`activity-insights-v1`) - nothing currently acknowledges or acts on
delivered messages.

## Subject naming convention

```
tm.v1.<eventType>
```

- `tm` - platform prefix.
- `v1` - subject/schema version. A breaking payload change gets a new
  subject version (`tm.v2....`) rather than silently changing what
  `v1` consumers already depend on.
- `<eventType>` - `<aggregate>.<event>`, aggregate singular
  lower_snake_case, event past-tense.

All of these subjects are published to the `TEAM_EVENTS` JetStream
stream (durable domain events), never Core NATS - see
`ARCHITECTURE.md`. `tm.query.v1.project_insights` (below) is the one
exception: a Core NATS request/reply subject, not a JetStream event,
and intentionally outside this versioning scheme.

## Canonical event envelope (schema version 1)

Every event published by the Management Service uses this envelope -
see `src/messaging/events/envelope.ts` (type),
`envelope-validator.ts` (validation, including schema-version
rejection), and `outbox.service.ts` (construction). `payload` is the
only part that varies per event type.

```json
{
  "eventId": "01J8X7K2QZR8N6V9S3T4W5Y6Z7",
  "eventType": "workitem.moved",
  "schemaVersion": 1,
  "occurredAt": "2026-10-06T10:15:00.000Z",
  "producer": "management-service",
  "workspaceId": "ws_123",
  "aggregate": { "type": "WorkItem", "id": "wi_456", "version": 7 },
  "correlationId": "req_abc",
  "causationId": "cmd_xyz",
  "actorId": "usr_789",
  "payload": { "projectId": "prj_1", "fromColumnId": "todo", "toColumnId": "doing", "rank": 2048 }
}
```

| Field | Type | Notes |
|---|---|---|
| `eventId` | string (ULID) | Globally unique. Set as the JetStream `Nats-Msg-Id` on publication (broker-level dedup) and is the future Python inbox's dedup key. |
| `eventType` | string | One of the documented values below; the subject is `tm.v1.<eventType>`. Unknown values are rejected before publication. |
| `schemaVersion` | integer | Always `1` today. A value other than `1` is rejected, not silently accepted. |
| `occurredAt` | string (ISO-8601, UTC) | When the change was committed in `management_db`, inside the same transaction as the outbox row. |
| `producer` | string | Always `"management-service"`. |
| `workspaceId` | string | The server-derived workspace (never client-supplied - see `ARCHITECTURE.md` "Request context / trust model"). |
| `aggregate` | `{ type, id, version }` | `version` is the aggregate's version *after* this change. |
| `correlationId` | string | Ties every event (and the HTTP command that produced it) from one originating request together. Propagated from `X-Correlation-Id` or generated server-side - see `src/common/context/correlation-id.middleware.ts`. |
| `causationId` | string or null | `eventId` of the event in the *same command* that this one is a direct consequence of, or `null` if this is the command's root fact. See "causationId chaining" below. |
| `actorId` | string | The user id who issued the command. |
| `payload` | object | Event-specific fields only - never a full document dump, never the aggregate's own id/workspaceId (already on the envelope), never secrets. |

### causationId chaining

A single command sometimes produces more than one fact - e.g.
`POST /api/projects` creates the project **and** assigns its team
**and** creates its default board, in one transaction. The first event
enqueued (`project.created`) is the root fact: `causationId: null`.
The other two (`project.team_assigned`, `board.created`) set
`causationId` to `project.created`'s `eventId`, making the chain
explicit rather than leaving consumers to infer "these happened
together" from timestamps alone. See `docs/DECISIONS.md`.

## Subject catalogue

All of these are implemented and published by the real domain command
flows below (Phase 4) - none are invented beyond the assignment's own
list.

| Subject | Producer | Emitted by | Payload (beyond envelope fields) |
|---|---|---|---|
| `tm.v1.team.created` | NestJS | `POST /api/teams` | `{ code, name }` |
| `tm.v1.team.member_added` | NestJS | `POST /api/teams/:teamId/members` | `{ userId, role }` |
| `tm.v1.project.created` | NestJS | `POST /api/projects` | `{ projectKey, name, teamId, ownerId }` |
| `tm.v1.project.team_assigned` | NestJS | `POST /api/projects` (at creation) and `PATCH /api/projects/:id` (whenever `teamId` actually changes) | `{ teamId, previousTeamId }` |
| `tm.v1.board.created` | NestJS | `POST /api/projects` (default-board creation) | `{ projectId, columns: [{ id, name, order }] }` |
| `tm.v1.workitem.created` | NestJS | `POST /api/projects/:projectId/items` | `{ issueKey, projectId, boardId, columnId, type, priority, assigneeId, reporterId, labels }` |
| `tm.v1.workitem.assigned` | NestJS | `POST /api/items/:itemId/assign` | `{ projectId, previousAssigneeId, assigneeId }` |
| `tm.v1.workitem.moved` | NestJS | `POST /api/items/:itemId/move` | `{ projectId, fromColumnId, toColumnId, rank }` |
| `tm.v1.workitem.updated` | NestJS | `PATCH /api/items/:itemId` | `{ projectId, changedFields, priority?, labels?, dueDate? }` - free-text fields (title/description/acceptanceNotes) are only named in `changedFields`, never their content |
| `tm.v1.workitem.archived` | NestJS | `POST /api/items/:itemId/archive` | `{ projectId, previousColumnId }` |

Mutations the assignment does **not** map to a subject (`PATCH
/api/teams/:id`, archive team, update/remove member role beyond add,
archive project) do not emit events - see `docs/DECISIONS.md` for why
this is a deliberate reading of the assignment's own Minimum API
surface table, not an oversight.

## TEAM_EVENTS stream

| Property | Value | Why |
|---|---|---|
| Name | `TEAM_EVENTS` | Assignment-mandated. |
| Subjects | `tm.v1.>` | Captures every subject above under one stream. |
| Storage | `file` | Survives container restarts (assignment-mandated for the local dev deployment). |
| Retention | `limits`, `max_age` 14 days, `discard: old`, no message/byte cap beyond the server's 10GB file-store limit | An explicit, documented choice (not an assignment-mandated duration) - see `src/messaging/jetstream/jetstream.config.ts`. 14 days comfortably covers this exercise's demo/replay needs while bounding local disk use. |
| `duplicate_window` | 2 hours | Broker-level `Nats-Msg-Id` dedup horizon, longer than the 2-minute default so a relay crash-and-restart within a normal operational window is still deduped server-side before falling back to the Python inbox (the actual correctness guarantee - see `docs/DECISIONS.md` #3/#4). |

Bootstrap (`StreamBootstrapService`) is idempotent: it creates the
stream if absent, leaves it untouched and logs a warning if an
existing stream's *structural* config (subjects/storage/retention)
differs, and only reconciles non-destructive fields (`max_age`,
`duplicate_window`, `discard`) if they've drifted.

**Live evidence** (not just the automated real-NATS integration suite
- an actual end-to-end run against the real local app and real Atlas,
outside the sandbox, `docs/TIMELOG.md` Phase 4c): a `POST /api/teams`
command's `tm.v1.team.created` outbox row was claimed and published by
the running relay to this stream at **sequence 44**, confirmed by two
independent readers agreeing on that exact sequence number - the
relay's own publish-acknowledgement log line, and a separate read-back
of the stored message.

## Durable consumer: `activity-insights-v1`

| Property | Value |
|---|---|
| Durable name | `activity-insights-v1` (assignment-mandated) |
| Type | Pull consumer (matches the assignment's "Durable pull consumer" topology row) |
| Ack policy | Explicit - a message is only acked after (future, Phase 5) inbox + projection writes succeed |
| Deliver policy | All - a fresh/rebuilt consumer replays full retained history, matching "replay into a clean projection" |
| Max deliveries | 5, with backoff `[1s, 5s, 30s, 2m]` | Bounded redelivery for a transient failure; after 5 attempts NATS stops redelivering and (Phase 5) the Python service is responsible for `processing_failures` |
| Ack wait | 30s |

Provisioned by Phase 4 (`StreamBootstrapService`), verified against a
real local server (`test/nats-integration.e2e-spec.ts`). The consumer
loop that actually fetches/processes/acks from it is Phase 5 - nothing
currently acknowledges a delivered message.

## Message-handling rules (implemented)

- **Validated before publication, and again by the relay right before
  it hits the wire.** An unsupported `schemaVersion` or unknown
  `eventType` throws `EnvelopeValidationError` and is never committed
  to the outbox / never retried if somehow already stored (classified
  non-retryable - see `src/messaging/relay/retry-policy.ts`).
- **`Nats-Msg-Id` = `eventId`** on every publish (via the client's
  `msgID` publish option), verified end-to-end against a real server
  in `test/nats-integration.e2e-spec.ts` (duplicate detection test).
- **Bounded retry with backoff**: retryable failures (NATS
  unavailable/timeout) get exponential backoff capped at 60s, up to 8
  attempts total, then become a terminal/operator-visible failure
  (`failedAt` set, `GET /health/ready` reports the count). Malformed
  events are terminal on the first attempt.
- **`correlationId` propagation**: HTTP request → `RequestContext` →
  outbox row → NATS headers (`X-Correlation-Id`) → structured relay/
  insights-client logs → (Phase 5) consumer logs and query replies.

## Core NATS subject (non-durable, request/reply)

| Subject | Caller | Responder | Notes |
|---|---|---|---|
| `tm.query.v1.project_insights` | NestJS BFF (`GET /api/projects/:projectId/insights`) | Python service (Phase 5 - stubbed in Phase 4 integration tests) | Core NATS, not JetStream (see `docs/DECISIONS.md` #2). Bounded timeout (`INSIGHTS_QUERY_TIMEOUT_MS`, default 2s), typed `pending`/`unavailable`/`not_ready` fallback - never blocks indefinitely. |
