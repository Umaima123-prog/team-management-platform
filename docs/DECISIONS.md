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

## 11. Atlas transaction verification: structural evidence, now confirmed by a live run (Phase 4)

**Decision:** Use real `session.withTransaction()` MongoDB transactions
for every authoritative-mutation-plus-outbox-row write
(`DatabaseService.withTransaction`), based on independently-gathered
evidence that the configured Atlas deployment is a multi-node replica
set, rather than live-executing a transaction against it in this
session.

**Why:** The assignment requires verifying transaction support rather
than assuming it. A direct live-transaction probe was attempted first
(a throwaway script against the real `.env`, cleaning up only its own
probe documents) but could not complete: `openssl s_client` to the
Atlas host failed with `SSL alert number 80` ("internal error")
immediately after the TLS ClientHello, on all three resolved replica
members, while a raw TCP connection to the same host:27017 succeeded
and general HTTPS (port 443) egress worked fine from the same
environment. This reproduces independent of Node (the same failure
happens with plain `openssl`), which rules out a driver bug and points
at a local network/security-product TLS interception specific to
MongoDB's non-HTTP wire protocol on 27017 - not an Atlas-side
rejection (Atlas access-list rejections don't manifest as a mid-
handshake TLS alert) and not evidence against transaction support.
Independently, live DNS SRV resolution against Atlas's real
infrastructure (`_mongodb._tcp.<cluster>.mongodb.net`) returned three
`shard-00-0{0,1,2}` hosts - Atlas's standard replica-set member naming,
and Atlas has not offered non-replica-set (standalone) deployments for
years; `docs/ARCHITECTURE.md` already documents this deployment as the
free **M0** tier, which Atlas always deploys as a 3-node replica set.
Replica sets support multi-document ACID transactions since MongoDB
4.0. Given solid structural evidence of a replica-set topology and no
contrary evidence, real transactions are the correct implementation -
not a fallback.

**Rules out:** silently downgrading to non-transactional writes or an
application-level "best effort" pseudo-transaction instead of
reporting a limitation; treating the TLS failure as evidence Atlas
lacks transaction support (it is an unrelated local connectivity
issue).

**Live verification update (same day, outside the sandboxed
environment):** the structural case above was then confirmed directly.
The user ran `services/management-service` with `npm run start:dev`
against the real `.env` in a normal terminal (not subject to the
sandbox's network restriction - see the firewall-rule finding in this
session's history) and executed `phase4-live-verify.js` (see Phase 4a
TIMELOG notes). Result: **13/13 checks passed**, including the
atomicity check this decision's "next safe step" asked for -
`POST /api/teams` created a real team document in live Atlas
`management_db` and its matching `tm.v1.team.created` row in
`outbox_events`, cross-referenced by identical `aggregateId`/`version`/
`workspaceId` and near-zero `createdAt` delta (the two writes land
together or not at all, by construction - `DatabaseService.withTransaction`
wraps both in one session). The relay then claimed and published that
row to the real local `TEAM_EVENTS` stream (JetStream sequence 44),
confirmed independently two ways: the relay's own structured log line
(`"result":"published","streamSeq":44`) and the verification script's
separate read of the message back out of the stream via a throwaway
ephemeral consumer - both report the same sequence number, which is
only possible if a genuine `PubAck` was received and the message is
really stored. `publishedAt` was confirmed set only after that
sequence existed. This is now a fully live-confirmed guarantee, not
only a structural inference - see `docs/TIMELOG.md` Phase 4a/4c notes
for the full run.

## 12. causationId chains multiple facts from one command; most events are command-root facts (Phase 4)

**Decision:** When a single HTTP command produces more than one
domain event (today: only `POST /api/projects`, which emits
`project.created`, `project.team_assigned`, and `board.created`), the
first event enqueued is the root fact (`causationId: null`) and the
others set `causationId` to that root event's `eventId`. Every other
command that produces exactly one event sets `causationId: null` -
there is no synthetic "command id" distinct from `correlationId`.

**Why:** The assignment's canonical envelope names `causationId` as
"the event that caused this one" (chained effects), which only has
meaning when more than one event exists per command. Inventing a
separate command-id concept to populate `causationId` on every
single-event command would duplicate what `correlationId` already
captures (the originating request) without adding information.
Chaining it for the one real multi-event command makes "these three
facts happened together, this one first" explicit and queryable rather
than left to timestamp-ordering inference.

**Rules out:** a `causationId` that's always null (would waste the
field entirely); a `causationId` that duplicates `correlationId`'s
job.

## 13. GET /health/ready is gated on MongoDB only; NATS/messaging is a reported diagnostic (Phase 4)

**Decision:** `GET /health/ready`'s 200/503 status depends solely on
`DatabaseService.ping()` (unchanged from Phase 2/3). NATS connectivity,
JetStream bootstrap state, and outbox backlog/failure counts are
included in the response body (`messaging: {...}`) but never flip the
HTTP status.

**Why:** The assignment's health-model bullet says readiness "checks
NATS connectivity and the service's owned database," which read
literally could mean gating on both. Doing so would be the wrong call
for *this* architecture specifically: the whole point of the
transactional outbox is that a write command's durability and the
HTTP caller's success response do not depend on NATS being reachable
at that moment - the relay catches up later. Making `/health/ready`
503 whenever NATS blips would cause an orchestrator to pull a perfectly
functional instance (one that can still accept and durably record
every command) out of rotation for a condition the architecture is
explicitly designed to tolerate. Reporting NATS/outbox state as a
diagnostic satisfies "readiness exposes messaging state" without
re-coupling write availability to messaging availability.

