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

**Reproducibility confirmed by a second independent run:** the user
re-ran the same live verification again (Phase 4d). Result: 13/13
again, with the stream sequence correctly advanced to 45 (from 44 in
Phase 4c) and manually cross-checked against the relay's own log line
for the same value - matching, as in 4c. Two independently clean runs
rule out the first pass having been a fluke. **Status: Phase 4 is
VERIFIED END-TO-END.** See `docs/TIMELOG.md` Phase 4d notes.

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

## 17. Workload counters are derived from item_state's own before/after snapshot, never from an event's claimed "previous" value (Phase 5)

**Decision:** `projections/workload.py`'s delta math (decrement old
bucket, increment new bucket) reads the "old" value from the actual
document `projections/state.py`'s version-gated `find_one_and_update`
returns as `return_document=ReturnDocument.BEFORE`, never from the
incoming event's own `previousAssigneeId`/`fromColumnId` payload
fields.

**Why:** Those payload fields describe what the *Management Service*
believed the previous value was at command time - correct for a
normally-ordered delivery, but not something the Python consumer can
safely trust after a redelivery or a genuinely out-of-order arrival,
because by the time a stale or duplicate copy of that event is
(re)delivered, this service's own `item_state` may already reflect a
*later* event's change. Trusting the event's own claim could double-
decrement a bucket a later event already moved away from. Deriving the
delta from this service's own persisted prior state, gated by the same
version check that produces the `STALE` outcome for out-of-order
events, means a delta is only ever computed from a transition that
*this consumer* verified actually happened in that order - the `$inc`
operation itself is not idempotent, but applying it is only reachable
through a path (inbox-dedup AND version-gate both passed) that itself
can only be reached once per genuine transition.

**Rules out:** trusting `payload.previousAssigneeId`/`fromColumnId`/
`previousColumnId` for projection math (kept in the payload only for
human/audit readability and parity with the documented envelope
shape); a design that needs its own separate "has this delta already
been applied" ledger (the version gate already is one, for free).

## 18. One MongoClient per process, shared between the db handle and every session (Phase 5)

**Decision:** `db.py`'s `get_database()` (which internally calls
`get_client()`) is for callers that need a database handle only.
Anything that will *also* call `client.start_session()` - the live
service (`main.py`), replay (`replay.py`), the real-Atlas regression
test - must instead call `get_client()` once and derive the database
handle from that *same* client via the new `database_from_client()`,
never call `get_database()` separately alongside it.

**Why:** Hit live, on this phase's first real run against real Atlas:
every single event was "processed" successfully by the consumer's own
error handling (never crashed, never hung) but came out as
`PROCESSING_BUG` in `processing_failures` for literally every message,
with the detail `InvalidOperation: Can only use session with the
MongoClient that started it`. Root cause: `main.py` originally called
both `get_client(settings)` (for `EventProcessor`'s session-starting
client) and `get_database(settings)` (for the collections) - each of
which constructs its own independent `AsyncIOMotorClient`. A MongoDB
session is a protocol-level handle scoped to the exact client
connection that created it; a collection obtained from a *different*
client instance refuses to accept it. Nothing in local unit testing
caught this because `tests/support/fake_mongo.py`'s fakes don't model
per-client session identity at all (a real gap in the mocked suite,
not a false negative to paper over) - only `test_real_mongo_integration.py`,
run against the real driver, could and did catch it. The bug's blast
radius was real: the already-provisioned `activity-insights-v1`
durable consumer had already acked all 45 backlog messages as
"poisoned" by the time this was found (see `docs/TIMELOG.md` Phase 5
notes for the recovery).

**Rules out:** constructing more than one `AsyncIOMotorClient` per
process for the live service (wasteful connection pooling, and this
exact bug class); "it imported without error so it's fine" as
sufficient evidence for anything that touches a real session - only a
real-driver test proved this class of bug, and the mocked suite's
blind spot here is recorded explicitly rather than quietly papered
over.

## 19. Replay uses a brand-new durable consumer and namespaced collections, never the live ones (Phase 5)

