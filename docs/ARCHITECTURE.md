# Architecture

## Implementation status (read this first)

This document describes the **target architecture** for the Team
Management Platform. As of Phase 1, only the following exist:

- Repository/service skeletons (NestJS management-service, Python
  activity-insights-service) with no business logic.
- Docker Compose for local NATS with JetStream enabled, verified
  running: `/healthz` returns `ok`, `/jsz` confirms JetStream is active
  (file-backed, 1GB memory / 10GB storage limits per
  `docker/nats/nats-server.conf`), the `tm-nats-jetstream-data` volume
  is correctly mounted at `/data/jetstream`, and startup logs show no
  errors. No streams/consumers exist yet - nothing publishes or
  consumes events in Phase 1.
- This documentation set.

Nothing below about the outbox relay, event consumption, inbox,
projections, or domain events (workspaces/teams/projects/boards/work
items) is implemented yet. Each later phase that implements a piece of
this design must update this file so it keeps describing the current
implementation, not just the plan.

## Service ownership

Two services, two databases, no shared collections.

### Management Service (NestJS + TypeScript)

Owns, and is the only writer of, `management_db`:

- `workspaces`
- `users`
- `teams`
- `memberships`
- `projects`
- `boards`
- `columns`
- `work_items`
- `outbox` (transactional outbox, see below)

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

## Command flow (target design)

1. A client issues a write command to the Management Service (e.g.
   `POST /workspaces`).
2. The Management Service validates the command and, in a single
   MongoDB transaction:
   - applies the change to the owning aggregate (with an optimistic
     concurrency check - see below), and
   - inserts a corresponding record into the `outbox` collection.
3. The HTTP response returns once the transaction commits. The caller
   gets a definitive success/failure answer without waiting on NATS.
4. A relay process (part of the Management Service) polls/tails the
   `outbox` collection and publishes each pending record to JetStream,
   then marks it published.
5. The Python service's durable JetStream consumer receives the event,
   persists an inbox record keyed by `event_id`, applies the
   projection update, and only then acknowledges the message.

Steps 4-5 are asynchronous relative to step 3: callers see transactional
consistency for their own write, and everyone else sees the effect of
that write only after the event has propagated (eventual consistency).

## Transactional outbox

Mongo transactions are per-database, so "write the aggregate and emit
an event" cannot be a single operation spanning the database and NATS.
The outbox pattern makes it atomic within MongoDB instead: the aggregate
write and the outbox record are written in the same transaction, so a
crash can never produce "state changed but no event" or "event queued
but state unchanged." A separate relay then has the simpler job of
publishing outbox rows to JetStream at-least-once (retrying until NATS
acknowledges), and marking them published. If the relay crashes between
publish and marking-published, it republishes on restart - this is why
consumers must be idempotent (see below).

## JetStream (durable domain events)

All domain events that other services depend on for eventual
consistency are published to JetStream streams, not Core NATS. JetStream
gives:

- **Durability**: events persist even if the Python service is down
  when they're published.
- **Replay**: a new or rebuilt consumer (e.g. after fixing a projection
  bug) can replay history instead of losing it.
- **At-least-once delivery** with consumer acknowledgement, so a
  crashed consumer re-receives unacknowledged messages.

Subjects follow the `tm.v1.<aggregate>.<event>` convention - see
`EVENT_CATALOG.md` for the planned subject list and the canonical
envelope shape.

## Python inbox and projections

Because JetStream delivery is at-least-once, the same event can arrive
more than once (consumer crash-and-redeliver, network retry, etc.). The
Python service never trusts "I haven't seen this" from memory - instead:

1. On receiving an event, it checks the `inbox` collection for that
   `event_id`.
2. If already present, it skips re-applying the projection and simply
   acknowledges (idempotent no-op).
3. If not present, it applies the projection update and the inbox
   record **in the same local transaction/step** that precedes the
   JetStream ack.
4. The event is acknowledged to JetStream **only after** both the
   projection write and the inbox write succeed. If either fails, the
   message is not acked and JetStream will redeliver it.
5. If projection logic itself fails repeatedly (bad data, bug), the
   event is recorded in `processing_failures` for investigation rather
   than acked-and-dropped or retried forever inline.

This combination (dedupe-by-inbox + ack-after-persist) is what makes
the consumer idempotent under at-least-once delivery.

## Core NATS request/reply

Not every interaction needs durability. When a caller wants a synchronous
answer to an insights question ("what's this workspace's current
workload breakdown?"), the Python service answers over plain Core NATS
request/reply:

- No persistence of the request itself is needed - if no responder is
  listening, the caller gets a timeout, which is an acceptable failure
  mode for a read query (the caller can retry or show a loading error).
- This keeps the read path cheap and avoids forcing every query through
  JetStream's durability machinery, which exists to protect domain
  events, not point-in-time reads.

## Optimistic concurrency and HTTP 409

Mutable aggregates in `management_db` (teams, boards, columns, work
items, etc.) carry a version field. A command handler reads the current
version, and its MongoDB update is conditioned on that version still
matching (`findOneAndUpdate` with a `version` filter). If another writer
updated the aggregate first, the condition fails, no write happens, and
the API returns **HTTP 409 Conflict** rather than silently overwriting a
concurrent change.

## Eventual consistency

The Python service's projections and the admin UI's activity/workload
views are eventually consistent with Management Service state - there
is a propagation delay between "command committed" and "projection
updated" bounded by outbox-relay latency plus JetStream delivery
latency. No part of this system claims or relies on exactly-once or
immediate cross-service consistency; at-least-once delivery and
idempotent consumers are the explicit, documented guarantee.

## Local infrastructure

Docker Compose runs a single local NATS server with JetStream enabled
and file-backed persistent storage (`docker/nats/nats-server.conf`,
volume `tm-nats-jetstream-data`), so streams and consumers survive
container restarts during development. MongoDB is **not** run locally
via Docker - both services connect to MongoDB Atlas, configured through
each service's own `.env` (never committed; see `.env.example` files).
