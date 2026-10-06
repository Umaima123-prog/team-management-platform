# Decisions

Concise architecture decision records. Each entry: decision, why, and
what it rules out. Update this file instead of leaving a decision only
implicit in code.

## 1. Service boundaries: one writer per database

**Decision:** Management Service (NestJS/TypeScript) is the sole writer
of `management_db` (workspaces, users, teams, memberships, projects,
boards, columns, work items, outbox). Activity & Insights Service
(Python) is the sole writer of `insights_db` (inbox, activity
projection, workload projection, processing failures). Neither service
ever reads the other's collections directly.

**Why:** A single writer per database is what makes "who changed this
and when" unambiguous, and lets each service evolve its schema without
coordinating migrations with the other. Python benefits from its data
ecosystem for analytics/projections without needing to touch Node's
business logic, and vice versa.

**Rules out:** shared ORM/connection between services, Python querying
`management_db` "just for a quick read," any future service writing to
a collection it doesn't own.

## 2. Core NATS vs JetStream

**Decision:** Durable domain events (anything another service's state
depends on) go through JetStream. Synchronous point-in-time queries
(e.g. "give me this workspace's current workload") use Core NATS
request/reply.

**Why:** JetStream's persistence and redelivery are needed exactly
where losing a message would corrupt downstream state. For a query, a
timeout-on-no-responder is an acceptable, cheap failure mode, and
forcing it through JetStream would add latency and operational
complexity for no durability benefit (nothing needs to be replayed -
if the query fails, the caller just asks again).

**Rules out:** publishing domain events over Core NATS "because it's
simpler," building queries on top of JetStream consumers.

## 3. Outbox (Management Service) + inbox (Python service)

**Decision:** Management Service writes the aggregate change and an
outbox record in the same MongoDB transaction; a relay publishes outbox
rows to JetStream. Python service writes an inbox record (keyed by
`event_id`) before/with applying each projection, and only acks after
both succeed.

**Why:** MongoDB transactions can't span into NATS, so "mutate state and
emit an event" can't be a single atomic operation across the two
systems. The outbox makes the Mongo-side half of that atomic; the inbox
makes redelivery safe on the Python side. Together they're what let us
guarantee at-least-once without ever silently losing or double-applying
a change.

**Rules out:** publishing events directly from request handlers without
an outbox (risks "event sent but transaction rolled back" or vice
versa), Python processing an event without checking for a duplicate
first.

## 4. At-least-once delivery, idempotent consumers, no exactly-once claim

**Decision:** All JetStream consumers use manual ack, acknowledging only
after their work (inbox write + projection write) is durably persisted.
We explicitly do not claim, design for, or document exactly-once
delivery anywhere in this system.

**Why:** Exactly-once delivery across a network is not a thing NATS (or
most messaging systems) actually provides end-to-end; claiming it would
be false and would let a future implementer skip the idempotency work
that's actually required. At-least-once + idempotent consumers gives
the same practical outcome (no lost updates, no duplicate side effects)
without the false guarantee.

**Rules out:** auto-ack on receipt, any doc or comment claiming
"exactly-once," consumer logic that assumes an event is seen only once.

## 5. Security posture for Phase 1 skeleton

**Decision:** The only HTTP endpoint that exists in Phase 1 is an
unauthenticated `GET /health` on the Management Service. No admin or
operational endpoints exist yet; authentication, authorization, and
rate limiting are deferred until the first real public API is added,
and must be designed in before that API ships (not bolted on after).

**Why:** A liveness/readiness probe is conventionally left
unauthenticated (it has no business data to protect and is usually
called by infrastructure, not users); there is nothing else to protect
yet. Explicitly recording the deferral - rather than leaving it
unstated - means it's a tracked decision, not a thing that gets
forgotten when the first real endpoint is added.

**Rules out:** treating `/health` as a precedent for shipping later
business endpoints without auth/rate limiting.

## 6. MongoDB persistence foundation (Phase 2)

**Decision:** Both services connect via the official driver (`mongodb`
for Node, `motor` for Python) with no connection attempted at module
construction time - the client object is created, but the driver only
actually connects on first use (a ping, or a real query). Neither
service has any hardcoded or default connection string: `MONGODB_URI`
and `MONGODB_DB_NAME` are read from the environment and the app fails
fast (throws at startup/first-use) if they're missing. The Python
service additionally refuses to start if `MONGODB_DB_NAME` is ever
anything other than `insights_db` - a defense-in-depth guard against a
copy-paste config mistake pointing it at `management_db`. Liveness
(`GET /health`, `GET /healthz`) never touches the database; readiness
(`GET /health/ready`, `GET /readyz`) pings it live and returns 503 on
failure.

**Why:** Lazy connection means the app (and its test suite) can boot
without real Atlas credentials - required for `npm ci`/`pytest` to run
in CI, where no `.env` with real secrets ever exists. Separating
liveness from readiness means a transient Atlas blip doesn't get the
container killed by an orchestrator that conflates "process is up"
with "database is reachable." The `insights_db`-only guard turns rule 5
("Python must never query management_db") from a code-review hope into
something that fails loudly at startup if violated.

**Rules out:** a default/fallback Mongo URI baked into application
code, the Python service silently connecting to whatever
`MONGODB_DB_NAME` happens to be set to, a liveness probe that depends on
database reachability.

## 7. Workspace scoping and index bootstrap as structural mechanisms

**Decision:** `WorkspaceScopedRepository` (Management Service) merges
`workspaceId` into every filter at the base-class level rather than
trusting each future repository method to remember it. `IndexBootstrapService`
(Node) and `bootstrap_indexes()` (Python) apply a static, versioned list
of index specs idempotently on every startup rather than via a separate
migration tool. Both registries are intentionally near-empty right now:
no business collections exist yet, so there is nothing to scope or
index beyond the inbox's own `event_id` uniqueness (the dedup
invariant the inbox pattern depends on, independent of business schema).

**Why:** Cross-tenant data leaks are usually a missing-filter bug, not
a logic bug - making the filter impossible to omit (by construction,
not convention) is cheaper than relying on every future PR review to
catch it. An idempotent bootstrap-on-start is simpler than a migration
runner for a project this size, and does not need its own CI step.

**Rules out:** a future repository querying a workspace-scoped
collection without going through the scoped base methods, hand-written
`createIndex` calls scattered across business-logic files instead of
one registry.