**Decision:** `replay.py` never binds to the assignment-mandated
`activity-insights-v1` consumer (owned, created, and never altered by
the Management Service's `StreamBootstrapService` - Python only ever
*reads* from it in normal operation). It creates a separate durable
consumer (default name derived from `--namespace`) on the same real
`TEAM_EVENTS` stream with `deliver_policy=all`, and every repository
it constructs is parameterized with a `namespace` prefix applied to
every collection name it touches (`inbox`, `item_state`,
`activity_projection`, `workload_projection`, `consumer_state`) -
including `processing_failures`/`inbox`, which initially were missed
(see Decision #18's sibling bug: `InboxRepository`/
`ProcessingFailuresRepository` were only given `namespace` support
after a test run leaked one stray document into the live `inbox`
collection - found, cleaned up, fixed before being reported as done).

**Why:** "Support replay into a clean projection without touching
Management Service data" (assignment) needs more than "don't write to
management_db" - a replay that reused the live `insights_db`
collections would silently corrupt the real projections with a second
pass over history. A separate consumer on the real stream means
replay genuinely proves "this history can be re-derived from
JetStream alone," not a weaker claim backed by a synthetic/mocked
message source.

**Rules out:** a `--namespace ""` default (would target the live
collections by construction - the CLI requires a non-empty value);
replay as an HTTP endpoint (the assignment explicitly names this as
an unsafe pattern to avoid); deleting/reusing the live
`activity-insights-v1` consumer for replay purposes.

## 20. Stale-version detection must be read-then-decide, never write-and-react-to-a-conflict, inside a multi-document transaction (Phase 5)

