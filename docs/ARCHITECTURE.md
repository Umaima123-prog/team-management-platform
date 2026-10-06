# Architecture

## Implementation status (read this first)

This document describes the **target architecture** for the Team
Management Platform. As of Phase 2, the following exist:

- Repository/service skeletons (NestJS management-service, Python
  activity-insights-service) with no business logic.
- Docker Compose for local NATS with JetStream enabled, verified
  running: `/healthz` returns `ok`, `/jsz` confirms JetStream is active
  (file-backed, 1GB memory / 10GB storage limits per
  `docker/nats/nats-server.conf`), the `tm-nats-jetstream-data` volume
  is correctly mounted at `/data/jetstream`, and startup logs show no
  errors. No streams/consumers exist yet - nothing publishes or
  consumes events.
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
- This documentation set.

Nothing below about the outbox relay, event consumption, projection
logic, or domain events/collections (workspaces/teams/projects/boards/
work items/activity_projection/workload_projection/processing_failures)
is implemented yet - only the connection/health/index-bootstrap
*infrastructure* they'll sit on. Each later phase that implements a
piece of this design must update this file so it keeps describing the
current implementation, not just the plan.

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