**Rules out:** a future change that makes `/health/ready` 503 on NATS
being down without first re-litigating this trade-off; treating the
`messaging` block's absence of hard-gating as "NATS health isn't
checked" - it is checked and reported, just not used to reject
traffic.

## 14. `project.team_assigned` is reused on update, not limited to creation-time (Phase 4)

**Decision:** The documented `project.team_assigned` subject is
emitted both when `POST /api/projects` creates a project (with
`previousTeamId: null`) and whenever `PATCH /api/projects/:id` changes
an existing project's `teamId` (with the real previous value).

**Why:** The assignment's Minimum API surface table only explicitly
names this event at creation time ("Create project, assign team...
emit facts"), but the subject itself names the fact "a project's
owning team was assigned," which is equally true on a later
reassignment - and TM-04 ("assign one owning team to a project...")
isn't scoped to creation only. Reusing the existing documented subject
for both cases is a narrow, justified extension of when a subject
fires, not a new subject - the assignment says not to invent subjects,
not that each one may only fire once.

**Rules out:** a new `project.team_reassigned` subject; a PATCH that
silently changes `teamId` with no event at all.

## 15. NATS client library: `nats` v2, not the newer `@nats-io/*` package split (Phase 4)

**Decision:** Use `nats@2.29.3` (the single-package client) for all
Core NATS and JetStream access, despite npm's deprecation notice
pointing at `@nats-io/transport-node` (with JetStream now a separate
`@nats-io/jetstream` package).

**Why:** The newer split is a package *restructuring*, not a security
deprecation - `nats@2.29.3` has zero known vulnerabilities
(`npm audit --omit=dev`) and is what NestJS's own official NATS
transporter documentation (an assignment-cited reference) still builds
against. Migrating to a multi-package API with a materially different
JetStream surface carries real integration risk under this exercise's
timebox for no functional benefit - every capability this project
needs (Core request/reply, JetStream publish/manage/consume, headers,
`msgID` dedup) is present and documented in the version used.

**Rules out:** treating the npm deprecation warning as a security
issue requiring an immediate migration; silently upgrading without
re-verifying the entire messaging layer against the new API's
different consumer/manager shapes.

## 16. MongoClient self-healing reconnect, not a new client per operation (Phase 4)

**Decision:** `DatabaseService.ensureConnected()` calls `this.client.connect()`
(idempotent, lock-guarded, near-instant no-op once already connected)
before `ping()`'s `db.command({ping:1})` and before every
`withTransaction()`; `OutboxRelayService.tick()` calls it before each
tick's `claimBatch()`. `database.providers.ts`'s `serverSelectionTimeoutMS`
was raised from 2s to 10s. The app's single `MongoClient` instance
(DI singleton, `DatabaseModule`) is never replaced or duplicated - the
same object is repaired in place, forever.

**Why:** Reproduced live, outside the sandbox, against real Atlas: the
relay logged `MongoTopologyClosedError: Topology is closed` on every
tick, and `GET /health/ready` failed identically and simultaneously -
both symptoms traced to one root cause. Reading the installed MongoDB
Node.js driver's own source (`node_modules/mongodb/lib/sdam/topology.js`,
`Topology.connect()`) confirmed: if a `MongoClient`'s *first* connection
attempt fails for any reason (a transient Atlas blip, an M0 free-tier
cluster waking from idle, a too-short timeout), the driver's internal
`Topology` catches that error and calls `this.close()` **on itself**
before rethrowing - permanently closing the topology. Nothing in this
app explicitly called `.close()` anywhere except `DatabaseModule`'s own
shutdown hook (confirmed by grepping the whole `src/` tree for
`.close(`/`enableShutdownHooks` - only one call site existed, and
`enableShutdownHooks()` was never wired to begin with, so it could not
have fired during normal operation). Every operation afterward reused
the same dead topology and failed identically forever - a full process
restart was the only prior recovery path. `MongoClient.connect()`
(the *public*, client-level method - `mongo_client.js`'s `_connect()`)
is different: its only short-circuit is `if (this.topology?.isConnected())
return`; otherwise it builds a **fresh internal `Topology` in place on
the same client object** and reconnects. Because every repository's
`Collection`/`Db` reference delegates to the shared client at call
time rather than holding a frozen topology snapshot, repairing the
client this way transparently heals every already-constructed
repository too - no DI graph changes, no new `MongoClient`, exactly
one shared long-lived connection for the app's life, satisfying
"never create a new client per relay tick" while still genuinely
recovering.

`app.enableShutdownHooks()` was also added to `main.ts` (previously
absent) so the existing single `client.close()` in `DatabaseModule`'s
`onApplicationShutdown` actually runs - exactly once, only on a real
SIGINT/SIGTERM/`app.close()` - instead of never running at all.

**Rules out:** constructing a new `MongoClient` per operation/tick (a
real anti-pattern that would exhaust connections and defeat pooling);
retrying individual failed operations without first repairing the
topology (would keep failing identically); treating this as an Atlas-
side or network problem to "just wait out" (the topology does not
self-heal on its own - the app must call `.connect()` again); claiming
a transient Atlas blip is now impossible (it isn't - the fix is that
it's now *recoverable within seconds* via the next tick/ping, not
fatal for the process's remaining lifetime).
