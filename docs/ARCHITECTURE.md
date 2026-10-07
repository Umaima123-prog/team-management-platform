# Architecture

## Implementation status (read this first)

This document describes the **target architecture** for the Team
Management Platform. As of Phase 5, the following exist:

- **Messaging reliability** (Phase 4): the transactional outbox
  (`outbox_events` collection in `management_db`, written inside the
  same MongoDB session/transaction as the authoritative domain
  mutation), a background publisher relay that publishes unpublished
  outbox rows to the real `TEAM_EVENTS` JetStream stream and marks
  them published only after a genuine publish acknowledgement,
  bounded-retry/backoff failure handling with an operator-visible
  terminal-failure path, a correlation-id middleware/guard, a `GET
  /api/projects/:projectId/insights` BFF endpoint backed by Core NATS
  request/reply with a bounded timeout and typed fallback, and
  extended `GET /health/ready` diagnostics. See "Transactional
  outbox", "JetStream", "Outbox publisher relay", and "Core NATS
  request/reply" below for the real (not target) shape of each, and
  `docs/EVENT_CATALOG.md` for the exact subjects now emitted by which
  Phase 3 commands.
- **Event consumption and projections** (Phase 5): the Python
  Activity & Insights Service now binds to the `activity-insights-v1`
  durable consumer and actually processes delivered events - inbox
  deduplication, version-gated `item_state` tracking, the
  `activity_projection` and `workload_projection` collections, bounded
  retry for transient Mongo failures, a poison path
  (`processing_failures`) for malformed/unsupported events, a real
  `tm.query.v1.project_insights` Core NATS responder, consumer-state
  health reporting, and a replay script. See "Python inbox and
  projections" below for the real (not target) shape, and the Phase 5
  section of `docs/TIMELOG.md` for the automated-test and live-run
  evidence.

- Repository/service skeletons (NestJS management-service, Python
  activity-insights-service) with no business logic.
- Docker Compose for local NATS with JetStream enabled, verified
  running: `/healthz` returns `ok`, `/jsz` confirms JetStream is active
  (file-backed, 1GB memory / 10GB storage limits per
  `docker/nats/nats-server.conf`), the `tm-nats-jetstream-data` volume
  is correctly mounted at `/data/jetstream`, and startup logs show no
  errors. As of Phase 4, the `TEAM_EVENTS` stream and the
  `activity-insights-v1` durable consumer exist on this server (created
  idempotently by `StreamBootstrapService` on app boot) and real
  events are being published to it - see "JetStream" below.
