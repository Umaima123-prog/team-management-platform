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

## 8. Request context via a trusted development header (Phase 3)

**Decision:** No real authentication system in Phase 3 (explicitly
descoped). Instead, `X-Dev-User-Id` names a real user id; a global
guard (`RequestContextGuard`) looks that user up and derives
`workspaceId` from the user's own stored record - never from anything
the client sends directly. This becomes the `RequestContext` every
service/repository call is scoped by.

**Why:** The task needed workspace isolation to be real and
server-enforced without building a login system this phase didn't
have budget for. Deriving `workspaceId` from a DB-verified identity
(rather than accepting it as input) is what makes "never trust a
client-supplied workspaceId" true in code, not just in a comment.

**Rules out:** any request body, query string, or header carrying
`workspaceId` directly and having anything trust it; a future
authentication system replaces only the identity-resolution step
inside the guard - `RequestContext` and everything built on it stay
the same.

## 9. Business-rule tests are mocked unit tests, not Mongo-backed e2e (Phase 3)

**Decision:** Teams/projects/work-items business rules (duplicate
codes, membership uniqueness, role authorization, cross-workspace
rejection, issue-key generation, rank/move logic, 409-on-stale-version,
pagination, archive behavior) are covered by unit tests with
mocked repositories (`src/**/*.spec.ts`), not HTTP-level e2e tests
against a real database.

**Why:** A real-MongoDB integration-test setup was attempted first
(`mongodb-memory-server`, an in-memory `mongod`) specifically to get
genuine database-backed coverage of the new domain. Its binary
download stalled indefinitely in this sandboxed network environment -
confirmed stuck at a fixed byte offset across repeated attempts, not
merely slow - so it was abandoned rather than left as a flaky or
silently-skipped dependency. Separately, every protected route (all of
them except the two health checks) resolves its `RequestContext`
through a real database lookup in `RequestContextGuard` *before* any
guard, pipe, or controller logic runs - so even a validation-only HTTP
test would require a reachable database. Mocked unit tests exercise
the same service-layer logic without either problem, which is this
project's existing documented strategy (the same pattern
`database.service.spec.ts` used in Phase 2).

**Rules out:** depending on `mongodb-memory-server` (or any other
real-database test fixture) for this phase; claiming HTTP-level
integration coverage that doesn't actually exist. What this does
*not* cover: whether MongoDB's own unique/partial indexes actually
enforce the constraints the mocks assume they do - that remains
verified only by the live Atlas check (Phase 2's `/health/ready`
pattern), not by an automated test, and is named explicitly as an
incomplete item.

## 10. Team roles gate team mutations; projects/work items have no separate role check (Phase 3)

**Decision:** `OWNER`/`LEAD` are required to add/remove members,
change roles, or update a team's details; only `OWNER` may archive a
team. Project and work-item mutations are open to any authenticated
workspace member - there is no project-level or work-item-level role
check.

**Why:** The task specified roles (`OWNER`/`LEAD`/`MEMBER`) in the
context of teams and membership operations specifically, not a
general-purpose permission matrix across every resource. Adding
project/work-item-level authorization the task didn't ask for would
be scope creep this phase's time budget didn't afford; the
*cross-workspace* and *team-membership* checks that **were** specified
(owner/team same workspace, assignee must be a team member) are
enforced regardless of who's asking.

**Rules out:** assuming project/work-item endpoints are
role-restricted - they are not, in Phase 3. A future phase that wants
that must add it explicitly, the same way team mutations do it today.