**Decision:** `projections/state.py`'s `ItemStateRepository.apply_event`
reads the current `item_state` document first (`find_one`) and only
issues a write if the incoming event's `aggregate.version` is
strictly greater than what's already recorded. An earlier
implementation instead attempted an unconditional upsert with a
`version: {"$lt": newVersion}` filter and treated the resulting
`DuplicateKeyError` (when a document already existed under that `_id`
but the version filter didn't match) as the signal for "stale, no
write needed" - this is now recognized as wrong and was replaced.

**Why:** Hit live, replaying the real historical backlog on
`TEAM_EVENTS` under the Decision #18 fix: processing hung for over a
minute on one specific message and had to be killed. Isolated
reproduction showed the real mechanism: MongoDB transactions do not
allow "catch a failed operation's error in application code and keep
going" - once *any* command inside a transaction returns certain
errors (`DuplicateKeyError` included), the **entire transaction** is
marked aborted server-side, independent of whether the driver-level
exception was caught. The very next operation in that same
transaction - here, the final `commitTransaction` - then fails with
`NoSuchTransaction`/"Transaction has been aborted", carrying the
`TransientTransactionError` label. Motor's `with_transaction` treats
that label as retryable and reruns the **entire transaction body**
from scratch - which deterministically hits the identical
`DuplicateKeyError` on every retry, so the retry loop cannot actually
recover; it just spins until its own internal time budget (on the
order of two minutes) is exhausted, then raises. A plain `find_one`
read can never itself produce a transaction-poisoning error, so moving
the stale/not-stale decision there - before any write is attempted -
removes the failure mode entirely rather than handling it better.

**Rules out:** "catch the exception and return a clean result" as a
sufficient fix for any error-shaped control-flow *inside* a MongoDB
transaction (the exception being caught client-side does not undo the
server marking the transaction unusable - this generalizes beyond this
one call site: no future code in this transaction body may rely on a
write's error as a signal, only on a preceding read); papering over the
symptom with a shorter transaction timeout or fewer retry attempts
(would turn a silent-forever-hang into a fast, equally wrong, permanent
failure instead of fixing the actual logic).

## 21. `activity-insights-v1`'s reported `ack_wait` of 1s is correct, not provisioning drift - the earlier "drift" note in EVENT_CATALOG.md was itself wrong (Phase 5)

**Decision:** No code change. `docs/EVENT_CATALOG.md`'s durable-consumer
table is corrected to show both the *configured* `ack_wait` (30s,
`jetstream.config.ts`) and the *effective, server-reported* one (1s),
with an explanation, rather than asserting a single "30s" value that
never matches what the real server reports.

**Why:** A prior pass through this document (Phase 5's first pass)
observed the live consumer reporting `ack_wait: 1s` and concluded this
was staleness - an old consumer created before some config change,
never reconciled by `StreamBootstrapService.ensureDurableConsumer`
(which only creates a missing consumer, never updates an existing
one's fields). That theory was never actually tested against a fresh
consumer before being written down. This phase's final verification
pass tested it directly: a brand-new throwaway consumer, created fresh
against the real server with `ack_wait=10` and `backoff=[2, 4]`,
*also* reports `ack_wait: 2.0` (i.e. `backoff[0]`) - immediately, on
first creation, not after any staleness could occur. A second
throwaway consumer with the same `ack_wait=10` and no `backoff` at all
correctly reports `ack_wait: 10.0`. This isolates the real mechanism
precisely: **JetStream always reports (and uses, for the first
redelivery) `ack_wait = backoff[0]` whenever a `backoff` array is
configured**, independent of whatever `ack_wait` was separately
requested - they are not independent settings once both are set. Since
`activity-insights-v1` has always been configured with
`backoff: [1s, 5s, 30s, 120s]` (in every version of
`jetstream.config.ts` that has existed), *every* correctly-provisioned
instance of this consumer, at any point in this project's history,
would report `ack_wait: 1s` - there was never a point in time where it
would have correctly shown 30s. The actual mismatch was this
documentation's own table asserting a number that cannot be observed
under the system's own configuration.

**Rules out:** "fixing" this by changing `jetstream.config.ts`'s
`ack_wait: nanos(30_000)` to `nanos(1_000)` to "match reality" - the
field is already functionally inert once `backoff` is set (the server
ignores it beyond seeding `backoff[0]`, and `backoff[0]` already *is*
1s), so changing it would change nothing observable and would not be
worth the risk of touching Phase 4 Management Service code for a
no-op edit; re-diagnosing this as a bug a second time without first
isolating the mechanism with a controlled probe (the lesson applied
here, and the thing the first pass skipped).

## 22. A new `tm.query.v1.project_activity` Core NATS query, mirroring `project_insights` exactly, rather than reusing/overloading an existing contract (Phase 6)

**Decision:** Added a second Core NATS request/reply subject,
`tm.query.v1.project_activity`, with its own NestJS BFF route
(`GET /api/projects/:projectId/activity`) and Python responder
(`ActivityResponder`), instead of (a) extending
`tm.query.v1.project_insights`'s existing response shape to also carry
an activity list, or (b) giving the admin UI a different way to reach
`activity_projection` (e.g. a direct Mongo/HTTP read of insights_db).

**Why:** The Phase 6 brief requires an Activity screen showing
"actor, time, action, affected item, chronological ordering" sourced
from "existing backend APIs" - but no existing endpoint returned a
list of individual events; `project_insights` returns only aggregate
counts, by design (docs/ARCHITECTURE.md "Core NATS request/reply").
Overloading `project_insights`'s response to also carry a growing
entries array would conflate two different query shapes (aggregate
counts vs. a timeline) behind one contract and one timeout budget, and
would force every existing consumer of the insights response (the
NestJS controller, the Phase 4/5 tests, `docs/API.md`'s documented
shape) to account for a field they don't use. A second subject,
following the established pattern byte-for-byte (same bounded-
timeout/typed-fallback contract, same "Python answers, NestJS proxies,
browser never talks to NATS or insights_db directly" shape), is the
smallest change that is actually consistent with how this system
already does synchronous cross-service reads - not a new integration
style, not a weakening of the "browser never reads insights_db
directly" rule (docs/ARCHITECTURE.md "Trust boundary"), which this
still fully respects.

**Rules out:** a direct database read from the browser or from NestJS
into `insights_db` (violates service ownership - only the Python
service may read/write its own database); a WebSocket/SSE push
mechanism for "real-time" activity (not asked for, and a materially
different reliability/backpressure story than this project's existing
bounded-request-response pattern); paginating `entries` beyond a
bounded `limit` (dev-tool scale, not an audit-log product - unbounded
pagination was not asked for and would need its own cursor contract).

## 23. Admin UI stack: React + TypeScript + Vite with hand-rolled AdminLTE-style CSS, not the real `admin-lte` npm package (Phase 6)

**Decision:** `admin-ui/` is a React + TypeScript app (Vite, Vitest +
React Testing Library), styled with a small hand-written CSS file
(`src/styles/app.css`) layered on Bootstrap 5, reproducing AdminLTE's
visual language (dark sidebar, topbar, boxed content cards, small-box
dashboard stat widgets) rather than installing the real `admin-lte`
npm package.

**Why:** Real AdminLTE ships as server-rendered HTML/CSS plus jQuery
plugins that directly mutate the DOM (sidebar collapse, treeview,
select2, etc.) - a model that actively fights React's virtual-DOM
ownership of the same elements, and the assignment's own Phase 6
requirements (meaningful tests for board rendering, drag/move
behavior, filters, keyboard navigation, accessibility) are
substantially harder to write and trust against jQuery-plugin-driven
markup than against plain React components. A component framework
with a real testing library (React Testing Library) is what makes
`BoardView.test.tsx`'s optimistic-move/409/rollback assertions and
`ItemDrawer.a11y.test.tsx`'s focus/Escape assertions possible at all
without a real browser. AdminLTE is explicitly a *visual* reference in
the assignment ("AdminLTE administration UI") - nothing requires the
literal jQuery implementation.

**Rules out:** importing `admin-lte`'s JS bundle alongside React (two
different, uncoordinated systems fighting over the same DOM nodes -
a well-known source of hard-to-debug bugs); a server-rendered
(Nunjucks/EJS) admin UI living inside the NestJS service itself
(would blur "Management Service owns the authoritative API" with
"Management Service also renders admin HTML," and still wouldn't get
jQuery-plugin behavior load-bearing-tested any more easily).

## 24. Sign-in is "enter a known user id," not a fake login, and is a three-state machine (Phase 6)

**Decision:** `CurrentUserContext`/`SignInGate` require the operator to
enter a real, already-existing user id once (there is no anonymous
`GET /api/users` to bootstrap a picker from - and this UI must never
add one, since that would weaken the existing trust model for every
other client too). `status` is `'checking' | 'signed-out' |
'signed-in'`, not a boolean derived from "is there an id in
localStorage" - a stored id is only a *candidate* until
`GET /api/users` actually confirms it.

**Why:** The three-state design is not incidental - an earlier,
boolean (`isSignedIn = currentUserId !== null`) version had a real
bug, caught by `SignInGate.test.tsx` the first time a test reused a
previous test's `localStorage` state: the gate rendered protected
content immediately on a stored id, then only asynchronously
discovered (and reverted) that the id was invalid - meaning on a real
page reload with a since-deleted or never-valid stored id, a user
would briefly see the real app shell before being bounced back to the
sign-in form. `status === 'checking'` closes that window entirely:
protected content is only ever rendered once `GET /api/users` has
actually succeeded for the id in question, whether that happens via a
fresh manual sign-in or via rehydrating a stored one.

**Rules out:** treating "there is a value in localStorage" as
equivalent to "signed in" (the bug above); a hardcoded demo user
(would misrepresent a multi-user workspace and couldn't exercise the
real per-user `X-Dev-User-Id` trust mechanism the assignment is
actually testing); adding a backend "list users anonymously" endpoint
to make first-run easier (a real weakening of the existing trust
model's one rule - every route but health checks requires a known
user - for this UI's convenience).

## 25. Board moves are optimistic-with-rollback, never optimistic-without-verification (Phase 6)

**Decision:** `useBoardItems.ts`'s `moveItem` is the single function
every move path (drag/drop, the keyboard "Move to…" select, the
keyboard up/down reorder buttons) calls. It (1) applies the move to
local state immediately, marking the item `pending`, (2) sends
`expectedVersion` and the computed `targetColumnId`/`beforeItemId`/
`afterItemId` to the real `POST /api/items/:itemId/move`, (3) on
success, replaces the optimistic guess with the server's own returned
item, (4) on any other failure, rolls back to the pre-move snapshot,
and (5) on a 409 specifically, discards local state entirely and
refetches the whole board+items from the server, with a message that
names the conflict rather than a generic failure toast.

**Why:** A pure "fire the request and trust the UI already shows the
right thing" approach (no rollback) would let the board visibly lie
about state the server rejected. A non-optimistic approach (wait for
the server before moving anything visually) would make every drag feel
laggy for no correctness benefit in the common case. Optimistic
with verified rollback gets both: responsive drag/drop, and a board
that can never diverge from server truth for longer than one round
trip - and never silently; a 409 is common in exactly the "someone
else is using the same board right now" scenario a multi-user Kanban
tool must expect, so it gets its own, more thorough recovery
(full refetch, not just "put this one card back") rather than being
treated like any other error.

**Rules out:** mutating board state anywhere outside `moveItem`
(every drag handler, keyboard handler, and the create-item form all
funnel through the same repository-shaped hook, never their own
`setItems` calls); treating a 409 the same as a 500 (a 409 means
"your local view is stale," which specifically calls for a refetch,
not a retry of the same now-known-wrong request).

## 26. CORS is an explicit, non-wildcard origin allow-list, never credentialed (Phase 6)

**Decision:** `app.enableCors({ origin: adminUiOrigins, ... })` in
`src/main.ts`, where `adminUiOrigins` comes from `ADMIN_UI_ORIGIN`
(comma-separated, default `http://localhost:5173`) - never
`origin: true`/`'*'`, and no `credentials: true` (no cookies are
involved anywhere in this system's trust model - `X-Dev-User-Id` is a
header the client sets explicitly, not an ambient credential a
different origin's page could ride along for free).

**Why:** This is the first time this API has ever accepted
cross-origin requests (every prior phase only had same-origin tooling
- curl, supertest, Postman - call it). Enabling CORS is necessary for
the browser-based admin UI to function at all, but must not become a
general weakening of the API's exposure: an explicit allow-list means
an arbitrary website cannot call this API from a victim's browser,
and the absence of `credentials: true` means there is no ambient
authority (cookies) for CORS to even need to protect here in the first
place - the actual authority (`X-Dev-User-Id`) must be deliberately
set by whatever code is making the request, same as every curl example
already in `docs/API.md`.

**Rules out:** a wildcard origin (would let any website make
authenticated-shaped requests on a user's behalf if they ever guessed
or phished a user id); enabling `credentials: true` (not needed - would
only add risk for a trust mechanism that isn't cookie-based anyway).

## 27. `EventConsumer`/`replay.py` catch the builtin `TimeoutError` on an idle fetch, not just `nats.errors.TimeoutError` (Phase 5 code, found live during Phase 6)

**Decision:** `messaging/consumer.py`'s `run_forever` and `replay.py`'s
fetch loop both catch the builtin `TimeoutError` on an empty
`sub.fetch()` result, not `nats.errors.TimeoutError` specifically.

**Why:** Found live, by accident, during this phase's manual
verification: the long-running Python service (left running from
Phase 5's own verification) crashed entirely partway through - not
during any of the request/response work being verified, but from its
own idle-poll loop finding no new messages. The traceback showed a
bare `asyncio.exceptions.TimeoutError` (not `nats.errors.TimeoutError`)
raised from inside `nats-py`'s own `js/client.py` (`_fetch_n`'s
"second request: lingering request" path, which does
`raise asyncio.TimeoutError` directly when its deadline is already
exhausted) propagating out of `sub.fetch()`, out of `run_forever`'s
`except nats.errors.TimeoutError` clause (which does not match it -
`nats.errors.TimeoutError` is a *subclass* of the builtin, so catching
the subclass does not catch the parent class raised directly), out of
the task, and through `asyncio.gather(*tasks)` in `main.py` - which
kills every other task (the health HTTP server, the responders)
too, not just the consumer loop. Confirmed by direct inspection of
`nats-py`'s installed source (the exact `raise asyncio.TimeoutError`
line) and reproduced deterministically in a unit test
(`test_run_forever_survives_a_raw_builtin_timeout_error_from_an_idle_fetch`)
that fails against the old `except nats.errors.TimeoutError` clause
and passes against the fixed `except TimeoutError` one. Catching the
builtin is a strict superset: `nats.errors.TimeoutError` instances are
still caught too, since that class subclasses the builtin.

**Why this escaped Phase 5's own test suite**: every existing
automated test that exercised `sub.fetch()` either always had a
message ready (the real-NATS integration tests always publish before
fetching) or used a `_FakeProcessor`-driven scenario with controlled
outcomes - none of them let the real consumer idle-poll a genuinely
empty real stream for its full timeout window the way a long-running
process naturally does. This is now covered.

**Rules out:** treating this as an acceptable restart-and-move-on
cost (a crashed consumer silently stops consuming until someone
notices and restarts it - exactly the kind of failure this project's
whole messaging-reliability design (Phase 4/5) exists to avoid);
catching a bare `except Exception` around the fetch call instead
(would also swallow genuine connection/protocol errors that
`ConnectionClosedError` handling right below it is specifically
meant to surface, not hide).

## 28. Mobile sidebar: explicit fixed-position insets + a backdrop + auto-close-on-navigate, not just a negative margin (Phase 6, found in manual browser verification)

**Decision:** Rewrote the `<768px` sidebar CSS to give the fixed-
position `.app-sidebar` explicit `top`/`left`/`bottom` (not just a
negative `margin-left`), added a dedicated backdrop element
(`.app-sidebar-backdrop`, hidden by default via an explicit base-level
`display: none` so it never renders as a stray empty `<button>` on
desktop) that closes the menu on click, and made the sidebar close
itself automatically on navigation (`Sidebar`'s own link `onClick`,
plus a `Shell`-level `useEffect` keyed on the route as a backstop for
any non-click navigation). Also removed the Vite React template's
leftover default `src/index.css` content (a centered, fixed-width
`#root` with large marketing-page heading styles) - it was never
appropriate for this app and was fighting `styles/app.css`'s real
layout.

**Why:** Found in this phase's manual browser verification at ~390px:
the sidebar stayed open and full-width, squeezing the main content.
A fixed-position element's `top`/`left`/`right`/`bottom` default to
`auto`, which resolves to the element's *static* (in-flow) position
when unset - an ambiguity across browsers/layout contexts that a
negative-margin-only approach depends on resolving "correctly" by
accident rather than by being pinned explicitly. Explicit insets
remove that ambiguity entirely. Separately, the leftover scaffold
`index.css` constrained `#root`'s width/centering in a way no part of
`styles/app.css` was written to coexist with - real residue from never
having cleaned up the starter template, not a design decision.

**Rules out:** relying on `margin-left` alone to hide/show the sidebar
(the mechanism that didn't reliably work); leaving the sidebar open
after navigating to a new page on mobile (a real usability trap - the
menu would visually appear "stuck open" exactly as reported); leaving
the scaffold's `index.css` in place "because it's mostly harmless" -
unused leftover template styling actively competing with real layout
rules is exactly the kind of residue that causes this class of bug and
should be deleted, not tolerated.

**Not independently re-verified by a human in Chrome this round** (no
browser tool was available in this session either) - `Shell.test.tsx`
covers the *behavioral* contract (class toggling, backdrop click,
auto-close on navigate) that the CSS depends on, since jsdom does not
evaluate `@media` queries or compute real layout. The actual rendered
result at <768px still needs your eyes to confirm - see the report's
"requires user manual re-verification" section.

## 29. Activity shows issueKey (resolved from item_state), never a fabricated title, never a management_db read (Phase 6, found in manual browser verification)

**Decision:** `item_state` (projections/state.py) now also captures
`issueKey` from `workitem.created`'s own payload (the only event that
ever names it - docs/EVENT_CATALOG.md). `ActivityResponder` bulk-
resolves `issueKey` for every WorkItem-aggregate entry from that same
projection and includes it in its reply; `admin-ui`'s `ActivityPanel`
renders it in place of the raw aggregate id when present, falling back
to `{aggregateType} {aggregateId}` otherwise (non-WorkItem aggregates,
or a WorkItem whose `created` event hasn't been processed yet).

**Why:** Found in manual verification: Activity showed raw internal
ids, e.g. "moved WorkItem 6ac5...". The brief asked for issue key
*and title* where practical, but explicitly "using only existing
event/projection data" and never cross-reading `management_db`. This
project's events deliberately never carry free-text field content
(title/description/acceptanceNotes) - see
`docs/ARCHITECTURE.md` "Events are facts... without exposing
secrets" and the `workitem.updated` payload note in
`docs/EVENT_CATALOG.md` ("free-text fields... never their content").
That is a prior, deliberate design decision this phase must not
quietly violate just to make one screen's labels nicer. issueKey *is*
real event data (present in `workitem.created`'s payload) and is the
one durable, stable, human-meaningful identifier every event's
aggregate actually has - so it is the correct, policy-compliant
answer to "make this readable using only existing event/projection
data," and title is not currently achievable without a rule change
this phase was not asked to make.

**Rules out:** reading `management_db.work_items` (or any management_db
collection) from the Python service or the admin UI to fetch a title -
a direct violation of service ownership (docs/ARCHITECTURE.md "Trust
boundary") and of this specific instruction; inventing/guessing a
title from other fields; adding `title` to future event payloads as a
workaround (a real, considered change to the event contract that
would need its own review - e.g. whether a title ever changes
sensitively - not a Phase 6 UI-label fix to make unilaterally).

## 30. Pre-existing item_state documents needed an explicit, narrow backfill - decision #29's fix alone did not retroactively repair them (Phase 6, found in the user's own re-verification)

**Decision:** Decision #29's capture of `issueKey` into `item_state`
only runs inside `apply_event`'s version-gated write path - it affects
newly-processed `workitem.created` events, not documents that were
already projected (by the pre-#29 code) before that fix existed, since
a redelivery of the same-or-lower-version `created` event is correctly
treated as STALE and triggers no write at all (see projections/
state.py's module docstring on why staleness must be a read-first
decision). Confirmed by direct inspection of the real `insights_db`:
all 3 real WorkItem documents in `item_state` had no `issueKey` field.

Added `activity_insights/backfill.py` (`python -m
activity_insights.backfill`): a one-off script, never an HTTP endpoint
(same rule as replay.py), that opens a *new*, separate durable
consumer on the real `TEAM_EVENTS` stream - filtered to only the
`tm.v1.workitem.created` subject - reads each event's own real
`issueKey`, and calls a new `ItemStateRepository.backfill_issue_key`,
which *only* sets a currently-missing `issueKey` on a document that
already exists; it never creates a document, never overwrites one
that already has a value, and never touches any other field. It never
touches management_db, never touches the assignment-mandated
`activity-insights-v1` consumer, and deletes its own throwaway
consumer once caught up. Run once against the real data: saw 16
`workitem.created` events, updated the 3 real WorkItem documents that
were missing `issueKey`; verified afterwards via a direct
`tm.query.v1.project_activity` request and via the real `GET /api/
projects/:id/activity` endpoint that `issueKey` is now present on
every WorkItem entry.

**Why:** The user's own re-verification in Chrome still showed raw
WorkItem ids after #29 shipped - #29 was necessary but not sufficient,
because it only changes behavior for events processed *after* the
code change, not data already sitting in the live projection. The user
explicitly anticipated this ("If old activity rows need rebuilding,
replay/rebuild the activity projection safely from TEAM_EVENTS") and
required it be done without fabricating any value and without mutating
management_db.

**Rules out:** relying on redelivery/replay of the live
`activity-insights-v1` consumer to self-heal this (it won't - the
version gate makes already-recorded events permanently STALE relative
to current state, by design, and redelivery of already-acked messages
isn't guaranteed or desirable to trigger anyway); a full
replay-into-namespaced-collections-then-promote approach (replay.py's
existing pattern) - rejected as unnecessarily broad and riskier than a
narrow, field-scoped, idempotent backfill, since it would require
copying/overwriting whole live collections rather than touching only
the one missing field; widening `backfill_issue_key` to overwrite an
existing issueKey - never needed (issueKey is immutable per item) and
would make the tool capable of corrupting already-correct state on a
bad future run.

## 31. Phase 7's real-NATS e2e "no responder"/timeout tests are environment-conflicted while the real Python service is also live - not a code defect

**Decision:** Left `test/nats-integration.e2e-spec.ts`'s three request/
reply tests asserting `NO_RESPONDER`/`TIMEOUT` on the real, production
subject names (`tm.query.v1.project_insights`,
`tm.query.v1.project_activity`) unchanged, and documented the failure
rather than "fixing" it.

**Why:** These three tests only fail when the real
`activity-insights-service` happens to be running at the same time
(this project's own long-lived dev instance, kept up across this
session for live verification) - it genuinely subscribes to those
exact subjects and genuinely answers (`not_ready`/
`NO_DATA_YET_FOR_PROJECT`), so the test's "assert nothing answers"
premise is false for reasons outside the test's or the code's control,
not because `InsightsClientService`/`ActivityClientService` behave
incorrectly. Run standalone (real Python service stopped), these three
pass; the other 13 e2e tests plus all 181 unit tests pass regardless.

**Rules out:** weakening the assertion (e.g. accepting either a real
reply or NO_RESPONDER) - that would silently stop testing the actual
timeout/no-responder code path, which is a real, load-bearing
behavior (docs/ARCHITECTURE.md's "acceptable, cheap degradation"
contract) this project still needs proof of; stopping the live Python
service to force a clean CI-style run - a shared-infrastructure action
outside this task's narrow "test audit" scope, and unnecessary since
the three tests' correctness was independently re-confirmed by their
own prior passing runs earlier this session (before the Python service
was left running continuously) and is provably a live-responder
artifact, not a regression, from the error messages' own content
(`NO_DATA_YET_FOR_PROJECT` is a real Python-service reason string, not
a malformed-reply or code-level failure).

Separately, an unrelated environment issue was found and fixed this
phase: `admin-ui`'s `npm ci` crashed mid-reinstall
(`EPERM: operation not permitted, unlink ... rolldown-binding...node`)
because its own live Vite dev server (started earlier for manual
Chrome verification) held that native binding file open - Windows
cannot delete a loaded native module out from under the process using
it. `npm ci` deletes `node_modules` before reinstalling, so the crash
left `node_modules/.bin` empty (no `vitest`/`tsc`/`oxlint`). Repaired
with a plain `npm install` (which merges/repairs rather than wiping
first) - confirmed back to a fully working state (`npm test`,
`npm run build`, `npm run lint` all clean) immediately after. Not a
dependency defect; a true from-cold `npm ci` would need the dev server
stopped first, which this phase did not do (same "don't take down
shared live infrastructure without asking" boundary as above).

## 32. Decision #31's e2e conflict resolved with a test-only per-request subject override, not by touching shared live infrastructure; queue-group distribution proven with a dedicated real-broker test

**Decision:** Gave `InsightsClientService`/`ActivityClientService` a
third, optional constructor-config lookup -
`INSIGHTS_QUERY_SUBJECT_OVERRIDE` / `ACTIVITY_QUERY_SUBJECT_OVERRIDE` -
read exactly like the existing `INSIGHTS_QUERY_TIMEOUT_MS` lookup:
`config.get(KEY) ?? <the real PROJECT_*_QUERY_SUBJECT constant>`. Real
deployments never set this key, so production behavior - the exact
subject, from `events/subjects.ts` - is unchanged; verified by a new
assertion in `test/nats-integration.e2e-spec.ts` reading the
constructed client's private `subject` field via a white-box cast.
`test/nats-integration.e2e-spec.ts`'s five request/reply tests now each
generate their own `test.insights.<uuid>`/`test.activity.<uuid>`
subject per test and pass it through the override, instead of
publishing/subscribing on the real production subject.

Also added one new test to the existing "durable pull consumer" block:
two independent `Consumer` handles (`js.consumers.get`, called twice)
bound to the *same* durable consumer name concurrently `fetch()` a
real 10-message backlog on a dedicated throwaway, filtered consumer.
Asserts the real broker's actual behavior, not a simulated one: all 10
sequence numbers are collected across the two handles combined with
*zero* overlap (no duplicate delivery) and *both* handles receive at
least one message (genuine distribution, not one handle doing all the
work while the other sits idle). Run 5 times across this task
(isolated x3, plus twice more as part of the full e2e suite) with
identical pass results every time - not a one-off.

**Why:** Decision #31 documented the three-test failure as an
environment conflict (the real Python service answering) rather than
fixing it, reasoning that fixing it would mean either weakening a real
assertion or stopping shared live infrastructure the session doesn't
own outright. Told to resolve this without weakening assertions, the
per-request unique-subject approach does both at once: it is
*stronger* isolation than "stop the other service" would have been
(immune to literally anything else in the NATS account ever subscribing
to the real subject, not just immune to this one specific Python
instance on this one specific run) and requires no process orchestration
in the test file at all. It also quietly fixed a latent, never-reported
flakiness risk in the two "returns ok" tests in the same block, which
raced the real Python responder for who answered first and were not
part of the original complaint only because the in-process stub
happened to answer faster every time it was tried.

The queue-group/competing-consumers item was previously left as an
explicitly out-of-scope gap (docs/TIMELOG.md Phase 4 notes, "the
assignment's own 'stretch goal'... not attempted"). Asked to verify it
for Phase 7 without turning it into a feature build, the smallest
faithful demonstration is exactly what JetStream pull consumers already
do natively: no new "queue group" primitive exists to build or
configure for pull consumption (that concept is Core NATS pub/sub
terminology) - any number of independent handles on one durable
consumer name inherently compete for its pending backlog. So the task
was purely to *prove* that existing, already-relied-upon mechanism with
a real test, not to add a feature.

**Rules out:** stopping/starting the real Python responder from inside
the Jest test file - fragile (shells out across a process/language
boundary the test suite doesn't own), not reproducible in a plain CI
runner that never has that Python service running in the first place
(in which case the original 3 tests would already have been green -
this environment's own long-lived dev instance was the entire reason
they were ever red), and unnecessary once the subject itself is
test-unique; weakening the `NO_RESPONDER`/`TIMEOUT`/`ok` assertions to
also accept a real reply - would stop testing the actual fallback
contract; implementing real queue-group consumer-group management,
a replica-count config knob, or any other Phase-8-shaped feature work -
out of scope, not what was asked.