- **MongoDB persistence foundation** (Phase 2): each service connects
  to its own Atlas database via a driver client built entirely from
  environment variables (no hardcoded URI anywhere - see
  `docs/DECISIONS.md` #6). Neither service's app code connects eagerly
  at boot; the driver connects lazily on first real operation.
  - Management Service: `DatabaseModule` (`src/database/`) provides
    the Mongo client/`Db` to the rest of the app, `DatabaseService.ping()`
    backs `GET /health/ready` (200/503), `IndexBootstrapService` applies
    an (currently empty) index registry on startup, and
    `WorkspaceScopedRepository` is the base every future domain
    repository will extend. No domain repository exists yet.
  - Activity & Insights Service: `db.py` provides `get_client`/`get_database`/
    `ping`, refusing to start if `MONGODB_DB_NAME` is ever anything
    other than `insights_db`. `health_app.py` (FastAPI) exposes
    `GET /healthz` (liveness) and `GET /readyz` (200/503, backed by
    `ping`), and runs `index_bootstrap.bootstrap_indexes()` on startup,
    which today only creates the inbox's unique index on `event_id`.
    `main.py` runs this app via uvicorn - it is the service's only
    runtime entrypoint so far.
  - **Live Atlas verification status: PASSED.** Both services were
    started against the real Atlas cluster with real local `.env`
    files. `GET /health` / `GET /health/ready` (Management Service) and
    `GET /healthz` / `GET /readyz` (Activity & Insights Service) all
    return 200, each reporting its own correctly-scoped database name
    (`management_db` / `insights_db`). The Python service's inbox
    index bootstrap also completed successfully (write access
    confirmed, not just read). An earlier run hit an Atlas
    authentication rejection, root-caused and resolved on the
    credentials side (not a code change) - see `docs/TIMELOG.md`
    Phase 2b/2c notes for the full history.
- **Business domain + REST API** (Phase 3): the authoritative
  Management Service domain is implemented - workspaces/users
  (seed-only, no CRUD API), teams + memberships + roles, projects, one
  Kanban board per project, and Jira-like work items, all behind
  optimistic concurrency and a real request-context/trust mechanism.
  See "Business domain" and "Request context / trust model" below for
  the full picture, and `docs/API.md` for every route with
  request/response examples. `npm run seed` creates one development
  workspace + a few users.
- This documentation set.

As of Phase 5, domain writes land in `management_db` **and** produce
durable, versioned, correlation-tracked facts on the real local
JetStream server - see "Transactional outbox" / "JetStream" / "Outbox
publisher relay" below - **and** those facts are now actually consumed
and projected into `insights_db` by the Python service - see "Python
inbox and projections" below. What remains not implemented: **the
AdminLTE UI** (Phase 6). Each later phase that implements a piece of
this design must update this file so it keeps describing the current
implementation, not just the plan.

## Service ownership

Two services, two databases, no shared collections.

### Management Service (NestJS + TypeScript)

Owns, and is the only writer of, `management_db`. Collections that
exist today (Phase 4): `workspaces`, `users`, `teams`, `memberships`,
`projects`, `boards` (columns are embedded in the board document, not
a separate collection), `work_items`, `counters` (the atomic
issue-key sequence generator - see "Business domain" below), and
`outbox_events` (the transactional outbox - see "Transactional
outbox" below).

It is the system of record for all business/domain state and the only
service that accepts write commands for that state.

### Activity & Insights Service (Python 3.12+)

Owns, and is the only writer of, `insights_db`:

- `inbox` (event deduplication records)
- `activity_projection`
- `workload_projection`
- `processing_failures`

It never writes to `management_db`, and never queries Management
Service collections directly - not even read-only. Everything it knows
about workspaces/teams/projects/work items arrives exclusively through
domain events it consumes from JetStream.

### Trust boundary

The only sanctioned integration points between the two services are:

1. Domain events published by Management Service onto JetStream and
   consumed by the Python service (durable, asynchronous).
2. Core NATS request/reply, where the Python service answers insight
   queries (e.g. "activity summary for workspace X") for callers such
   as the Management Service or the admin UI.

There is no shared database, no shared ORM/driver connection, and no
synchronous HTTP call from Python into Management Service or vice
versa for domain data. Each service's MongoDB credentials are scoped
to its own database only.

## Request context / trust model

There is no real authentication system in Phase 3 - that is a
deliberate, documented scope cut (building one was explicitly out of
scope for this phase), not an oversight. Instead, every request
(except `GET /health` and `GET /health/ready`) must carry an
`X-Dev-User-Id` header naming a real user id. `RequestContextGuard`
(a global `APP_GUARD`, `src/common/context/`) looks that user up by
`_id` and derives `{ userId, workspaceId }` - the `RequestContext` -
from **the user's own stored `workspaceId`**, not from anything the
client sent. Missing, malformed, or unknown ids get a 401 before the
guard ever reaches a controller.

This is the mechanism that makes "do not trust workspaceId supplied
arbitrarily by the browser" actually true rather than aspirational:
there is no `workspaceId` field anywhere in any request body or query
string that any service method reads. `WorkspaceScopedRepository`
(Phase 2) then takes that server-derived `workspaceId` and folds it
into every query, so a client cannot widen or escape its own
workspace's data by any input it controls.

The honest limitation: `X-Dev-User-Id` is exactly what it says -
anyone who knows or guesses a user id can act as that user. This is
acceptable for a development/demo phase with no real end users, and
is why this is documented here instead of left implicit. Replacing it
with real authentication (sessions/JWT) means swapping only
`RequestContextGuard`'s header lookup for a token-verification step -
`RequestContext` and everything built on it (every repository, every
service) does not need to change.

## Business domain (Phase 3)

The authoritative domain, in creation/dependency order:

- **Teams**: `code` unique per workspace, `name`, `description`,
  `archivedAt` (soft-delete only - never hard-deleted), `version`.
  Creating a team makes the creator its first `OWNER` via a
  **membership** (`teamId`+`userId`, `role` one of `OWNER`/`LEAD`/
  `MEMBER`, unique while active - a partial unique index scoped to
  `removedAt: null` so a removed-then-re-added member reactivates
  their old record instead of colliding with it). Only `OWNER`/`LEAD`
  may add/remove members or change roles or update team details; only
  `OWNER` may archive the team.
- **Projects**: `projectKey` unique per workspace, `ownerId` and
  `teamId` validated to belong to the *same* workspace (and `teamId`
  must not be archived) before the project is created - this is the
  concrete enforcement of "reject cross-workspace references."
  Creating a project also creates its board (next).
- **Boards**: exactly one per project (`projectId` unique), created
  with five default columns (Backlog, To Do, In Progress, Review,
  Done), each an embedded `{ id, name, order, wipLimit }`. No
  column-management API exists yet - only the defaults.
- **Work items**: Jira-like, with an **immutable, never-reused**
  `issueKey` (`<projectKey>-<n>`) generated from an atomic per-project
  counter (`counters` collection, `$inc` + upsert - a single atomic
  MongoDB operation, so concurrent creations can never collide, and
  because the counter only ever increments, a key is never reissued
  even after its item is archived). `assigneeId`, if set, must be an
  active member of the project's owning team; `reporterId` (defaults
  to the caller) must be a workspace user. Ordering within a column is
  a sparse numeric `rank` (gap of 1024 between items) with midpoint
  insertion for moves - see `src/work-items/rank.util.ts` for the
  documented limitation (rebalancing) and why it's an acceptable
  simplification for a backend-only move API with no drag/drop UI yet.

Every list endpoint that needs to scale uses opaque cursor (keyset)
pagination on `_id`, not offset/skip - see `docs/API.md`.

## Command flow (implemented, Phase 4)

1. A client issues a write command to the Management Service (e.g.
   `POST /api/teams`).
2. The Management Service validates the command (membership-role
   checks, cross-workspace reference checks, etc. - all outside the
   transaction, read-only) and then, in a single MongoDB session
   transaction (`DatabaseService.withTransaction`):
   - applies the change to the owning aggregate (with an optimistic
     concurrency check - see below), and
   - builds and validates a canonical event envelope and inserts it
     into `outbox_events` (`OutboxService.enqueue`, see
     `docs/EVENT_CATALOG.md`).
3. The HTTP response returns once the transaction commits. The caller
   gets a definitive success/failure answer without waiting on NATS -
   if either the aggregate write or the outbox insert fails, both roll
   back together; there is no window where one happened without the
   other.
4. `OutboxRelayService` (part of the Management Service, polling every
   `OUTBOX_RELAY_INTERVAL_MS`, default 1s) atomically claims unpublished
   rows, publishes each to the `TEAM_EVENTS` JetStream stream with
   `Nats-Msg-Id` set to the event's `eventId`, waits for a real publish
   acknowledgement, and only then marks the row published.
5. The Python service's durable JetStream consumer
   (`activity-insights-v1`, provisioned in Phase 4, consumed from
   Phase 5) receives the event, persists an inbox record keyed by
   `(eventId, consumer)`, applies the projection update, and only then
   acknowledges the message - see "Python inbox and projections".

Steps 4-5 are asynchronous relative to step 3: callers see transactional
consistency for their own write, and everyone else sees the effect of
that write only after the event has propagated (eventual consistency).
Step 5 is not yet implemented - see "Implementation status" above.

## Transactional outbox

Mongo transactions are per-database, so "write the aggregate and emit
an event" cannot be a single operation spanning the database and NATS.
The outbox pattern makes it atomic within MongoDB instead: the aggregate
write and the outbox record are written in the same transaction
(`src/database/database.service.ts`'s `withTransaction`, used by
`TeamsService`/`ProjectsService`/`WorkItemsService` for every command
that emits a documented fact - see `docs/EVENT_CATALOG.md`), so a
crash can never produce "state changed but no event" or "event queued
but state unchanged." See `docs/DECISIONS.md` #11: transaction support
on the configured Atlas deployment was first established structurally
(replica-set topology evidence), then **confirmed by a live run** -
`POST /api/teams` against real Atlas produced a matching team document
and `outbox_events` row, cross-referenced consistently and committed
together, exactly as designed.

A separate relay (`src/messaging/relay/outbox-relay.service.ts`) then
has the simpler job of publishing outbox rows to JetStream
at-least-once (bounded retry with exponential backoff - see
`retry-policy.ts`), and marking them published **only after** a real
publish acknowledgement. If the relay crashes between publish and
marking-published, it republishes on restart - this is why consumers
must be idempotent (see below), and why this system never claims
exactly-once delivery (`docs/DECISIONS.md` #4). `OutboxRepository`
claims rows atomically (`findOneAndUpdate` with a claim lease), which
is also what keeps two concurrent relay ticks/instances from
double-publishing the same row.

Terminal (non-retryable, or retry-budget-exhausted) failures set
`failedAt`/`lastErrorCode` on the row and are never retried
automatically again; `GET /health/ready`'s `messaging.failedOutboxCount`
is the operator-visible signal for this (`MessagingHealthService`).

## JetStream (durable domain events)

All domain events that other services depend on for eventual
consistency are published to the `TEAM_EVENTS` JetStream stream
(`subjects: tm.v1.>`, file storage, see `docs/EVENT_CATALOG.md` for
the full retention/consumer configuration), not Core NATS. JetStream
gives:

- **Durability**: events persist even if the Python service is down
  when they're published.
- **Replay**: a new or rebuilt consumer (e.g. after fixing a projection
  bug) can replay history instead of losing it.
- **At-least-once delivery** with consumer acknowledgement, so a
  crashed consumer re-receives unacknowledged messages.

Subjects follow the `tm.v1.<eventType>` convention - see
`EVENT_CATALOG.md` for the full subject list and the canonical
envelope shape (both implemented, Phase 4). Stream and durable-consumer
bootstrap is idempotent (`StreamBootstrapService`, verified against a
real local server in `test/nats-integration.e2e-spec.ts`): it never
silently replaces a structurally different existing stream.

## Python inbox and projections (implemented, Phase 5)

Because JetStream delivery is at-least-once, the same event can arrive
more than once (consumer crash-and-redeliver, network retry, etc.). The
Python service (`services/activity-insights-service/src/activity_insights/`)
never trusts "I haven't seen this" from memory - instead:

1. On receiving an event (`messaging/consumer.py`'s `EventConsumer`,
   bound - never created - to the `activity-insights-v1` durable pull
   consumer on `TEAM_EVENTS`), the envelope is parsed and validated
   (`events/envelope.py`). A structurally invalid envelope, an
   unsupported `schemaVersion`, or an unrecognized `eventType` is
   non-retryable: it is recorded in `processing_failures` and acked
   immediately - retrying a malformed event can never succeed.
2. `inbox.repository.InboxRepository` checks for an existing
   `(event_id, consumer)` pair. If already present, the event is a
   duplicate - the projection is not reapplied, and the message is
   simply acked (idempotent no-op).
3. If not present, `messaging/processor.py`'s `EventProcessor` applies
   the projection update, the activity-log entry, the inbox record,
   and the consumer-state record **in one real MongoDB session
   transaction** (`AsyncIOMotorClientSession.with_transaction`) -
   all-or-nothing, the same guarantee `DatabaseService.withTransaction`
   gives the Management Service.
4. The event is acknowledged to JetStream **only after** that
   transaction commits. If it fails with a transient Mongo error
   (`messaging/errors.py` classifies this), the message is not acked;
   a few immediate in-process retries are attempted, then the broker
   redelivers (bounded by the consumer's own `max_deliver`). Once that
   bound is reached, the event is recorded in `processing_failures`
   (reason `REDELIVERY_EXHAUSTED`) and acked - never redelivered
   forever.
5. **Out-of-order/older events never overwrite newer projected
   state**: `projections/state.py`'s `ItemStateRepository` keeps one
   version-gated document per work-item aggregate (`item_state`,
   internal). It reads the current document first and only issues a
   write if the incoming `aggregate.version` is strictly greater -
   deliberately a read-then-decide, never a write-and-react-to-a-
   conflict-error: because this all runs inside one multi-document
   transaction, triggering a server-side error from an operation
   *inside* that transaction (even one caught in application code)
   marks the whole transaction unusable, and the automatic transaction
   retry this failure mode triggers re-executes the identical
   deterministic error forever until it gives up - a real, reproduced
   hang during this phase's live run (see `docs/DECISIONS.md` #20). A
   stale/redelivered older-version event is detected and reported
   `STALE` before any write is attempted - the event is still
   inbox-recorded and acked, just applies no projection change.
6. `projections/workload.py`'s `WorkloadProjectionRepository` derives
   `workload_projection` counters (by project, column/status,
   priority, and assignee) from the actual before/after snapshot
   `item_state` returns for each transition - never from an event's
   own claimed "previous" value. This is what makes a reassignment's
   decrement-old/increment-new, a move's column delta, and an
   archive's removal from every active bucket all correct exactly
   once under at-least-once redelivery: the inbox (duplicate) and the
   version gate (stale) are what prevent the delta from ever being
   double-applied: the `$inc` itself is not idempotent, the gating
   around it is.
7. `projections/activity.py`'s `ActivityProjectionRepository` records
   an append-only timeline entry for every known event type (not just
   work-item ones - team/project/board events are activity-worthy
   too), indexed by `(projectId, occurredAt)`.

This combination (dedupe-by-inbox + version-gated state + ack-after-
commit) is what makes the consumer idempotent under at-least-once,
possibly-reordered delivery - see
`services/activity-insights-service/tests/test_processor.py` for the
automated evidence (valid/duplicate/out-of-order/malformed/
unsupported-version/transient-error/reassignment/move/archive cases)
and `docs/TIMELOG.md`'s Phase 5 notes for the real-NATS and real-Atlas
live evidence.

### Replay into a clean projection

`python -m activity_insights.replay --namespace <prefix>` (never an
HTTP endpoint - "no unsafe public replay/admin endpoints" is a named
requirement) creates a brand-new, separate durable consumer on the
real `TEAM_EVENTS` stream with `deliver_policy=all` and runs every
message through the exact same `EventProcessor`/`EventConsumer` logic
the live service uses, but with every collection name prefixed by
`--namespace` - so a replay run writes to e.g. `replay1_item_state`,
never the live `item_state`, and never touches `management_db` at all
(this service holds no credentials for it). See
`src/activity_insights/replay.py`.

### Consumer-state health reporting

`GET /health/consumer` (additive - `/healthz` and `/readyz` are
unchanged Phase 2 contracts) reports the assignment's required
diagnostic fields: `durableConsumerName`, `connected`,
`lastProcessedStreamSeq`, `lastSuccessfulProcessingAt`, and
`processingAgeSeconds` (freshness). Like the NestJS `messaging` health
block (`docs/DECISIONS.md` #13), this is a diagnostic and never flips
an HTTP status of its own.

## Core NATS request/reply

Not every interaction needs durability. When a caller wants a synchronous
answer to an insights question ("what's this project's current
workload breakdown?"), the Python service answers over plain Core NATS
request/reply on `tm.query.v1.project_insights`:

- No persistence of the request itself is needed - if no responder is
  listening, the caller gets a fast "no responders" failure (or a
  bounded timeout if a responder is present but slow), which is an
  acceptable failure mode for a read query (the caller can retry or
  show a loading error) - never an unbounded wait.
- This keeps the read path cheap and avoids forcing every query through
  JetStream's durability machinery, which exists to protect domain
  events, not point-in-time reads.

**Implemented (Phase 4, NestJS/BFF side)**: `InsightsClientService`
(`src/messaging/insights/`) and `GET /api/projects/:projectId/insights`
(`ProjectsController`). Always returns HTTP 200 with a typed
`status` - `ok` (with data), `pending` (timeout), `unavailable`
(no responder / NATS not connected / malformed reply), or `not_ready`
(a well-formed "not yet caught up" reply from the responder) - never a
500 for these legitimate eventual-consistency states (TM-12). Bounded
by `INSIGHTS_QUERY_TIMEOUT_MS` (default 2s); verified against both a
real stub responder and genuine no-responder/timeout conditions on a
real local NATS server (`test/nats-integration.e2e-spec.ts`).

**Implemented (Phase 5, Python side)**: `messaging/responder.py`'s
`InsightsResponder` subscribes to `tm.query.v1.project_insights` and
always replies - `{"status": "ok", "data": {...}}` once this service
has ever seen an event for that `projectId` (workload grouped by
assignee/column/priority from `workload_projection`, plus
`lastProcessedSequence` from consumer-state), or a typed `not_ready`
(`NO_DATA_YET_FOR_PROJECT`, `WORKSPACE_MISMATCH`, `MALFORMED_REQUEST`,
or `INTERNAL_ERROR`) otherwise - never silence (an unhandled error
replies `not_ready`/`INTERNAL_ERROR` rather than leaving the NestJS
caller to time out). Phase 4's tests used a stub responder; this is
the real one.

## Optimistic concurrency and HTTP 409

**Implemented** (Phase 3) in one shared place:
`src/common/mongo/conditional-update.ts`. Teams, projects, and work
items all carry a `version` field; every mutating endpoint requires
the caller's `expectedVersion` in the body and performs a single
`findOneAndUpdate` conditioned on `{ ...filter, version: expectedVersion
}`. If that matches, the write applies and `version` increments
atomically in the same operation. If it doesn't match, a second
`findOne` (without the version filter) disambiguates: document truly
absent -> 404; document exists but at a different version -> **HTTP
409 Conflict** with the real `currentVersion` in the error envelope's
`details`, so the client can re-fetch and retry instead of the server
silently overwriting a concurrent change. Boards carry a `version`
field too (for future column-management mutations) but have no update
endpoint yet, so it is currently unused.

## Eventual consistency

The Python service's projections and the admin UI's activity/workload
views are eventually consistent with Management Service state - there
is a propagation delay between "command committed" and "projection
updated" bounded by outbox-relay latency plus JetStream delivery
latency. No part of this system claims or relies on exactly-once or
immediate cross-service consistency; at-least-once delivery and
idempotent consumers are the explicit, documented guarantee.

## Correlation / observability (Phase 4)

`CorrelationIdMiddleware` (`src/common/context/`, applied globally in
`AppModule.configure`, runs before every guard including the health
checks) accepts a valid caller-supplied `X-Correlation-Id` or
generates one, and echoes it back on the response header.
`RequestContextGuard` folds it into `RequestContext.correlationId`,
which every event-emitting service method threads through to
`OutboxService.enqueue` (the envelope's `correlationId`) and from
there `OutboxRelayService` sets it as the `X-Correlation-Id` NATS
header on publish, and `InsightsClientService` sets it on every
request/reply query. Structured log lines from the relay and insights
client (`src/messaging/logging/messaging-log.ts`) always include
`service`, `correlationId`, `eventId`, `aggregateId`, `subject`,
`attempt`, `latencyMs`, and `result` - the assignment's named
traceability field set - end to end from HTTP command through outbox
row through publish through to the Python consumer's own structured
log line (`stream_seq`, `eventId`, `eventType`, `result` -
`messaging/consumer.py`'s `handle_message`, Phase 5).

## Health model (Phase 4)

- **Liveness** (`GET /health`): process is up, never touches MongoDB
  or NATS.
- **Readiness** (`GET /health/ready`): 200/503 gated on MongoDB
  connectivity only (unchanged from Phase 2/3); the response body also
  reports `messaging: { natsConnected, jetstreamReady,
  unpublishedOutboxCount, failedOutboxCount }` as a diagnostic that
  never flips the HTTP status - see `docs/DECISIONS.md` #13 for why
  gating on NATS too would be the wrong call for an outbox-based
  architecture specifically.
- Both the readiness check and the outbox relay self-heal a MongoDB
  connection whose topology closed itself after a failed first
  connection attempt (`DatabaseService.ensureConnected()`, called
  before every ping and every relay tick) - a real bug reproduced live
  against Atlas, fixed, and the fix itself since confirmed by a clean
  live re-run (13/13 checks, `docs/TIMELOG.md` Phase 4c); see
  `docs/DECISIONS.md` #16 for the root cause.
- The Python service's own health/readiness/consumer-lag reporting
  (Phase 5): `GET /healthz`/`GET /readyz` (Phase 2, unchanged) plus the
  new `GET /health/consumer` diagnostic - see "Consumer-state health
  reporting" above.

## Security baseline (Phase 3)

A direct, documented response to this project's named prior-assignment
mistakes (unauthenticated operational endpoints, no rate limiting):

- **Rate limiting**: `ThrottlerModule` as a global `APP_GUARD`
  (120 requests/minute per client, `src/app.module.ts`). `GET /health`
  and `GET /health/ready` opt out via `@SkipThrottle()` - they're
  infrastructure probes, not user traffic, and must stay responsive
  under load.
- **Body size limits**: explicit `256kb` cap on JSON/urlencoded
  bodies (`src/main.ts`) - comfortably above the largest validated
  field (10,000 chars) and bounded against abuse.
- **Input validation**: a global `ValidationPipe` with `whitelist` +
  `forbidNonWhitelisted` + `transform` - every DTO field is
  type/format/length-checked (`class-validator`), unknown fields are
  rejected outright (not silently dropped or passed through), and
  nothing reaches a repository method without having been through
  this. This is also the first line of defense against NoSQL
  injection via the JSON body: a field declared `@IsString()` or
  `@IsMongoId()` cannot smuggle a Mongo query operator object (e.g.
  `{"$gt": ""}`) through validation.
- **No internal leakage in errors**: `AllExceptionsFilter`
  (`src/common/errors/`) normalizes every error - expected or not -
  into one stable envelope and, for anything unexpected, logs only the
  error's name server-side and returns a generic message to the
  client. The same discipline Phase 1/2 established for MongoDB
  connection errors (log `codeName`/error name only, never the
  connection string) is reused everywhere here.
- **Workspace isolation & cross-reference rejection**: see "Request
  context / trust model" and "Business domain" above - enforced
  server-side on every read and write, not advisory.
- **No secret leakage in messaging logs/errors** (Phase 4): the same
  discipline as MongoDB errors extends to NATS - `NatsConnectionService`
  logs only `error.name`/`error.message` from the NATS client, never
  `NATS_URL` itself; outbox `lastErrorCode` stores only a fixed,
  non-secret classification enum (`PublishErrorCode`), never a raw
  driver/NATS error string. Local dev NATS runs with no auth configured
  (`docker/nats/nats-server.conf` says so explicitly); if credentials
  are added later, the same "log the variable name, never the value"
  rule already applied to `MONGODB_URI` applies identically to
  `NATS_URL`.

## Database setup (MongoDB Atlas)

Both services expect a MongoDB Atlas cluster - there is no Dockerized
local MongoDB. To set one up for local development:

1. Create a free account at mongodb.com/atlas (or use an existing
   organization) and create a project for this platform.
2. Create one cluster (the free **M0** tier is enough for Phase 2 -
   see limitations below). Atlas allows only one M0 cluster per
   project, so **both `management_db` and `insights_db` live on the
   same cluster as two separate databases** - they are isolated by
   database name and by per-database credentials, not by separate
   clusters.
3. Network Access: add your IP (or `0.0.0.0/0` for a throwaway dev
   cluster only - never do this for anything that holds real data).
4. Database Access: create **two** database users, each scoped to only
   its own database via a custom role:
   - `management-service` user: `readWrite` on `management_db` only.
   - `activity-insights-service` user: `readWrite` on `insights_db`
     only.
   Scoping credentials per-database at the Atlas level is what makes
   rule 5 ("Python must never query management_db") enforceable even
   if the application-level guard in `db.py` were ever bypassed - the
   Python user's credentials simply cannot authenticate against
   `management_db`.
5. Copy each user's connection string into that service's `.env`
   (copied from its `.env.example` - never commit `.env`) as
   `MONGODB_URI`, with the database name in the path matching
   `MONGODB_DB_NAME` (`.../management_db?...` or `.../insights_db?...`).
6. Start each service; `GET /health/ready` (Node) or `GET /readyz`
   (Python) returns 200 once the connection is live, 503 otherwise.

### Atlas free-tier (M0) limitations - stated honestly

- **512MB storage shared across the whole cluster**, i.e. shared
  between `management_db` and `insights_db` together, not 512MB each.
  This is fine for Phase 2 (no data yet) but will not hold real
  production volume - a paid tier is required before that.
- **Shared RAM/vCPU** with other free-tier tenants on the same
  underlying hardware; throughput is not guaranteed and can throttle
  under load.
- **No VPC peering or private endpoint** - the cluster is only
  reachable over the public internet via the IP access list, which is
  a materially weaker trust boundary than a private network. Treat the
  free tier as dev/demo-only for this reason alone.
- **Auto-pauses after 60 days of inactivity** - a paused cluster
  needs to be manually resumed from the Atlas console before either
  service can connect again.
- **No continuous/point-in-time backups** - only basic, limited
  snapshotting. Do not treat an M0 cluster as the durable copy of
  anything that matters.
- **One M0 cluster per project** - this is *why* both databases share
  a cluster here; it is a free-tier constraint, not an architectural
  preference (the two-databases-two-services ownership rule itself is
  unaffected either way).

## Local infrastructure

Docker Compose runs a single local NATS server with JetStream enabled
and file-backed persistent storage (`docker/nats/nats-server.conf`,
volume `tm-nats-jetstream-data`), so streams and consumers survive
container restarts during development. MongoDB is **not** run locally
via Docker - both services connect to MongoDB Atlas, configured through
each service's own `.env` (never committed; see `.env.example` files).

The Management Service connects to this local NATS via `NATS_URL`
(`.env`/`.env.example`, default `nats://localhost:4222`) - lazily, on
first real use, the same pattern as the Mongo client (Phase 2). On
boot it idempotently bootstraps the `TEAM_EVENTS` stream and the
`activity-insights-v1` durable consumer (`StreamBootstrapService`),
and starts the in-process outbox publisher relay
(`OutboxRelayService`) on a timer (`OUTBOX_RELAY_INTERVAL_MS`, default
1s). None of this blocks app boot or `GET /health` if NATS happens to
be unreachable - see "Health model" above.
