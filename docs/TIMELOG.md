# Time Log

Target: 18 hours. Hard limit: 20 hours. Track actual time spent per
phase so slippage is visible early rather than discovered at hour 19.

| Phase | Scope                                                              | Start (local)         | End (local) | Duration | Notes |
|-------|---------------------------------------------------------------------|------------------------|-------------|----------|-------|
| 1     | Repo foundation, service skeletons, NATS/JetStream compose, docs    | 2026-10-06 19:52 PST   | 2026-10-06 20:50 PST | ~0h 58m  | Includes runtime verification of NATS/JetStream (healthz, jsz, volume mount, logs). |
| 2     | MongoDB persistence foundation (connection, health/readiness, index bootstrap, workspace-scoping base repo) for both services | 2026-10-06 20:52 PST | 2026-10-06 21:36 PST | ~0h 44m | Includes an npm lockfile drift caught and fixed via full regeneration (see notes below). |
| 2b    | Live Atlas verification of Phase 2 (real `.env` files, both services started against the real cluster) | 2026-10-06 22:48 PST | 2026-10-06 23:06 PST | ~0h 18m | Blocked on Atlas authentication - see notes below. Not yet a clean pass. |
| 2c    | Re-verification after Atlas password correction | 2026-10-06 23:14 PST | 2026-10-06 23:16 PST | ~0h 02m | Clean pass - both services ready against live Atlas. See notes below. |
| 2d    | Fix Python packaging/startup (`PYTHONPATH` workaround → editable install) | 2026-10-06 23:18 PST | 2026-10-06 23:26 PST | ~0h 08m | Proper fix, not a hack. See notes below. |
| 3     | Authoritative NestJS business domain + REST API (teams, memberships, projects, boards, work items, optimistic concurrency, move/reorder, validation/rate-limiting, tests, docs) | 2026-10-06 23:30 PST | 2026-10-07 00:31 PST | ~1h 01m | Includes an abandoned `mongodb-memory-server` integration-test attempt (see notes below). |
| 4     | Messaging reliability: canonical event envelope, transactional outbox, JetStream stream/consumer bootstrap, publisher relay, retry/backoff, correlation IDs, request/reply insights client, health diagnostics, tests, docs | 2026-10-07 09:08 PST | 2026-10-07 10:20 PST | ~1h 12m | Atlas transaction verification blocked by a local TLS issue (not an Atlas limitation) - see notes below. Real local NATS integration suite (12 tests) passes. |
| 4a    | outbox_events index registry gap closed (missed in the initial Phase 4 pass); live-verification script + instructions handed off for the user to run outside the sandbox | 2026-10-07 10:03 PST | 2026-10-07 10:20 PST | ~0h 17m | See notes below. |
| 4b    | Live Mongo connection-lifecycle bug found by the user running the real app outside the sandbox (`MongoTopologyClosedError`), root-caused and fixed | 2026-10-07 10:25 PST | 2026-10-07 10:33 PST | ~0h 08m | See notes below - `docs/DECISIONS.md` #16 has the full root cause. |
| 4c    | Live Phase 4 verification re-run by the user (post-fix) against real Atlas + real local NATS, outside the sandbox - full pass, evidence recorded | 2026-10-07 10:35 PST | 2026-10-07 10:40 PST | ~0h 05m | 13/13 checks passed. See notes below. |
| 4d    | Second independent live verification re-run by the user (same setup as 4c), plus a manual cross-check of the PubAck evidence - confirms reproducibility, not a one-off pass | 2026-10-07 (same session, immediately after 4c) | 2026-10-07 | not separately timestamped by the user | 13/13 checks passed again; stream sequence 45 (correctly advanced from 44, as expected for a new publish). **Phase 4 marked VERIFIED END-TO-END.** See notes below. |
| 5     | Activity & Insights Service (Python): envelope validation, inbox dedup, version-gated item_state, activity/workload projections, bounded retry + poison path, real Core NATS responder, consumer-state health, replay script, tests, docs | 2026-10-07 ~11:10 PST | 2026-10-07 ~12:25 PST | ~1h 15m (approximate - not individually stamped at task start) | Three real bugs found and fixed live against real Atlas + real NATS (shared-MongoClient-session; inbox/processing_failures missing namespace support; a transaction-poisoning upsert-conflict pattern that caused a real multi-minute hang) - see notes below and `docs/DECISIONS.md` #17-20. Full real backlog (45 messages) processed cleanly after fixes - see notes. |
| 5a    | Final live end-to-end workload verification (real NestJS API + real Atlas + real NATS + real Python consumer, fresh team/project/work items) and an `ack_wait` documentation-vs-deployed-config re-check | 2026-10-07 ~12:30 PST | 2026-10-07 ~12:40 PST | ~0h 10m | Non-zero workload counts confirmed correct and non-duplicated end to end; the earlier "ack_wait drift" note was itself found to be a misdiagnosis and corrected - see notes below and `docs/DECISIONS.md` #21. |
| 6     | Admin UI (`admin-ui/`): dashboard, teams, projects, Kanban board (drag/drop + keyboard move, optimistic-with-rollback, 409 recovery, filters, WIP badge), work-item drawer (team-restricted assignee), real activity timeline, real insights, sign-in gate, tests | 2026-10-07 ~13:15 PST | 2026-10-07 ~14:00 PST | ~0h 45m (approximate) | Two new minimal backend additions (`GET /api/projects/:id/activity`, documented `GET /api/users`); one real frontend bug found and fixed by its own test (sign-in gate flashing protected content for a stale id); one real **Phase 5** backend bug found live (the Python consumer crashing on an idle-poll timeout) and fixed with a regression test - see notes below and `docs/DECISIONS.md` #22-27. |

Add a new row per phase - do not overwrite history.

### Phase 2 notes

`npm ci` failed on a stale `package-lock.json` (optional platform
packages `@emnapi/*` / `@unrs/resolver-binding-*` had drifted out of
internal sync after incremental `npm install` runs across several
dependency edits). Fixed by deleting `node_modules` and
`package-lock.json` and running a single clean `npm install`, then
re-verifying with `npm ci`. No dependency versions in `package.json`
changed because of this - it was purely a lockfile regeneration.

### Phase 2b notes (live Atlas verification)

Two issues were found and fixed without ever reading or printing any
secret value (URI/username/password) - only variable *names* and
generic, non-secret server error metadata were inspected:

1. Both real `.env` files used the key `MONGODB_DATABASE` instead of
   the documented `MONGODB_DB_NAME`. Detected by listing env var names
   only (never values) and comparing against `.env.example`/code.
   Fixed by renaming the key in place in each `.env` (`sed` on the key
   only, value never touched, read, or displayed).
2. The Python service's documented startup command
   (`python -m activity_insights.main`) failed with
   `ModuleNotFoundError: No module named 'activity_insights'` because
   `src/` isn't on `PYTHONPATH` outside of pytest (which sets it via
   `pyproject.toml`). Worked around with `PYTHONPATH=src` for this
   verification run - **not yet fixed as a permanent packaging change**
   (see "anything incomplete" in the Phase 2b report).

After both fixes, each service started cleanly and `GET /health`
(Node) / `GET /healthz` (Python) returned 200 - liveness is confirmed
end-to-end. **Readiness is not yet confirmed**: both
`GET /health/ready` and `GET /readyz` returned 503, and both services
independently logged the identical MongoDB server error - codeName
`AtlasError`, numeric code `8000`, message `bad auth : Authentication
failed.` This is a real Atlas-side authentication rejection (TLS/network
connectivity is fine - the driver reached the server and got an auth
response, it didn't time out), not a code defect: both services'
driver/config/guard code behaved exactly as designed (fail closed,
report 503, log only the generic non-secret server error). Diagnostic
logging was extended on both services to surface MongoDB's own generic
`codeName`/error-code/message (never the connection string or
credentials - these are fixed server-side strings, not derived from
client secrets) to make this class of failure diagnosable without ever
exposing a secret. Root cause is on the Atlas/credentials side and is
for the user to resolve (verify the database users' username/password,
confirm any special characters in the password are percent-encoded in
the URI, and confirm the users have finished propagating) - Phase 2
live verification is blocked on that, not on anything in this
codebase.

### Phase 2c notes (clean pass)

After the Atlas passwords were corrected in both real `.env` files (by
the user; no credential value was ever read, printed, or modified by
the assistant), both services were restarted against the live cluster:

- Management Service: `GET /health` → 200, `GET /health/ready` → **200**
  (`{"status":"ok","database":"management_db"}`).
- Activity & Insights Service (`PYTHONPATH=src python -m
  activity_insights.main`): `GET /healthz` → 200, `GET /readyz` →
  **200** (`{"status":"ok","database":"insights_db"}`). Startup logs
  also show the inbox `event_id` index was created successfully this
  time (no warning), confirming write-level access, not just read.
- Both services' startup/runtime logs were screened for
  `mongodb://`/`mongodb+srv://` patterns before being viewed (zero
  matches both times) and contained no errors.
- `git status` and `git check-ignore -v` re-confirmed both `.env`
  files remain untracked/ignored after this run.

Phase 2 is now fully verified end-to-end against the live Atlas
cluster. The `PYTHONPATH=src` workaround (Phase 2b note 2) is still
outstanding as a permanent packaging fix - tracked, not blocking.

### Phase 2d notes (Python packaging fix)

Replaced the `PYTHONPATH=src` workaround with a proper editable
install: added `-e .` as the first line of `requirements.txt`. The
project already declared a `src`-layout package in `pyproject.toml`
(`[tool.setuptools.packages.find] where = ["src"]`), it just was never
actually installed - only its dependencies were. `pip install -r
requirements-dev.txt` (which pulls in `requirements.txt`) now installs
`activity_insights` itself in editable mode, so it is importable, and
`python -m activity_insights.main` runs, from any working directory
with no `PYTHONPATH` set. Verified on a completely fresh venv with
`PYTHONPATH` explicitly unset. No sys.path hacks, no src-layout change,
no application behavior change - `pytest`/`ruff`/`mypy` all still pass
unchanged, and the service's `/healthz` and `/readyz` responses against
the live Atlas cluster are identical to Phase 2c.

### Phase 3 notes

Implemented teams/memberships/roles, projects, one-board-per-project
with default columns, Jira-like work items (issue-key generation,
optimistic concurrency, move/reorder with rank rebalancing), the
request-context trust mechanism, and the validation/rate-limiting/
error-envelope security baseline - see `docs/ARCHITECTURE.md` and
`docs/DECISIONS.md` #8-10 for the design, `docs/API.md` for every
route.

**Abandoned sub-attempt**: added `mongodb-memory-server` to get real
MongoDB-backed integration tests for the new business rules. Its
`mongod` binary download stalled indefinitely in this sandboxed
network environment (confirmed via a monitored retry - identical byte
count across two separate install attempts and a dedicated
stall-detection check; not a slow transfer, a dead one). Removed the
dependency entirely (devDependency, global setup/teardown files, test
helpers) rather than leave a flaky or silently-skipped piece of the
test suite. Business-rule tests are mocked-repository unit tests
instead (`src/**/*.spec.ts`) - see Decision #9 for the full reasoning,
including why even HTTP-level "validation only" e2e tests weren't a
viable middle ground (every protected route resolves `RequestContext`
via a real DB lookup before anything else runs).

**Caught and fixed before reporting**: the now-nonempty
`INDEX_REGISTRY` (six Phase 3 collections) meant the existing
Phase 1/2 e2e health-check test now pays real connection-attempt
latency (6 x up to 2s) during every app boot against the
intentionally-unreachable test placeholder. Bumped
`test/jest-e2e.json`'s `testTimeout` 20s -> 30s for margin after
observing the suite legitimately take ~24-50s depending on run; this
is bounded and expected, not a hang.

**Also caught and fixed**: `npm run seed`'s first real run (against
the live Atlas cluster) printed nothing at all despite exiting 0 -
`NestFactory.createApplicationContext(AppModule, { logger: false })`
silences Nest's `Logger` class process-wide (not just framework
noise), which swallowed the script's own `logger.log(...)` calls
along with it. Fixed by switching the script's own output to plain
`console.log`/`console.error`, independent of Nest's logger state.
Re-ran for real afterward: one workspace + 4 users created
successfully in `management_db` on the live Atlas cluster (output
screened for connection-string patterns before being viewed - none
found, as expected, since the script never logs the URI).

Full verification run (fresh `npm ci`, not just incremental `npm
install`): `npm run build` passed, `npm run lint` passed (0 errors
after fixing unnecessary-assertion and unsafe-`any` findings -
mongodb's generic `Filter`/`UpdateFilter` types needed a few explicit
casts), `npm test` passed (76/76), `npm run test:e2e` passed (2/2),
`npm audit --omit=dev` -> 0 vulnerabilities, `git diff --check` ->
clean (CRLF notices only), secret scan -> clean (matches only the two
expected ignored `.env` files), `git check-ignore -v` -> both `.env`
files still ignored. Nothing committed or pushed.

### Phase 4 notes

**Atlas transaction verification.** Attempted first, as instructed,
before writing any transaction code: a throwaway script
(`verify-transactions.js`, scratchpad-only, never committed) connected
with the real `.env`, ran a `session.withTransaction()` committing and
reading back two documents in a scratch collection, then a second
transaction verifying abort/rollback, then cleaned up only its own
probe documents. It could not complete - `MongoServerSelectionError`
against all three resolved replica members
(`ac-lfesm2b-shard-00-0{0,1,2}.iz4dzeu.mongodb.net`). Diagnosed further
without ever printing the URI/credentials:

- `Test-NetConnection` to `shard-00-00:27017` succeeded (`TcpTestSucceeded: True`) -
  the port is reachable at the TCP layer.
- `openssl s_client -connect shard-00-00:27017 -tls1_2` (no Node/driver
  involved at all) failed immediately after the ClientHello with `SSL
  alert number 80` ("internal error"), reproduced consistently.
- General HTTPS egress from the same environment worked fine (`curl`
  to google.com and cloud.mongodb.com both returned expected status
  codes), so this is not a blanket network outage - it's specific to
  the non-HTTP TLS handshake on MongoDB's wire-protocol port.
- Live DNS SRV resolution against Atlas's real infrastructure
  succeeded and returned exactly three `shard-00-0N` hosts - Atlas's
  standard replica-set member naming, independent evidence the
  deployment is a multi-node replica set (consistent with
  `docs/ARCHITECTURE.md`'s documented M0 free tier, which Atlas always
  deploys as a 3-node replica set).

Conclusion: this is a local network/TLS-interception issue (most
likely security software or a network appliance that inspects/blocks
non-HTTPS TLS on non-standard ports), not evidence about Atlas's
capabilities, and not something further debugging inside this session
was likely to resolve productively. Given the structural replica-set
evidence, real MongoDB transactions (`session.withTransaction()`) were
implemented as designed - not a non-transactional fallback. This is
the one honestly incomplete verification item for Phase 4 - see
`docs/DECISIONS.md` #11 for the full decision record and the exact
next step for whoever has working Atlas connectivity.

**Real local NATS JetStream integration.** `docker compose up -d nats`
(already running from earlier phases) was used directly - no mocks.
`test/nats-integration.e2e-spec.ts` (12 tests, all passing): idempotent
stream + durable-consumer bootstrap, real publish + PubAck, the
published message verifiably present in the stream, `Nats-Msg-Id`
duplicate detection (second publish of the same `eventId` returns
`duplicate: true`, same sequence number), the full `OutboxRelayService`
flow against the real server (publish-before-mark ordering verified
end to end, not just via mocks), a retryable-outage case against an
intentionally-unreachable NATS port, pull-consumer fetch/ack and
ack-wait redelivery, a durable consumer resuming from its acknowledged
position after being recreated (simulated restart), and Core NATS
request/reply success/no-responder/timeout against both a real stub
responder and genuinely nothing listening.

**Scope not covered by the integration suite**: a live-Mongo-backed
outbox persistence test (claim/lease concurrency, uniqueness) - blocked
by the same Atlas connectivity issue above, and this project has no
Dockerized local MongoDB by design (`docs/ARCHITECTURE.md` "Local
infrastructure"). Covered instead by mocked-repository unit tests
(`outbox.repository.spec.ts`, `outbox-relay.service.spec.ts`),
consistent with this project's existing Phase 3 precedent
(`docs/DECISIONS.md` #9). Also not covered: NATS server restart during
a live test run (would require shelling out to `docker restart` mid-test;
documented as a next step, not fabricated as tested) and queue-group
load balancing across two consumer instances (the assignment's own
"stretch goal" list, section 20 - optional, not attempted).

**Lint**: five categories of `typescript-eslint` findings surfaced
while writing the new messaging code and its tests - unnecessary type
assertions (narrowed-by-control-flow variables didn't need `!`/`as`
after all), unsafe enum-vs-string comparisons against the `nats`
package's string enums (fixed by casting the enum side to `string` at
the comparison, or normalizing both sides via `String(...)`),
`require-await` on test doubles that didn't actually need `async`, and
unsafe `any` propagation from an untyped Jest mock callback parameter
(fixed by importing and applying the real `EnqueueEventInput` type).
All fixed; `npm run lint` is 0 errors.

**Reproducibility**: `npm install` after adding `nats`/`ulid`
initially left `package-lock.json` with a stale optional-dependency
sub-entry (`@emnapi/wasi-threads` pinned to an older version than what
was actually resolved) that made `npm ci` fail with `EUSAGE` - the
same class of lockfile drift Phase 2 hit (see that section above), not
specific to Phase 4's new dependencies. Fixed the same way: `npm
install` to regenerate the lockfile, confirmed with `npm ci` afterward
(clean). `npm audit --omit=dev` -> 0 vulnerabilities (the 20 moderate
findings are all devDependency-only tooling).

Full verification run: `npm ci` (clean, after the lockfile
regeneration above), `npm run build` passed, `npm run lint` passed (0
errors), `npm test` passed (148/148 across 19 suites), `npm run
test:e2e` passed (14/14 across 2 suites - the existing health-check
suite plus the new 12-test real-NATS integration suite),
`npm audit --omit=dev` -> 0 vulnerabilities, `docker compose config`
valid, `git diff --check` -> clean (CRLF notices only, same as every
prior phase on this Windows checkout), secret scan over every new/
modified file -> clean, `.env` confirmed untracked
(`git ls-files services/management-service/.env` empty). Nothing
committed or pushed.

### Phase 4a notes (index gap + live-verification handoff)

Closed a real gap named in the Phase 4 report: `outbox_events` had no
entries in `INDEX_REGISTRY` (`event_id_unique`, `unpublished_lookup_idx`
added). Since live Atlas is unreachable from this sandboxed environment
(Phase 4's TIMELOG note / `docs/DECISIONS.md` #11), wrote and
pre-tested (against the real local NATS, the parts that don't need
Atlas) two standalone verification scripts for the user to run
themselves in a normal terminal: `phase4-live-verify.js` (Atlas ping,
outbox index check, real `POST /api/teams`, atomicity cross-check,
relay claim/publish polling, independent JetStream read-back via a
throwaway ephemeral consumer) and `phase4-cleanup.js` (removes only
the exact test records by their unique code). Both placed outside the
repo (`C:\Users\Lenovo\phase4-verification\`), never committed.

### Phase 4b notes (live Mongo connection-lifecycle bug)

The user ran the handed-off instructions in a normal terminal (not the
sandbox) and reported a real, reproduced bug: the relay logged
`MongoTopologyClosedError: Topology is closed` every tick, and
`GET /health/ready` failed identically at the same time, while NATS
stayed healthy. Root-caused by reading the installed MongoDB driver's
own source rather than guessing: `Topology.connect()` closes itself
permanently if the *first* connection attempt fails for any reason,
and nothing in the app ever retried the connection itself afterward
(only individual operations time out/retry, not the topology) - a
grep of the whole `src/` tree confirmed exactly one `.close()` call
site (`DatabaseModule`'s shutdown hook) and that `enableShutdownHooks()`
was never wired, ruling out a premature/duplicate shutdown as the
cause. Fix: `DatabaseService.ensureConnected()` (calls the driver's
own `client.connect()`, which transparently rebuilds the topology in
place on the same client if closed - confirmed by reading
`mongo_client.js`'s `_connect()`), wired into `ping()`, `withTransaction()`,
and the relay's `tick()`; `serverSelectionTimeoutMS` raised from 2s to
10s; `app.enableShutdownHooks()` added so the existing single
`client.close()` actually runs on real shutdown. Full root cause and
why each design choice was made (not a new-client-per-tick, not a
retry-without-repair) is in `docs/DECISIONS.md` #16.

Eight new regression tests added (`database.service.spec.ts`'s
"ensureConnected" describe block, `outbox-relay.service.spec.ts`'s
"Mongo self-heal wiring" describe block) asserting the repair call
happens, happens before the real operation, and that a failed repair
attempt never crashes `ping()` or `tick()`. `test/nats-integration.e2e-spec.ts`'s
two `OutboxRelayService` construction sites updated for the new
constructor parameter (a no-op `DatabaseService` stub - no real Mongo
in this sandboxed environment either way).

Full re-verification: `npm run build` passed, `npm run lint` passed (0
errors), `npm test` passed (156/156, up from 148 - the 8 new
regression tests), `npm run test:e2e` passed (14/14, including the
real-NATS integration suite). Nothing committed or pushed.

### Phase 4c notes (live verification: full pass)

The user re-ran `phase4-live-verify.js` outside the sandbox, against
the real local app (post Phase 4b fix) and real Atlas. **Result: 13/13
checks passed** - the first fully clean live run of the Phase 4
pipeline end to end:

1. Live Atlas `management_db` connectivity (direct driver ping).
2. `outbox_events` has both required indexes (`event_id_unique`,
   `unpublished_lookup_idx` - the Phase 4a gap-closing fix).
3. `POST /api/teams` succeeded (201) against the real running app.
4. Authoritative `teams` document present in live Atlas; matching
   `tm.v1.team.created` row present in `outbox_events`; both
   cross-referenced consistently (same `aggregateId`/`version`/
   `workspaceId`, near-zero `createdAt` delta) - the live atomicity
   evidence `docs/DECISIONS.md` #11 asked for.
5. The relay claimed the row (inferred/observed via the
   claim-then-publish poll).
6. `Nats-Msg-Id`/`X-Correlation-Id`/`X-Event-Id` headers on the
   published message matched the outbox row exactly.
7. A real JetStream `PubAck` was received: the message exists in
   `TEAM_EVENTS` at **stream sequence 44**, and this was confirmed
   *two independent ways* - the relay's own structured log line in
   Terminal A (`"result":"published","streamSeq":44`) and the
   verification script's separate read-back of the same message via a
   throwaway ephemeral consumer, reporting the identical sequence
   number. Two independent observers agreeing on the same sequence is
   only possible if the publish genuinely landed on the server.
8. `publishedAt` was set, and only after that sequence existed.
9. `attempts == 1`, lease fields cleared, `lastErrorCode` null - a
   clean single-attempt publish, no retries needed.
10. The message is durably present in `TEAM_EVENTS`.

This closes the last open item from Phase 4's original STOP-CONDITION
report (item 4, Atlas transaction verification) and from Phase 4b (the
Mongo lifecycle fix needed to be proven live, not just unit-tested).
See `docs/DECISIONS.md` #11 and #16 for the updated decision records.
No code changes this round - documentation only, per instruction.

### Phase 4d notes (second independent live verification: reproducibility confirmed)

The user re-ran `phase4-live-verify.js` a second time, independently of
the 4c run, against the same real local app and real Atlas. **Result:
13/13 checks passed again.** The one load-bearing number that must
differ run-to-run - the JetStream stream sequence of the newly
published message - correctly advanced from **44** (Phase 4c) to
**45** (this run), which is itself evidence the earlier result wasn't
a fluke or a stale/cached read: a durable stream only hands out a new,
higher sequence number for a genuinely new publish.

The user additionally performed a manual cross-check of the same kind
the script already does internally (TIMELOG Phase 4c, item 7): the
verification script's own reported `seq = 45` was compared by hand
against Terminal A's relay log line for the same publish
(`"result":"published","streamSeq":45`) - they matched. This is the
same "two independent observers agree on the same sequence" evidence
as Phase 4c, now reproduced on a second, independent run.

With two independently clean 13/13 runs against real Atlas and real
local JetStream, and the Phase 4b Mongo connection-lifecycle fix
holding across both, **Phase 4 is marked VERIFIED END-TO-END.** No
code changes this round - documentation only, per instruction. Phase 5
has not been started.

### Phase 5 notes (Activity & Insights Service: implementation + three real bugs found and fixed live)

Implemented the full Python consumer side: `events/envelope.py`
(Pydantic envelope parsing distinguishing malformed-schema/
unsupported-schemaVersion/unknown-eventType as three separately
classified non-retryable errors), `inbox/repository.py` (dedup by
`(event_id, consumer)`), `projections/state.py` (version-gated
`item_state`, `STALE` outcome via a read-then-decide check - see bug
#3 below for why it is NOT the upsert-conflict approach first tried),
`projections/workload.py` (counters by
project/column/priority/assignee, delta derived from `item_state`'s
own before/after snapshot - see `docs/DECISIONS.md` #17),
`projections/activity.py` (append-only timeline), `failures/repository.py`
(poison path), `messaging/processor.py` (per-message orchestration in
one real Mongo transaction), `messaging/consumer.py` (the durable
pull-consumer loop, bounded in-process retry + broker-level nak/
redelivery + exhaustion-to-poison), `messaging/responder.py` (real
`tm.query.v1.project_insights` Core NATS responder), `consumer_state.py`
(health/freshness reporting), `replay.py` (namespaced, separate-
consumer replay script), plus `GET /health/consumer` on the existing
FastAPI app and a fixed `NATS_DURABLE_CONSUMER_NAME` default
(`"activity-insights-service"` → `"activity-insights-v1"`, which never
matched the already-provisioned consumer - a real config bug, not
previously exercised by anything).

**Automated test suite**: 42 tests (`pytest`) - envelope validation
(valid/malformed/wrong-typed-field/unsupported-schemaVersion/unknown-
eventType), processor-level (valid event, duplicate, out-of-order
version, malformed schema, unsupported schemaVersion, unknown event
type, transient Mongo error, reassignment delta + idempotency under
redelivery, movement delta, archived item), consumer-level (ack on
success/poison, in-process retry then nak, recovery mid-retry,
redelivery exhaustion → poison → ack), responder-level (ok/not_ready/
malformed-request/workspace-mismatch), a real-local-NATS integration
suite (3 tests, genuine publish/fetch/ack/nak/redelivery against a
throwaway stream+consumer - never the live `TEAM_EVENTS`/
`activity-insights-v1`), and a real-Atlas regression test (skips
loudly, with a stated reason, if Atlas isn't reachable - never a false
pass). `ruff check` and `mypy src` both clean.

**Bug #1, found live (real Atlas, real NATS), not caught by the mocked
suite**: the first real run against the actual backlog on
`TEAM_EVENTS` (45 real events accumulated from Phases 4/4a/4c/4d)
poisoned every single message with `InvalidOperation: Can only use
session with the MongoClient that started it`. Root cause:
`main.py` called both `get_client()` and `get_database()`, each
constructing its own independent `AsyncIOMotorClient` - a Mongo
session is only valid against the exact client that created it. Fixed
by adding `db.py`'s `database_from_client()` and using one shared
client for both the db handle and every session in `main.py`/
`replay.py`. Confirmed fixed by a real-Atlas transaction round trip
(`tests/test_real_mongo_integration.py`, added as the permanent
regression guard - `tests/support/fake_mongo.py`'s fakes cannot model
per-client session identity, so only a real-driver test could catch
this class of bug). Full root cause in `docs/DECISIONS.md` #18.

**Bug #2, found while investigating bug #1's cleanup**: `InboxRepository`
and `ProcessingFailuresRepository` never accepted the `namespace`
parameter `ItemStateRepository`/`WorkloadProjectionRepository`/
`ActivityProjectionRepository`/`ConsumerStateRepository` already had -
so a namespaced run (replay, or the real-Atlas test) still wrote its
inbox/failure records into the **live** `inbox`/`processing_failures`
collections instead of its own namespace. Caught by inspecting the
real database after the real-Atlas test run (one stray `inbox`
document under the live collection, not the test's namespace). Fixed
by adding `namespace` support to both repositories; the stray document
and the earlier bug's 45 bogus `PROCESSING_BUG` failure records (and
the empty leftover namespaced collections from before the fix) were
all identified and deleted from the real `insights_db` - see
`docs/DECISIONS.md` #19.

**Operator decision requested and granted**: fixing bug #1 came too
late for the `activity-insights-v1` durable consumer's *first* pass
over the real backlog - it had already advanced its ack floor to
stream sequence 45 under the buggy code (every message technically
acked, since "poisoned" is still an ack-eligible outcome). Re-deriving
real projections required deleting and recreating the durable
consumer (resets its ack floor so it replays full history under the
fixed code) - a shared-JetStream-infrastructure action this session's
own auto-mode guardrails correctly declined to take without the user's
explicit go-ahead. Asked; the user chose "delete and recreate now."

**Bug #3, found immediately after that reset, mid-replay of the real
backlog**: processing hung for over a minute on one specific message
and had to be killed. Isolated and reproduced in under a minute once
suspected: `ItemStateRepository.apply_event`'s original design used
an unconditional upsert filtered on `version: {"$lt": newVersion}`
and treated the `DuplicateKeyError` raised when a document already
existed under that `_id` (but the version filter didn't match) as the
"stale, no-op" signal. Inside a multi-document MongoDB transaction,
this is a fundamentally broken pattern: the server marks the *entire
transaction* aborted as soon as that error occurs, regardless of it
being caught client-side, so the next operation (ultimately,
`commitTransaction`) fails with a `TransientTransactionError`-labeled
`NoSuchTransaction`, which Motor's `with_transaction` retries by
re-running the *whole body* - hitting the identical deterministic
error every time, so the retry loop cannot converge; it only spins
until its own ~2-minute internal budget runs out. Fixed by replacing
the upsert-and-react pattern with a plain `find_one` read followed by
a conditional write - `STALE` is now decided before any write is
attempted, which can never poison a transaction. Confirmed fixed by
re-running the exact message that had hung (resolved instantly) and by
the full automated suite (42/42, updated to match - one test's
monkeypatch target moved from the now-removed `find_one_and_update` to
`find_one`). Full root cause in `docs/DECISIONS.md` #20.

**Live run, complete, after all three fixes**: with the durable
consumer reset a second time (clean full replay under fully-fixed
code) and `insights_db`'s Phase 5 collections cleared of every bug-era
artifact, the real service was run against the real local NATS server
and real Atlas and consumed the entire real `TEAM_EVENTS` backlog (45
messages, sequence 1-45) with **zero crashes, zero hangs**:
`GET /health/consumer` reported `lastProcessedStreamSeq: 45`,
`connected: true`; the JetStream broker's own `consumer_info` agreed
independently (`ack_floor.stream=45`, `num_pending=0`,
`num_ack_pending=0` - two independent observers agreeing, the same
evidentiary standard Phase 4c used for its PubAck check). The real
backlog turned out to be almost entirely test fixtures accumulated
across Phases 1-4's own test runs (a mismatched-aggregate test
envelope, several repeated-version-1 fixtures from the same default
test aggregate, and one genuinely malformed "SMOKE" test message at
sequence 37) rather than clean business data - every one of them was
still handled correctly and classified honestly (`processed` /
`stale_version` / `duplicate` / `poisoned` as appropriate; a few
`duplicate` results came from a genuine race between this consumer's
fire-and-forget `msg.ack()` and the next `fetch()` call occasionally
re-receiving a not-yet-server-acked message - caught cleanly by the
inbox, not a bug). Separately ran `python -m activity_insights.replay
--namespace replay_real_1_` against the same real stream (its own,
throwaway, now-deleted consumer - never `activity-insights-v1`) and
got a complete, consistent accounting of all 45 messages
(44 inbox/activity records + 1 poisoned = 45); its namespaced
collections and consumer were deleted afterward, confirming replay
itself works on real data and leaves no trace when cleaned up. A live
Core NATS `tm.query.v1.project_insights` request against the running
service returned a genuine `{"status": "not_ready", "reason":
"NO_DATA_YET_FOR_PROJECT"}` for a project with no recorded activity -
the real responder, answering for real.

No changes to `management_db`, the Management Service's code, or any
`.env` secret value at any point this phase.

### Phase 5a notes (final live end-to-end workload verification, and the ack_wait "drift" re-examined)

Created real data through the real running Management Service (real
`.env`, real Atlas `management_db`, no mocks), using the seeded dev
workspace/users (`npm run seed`: Alice/Bob/Carol/Dave,
`aaaaaaaaaaaaaaaaaaaaaaaa`):

1. `POST /api/teams` - team `PH51791358463` ("Phase5 Verify Team"),
   `id=6ac5f5ffcbe07abdaad58fef`, created by Alice (first `OWNER`).
2. `POST /api/teams/:id/members` x3 - Carol and Dave as `MEMBER`, Bob
   as `LEAD`.
3. `POST /api/projects` - `PH5VER` ("Phase5 Verify Project"),
   `id=6ac5f61dcbe07abdaad58ff6`, owner Alice, team above (also
   creates its board, `id=6ac5f61ecbe07abdaad58ff9`).
4. `POST /api/projects/:id/items` x2 - item A (`PH5VER-1`,
   `id=...58ffb`, `TASK`/`HIGH`, assignee Carol, starts in `Backlog`)
   and item B (`PH5VER-2`, `id=...58ffd`, `BUG`/`MEDIUM`, assignee
   Dave, starts in `Backlog`).
5. `POST /api/items/:id/move` - item A to `In Progress`.
6. `POST /api/items/:id/assign` - item B reassigned Dave -> Bob
   (first attempt correctly rejected 400 until Bob was added as a
   team member - the "assigneeId must be an active member of this
   project's owning team" rule firing exactly as documented).

All 11 resulting domain events (`team.created`, `team.member_added`
x3, `project.created`, `project.team_assigned`, `board.created`,
`workitem.created` x2, `workitem.moved`, `workitem.assigned`) were
published to the real `TEAM_EVENTS` stream, taking it from `last_seq`
45 to **56** (confirmed via `GET http://localhost:8222/jsz?streams=true`).
The running Python service's `GET /health/consumer` reached
`lastProcessedStreamSeq: 56` within seconds, with no restart and no
intervention - the live, already-running consumer genuinely caught up
in real time.

**Verified non-zero, non-duplicated workload counts**, both through
the real NestJS BFF (`GET /api/projects/:projectId/insights`) and
directly over Core NATS (`tm.query.v1.project_insights`, bypassing
NestJS) - identical payloads from both:

```json
{"status":"ok","data":{"projectId":"6ac5f61dcbe07abdaad58ff6",
 "workloadByAssignee":[{"assigneeId":"...0003","count":1},
                        {"assigneeId":"...0004","count":0},
                        {"assigneeId":"...0002","count":1}],
 "countsByStatus":[{"columnId":"11473638-...","count":1},
                    {"columnId":"4b0b30c3-...","count":1}],
 "workloadByPriority":[{"priority":"HIGH","count":1},
                        {"priority":"MEDIUM","count":1}],
 "lastProcessedSequence":56}}
```

This is exactly the expected result: Carol (item A's assignee,
untouched) = 1, Dave (item B's *original* assignee, reassigned away)
correctly = **0** (not absent, not negative - the decrement-on-
reassignment math from `docs/DECISIONS.md` #17 verified on real data
for the first time), Bob (item B's new assignee) = 1; one item in
`Backlog` (B), one in `In Progress` (A, after the move); one `HIGH`,
one `MEDIUM`. Cross-checked against the Management Service's own
authoritative state (`GET /api/items/:id` for both items) - `columnId`/
`priority`/`assigneeId`/`version` match the Python projection's
`item_state` exactly, field for field.

**Activity projection confirmed complete and non-duplicated**: exactly
7 entries for this `projectId` (`project.created`,
`project.team_assigned`, `board.created`, 2x `workitem.created`,
`workitem.moved`, `workitem.assigned`) - `team.created`/
`team.member_added` are correctly absent (not project-scoped). All 7
`_id`s (the eventId) are unique - no duplicate activity records.
`inbox` grew by exactly 11 (39 -> 50), one per genuinely new event.
The live consumer log shows the *same* benign ack-before-settle race
already documented for the historical backlog on 5 of these 11
messages (a `processed` result immediately followed by a `duplicate`
for the identical `stream_seq`/`eventId`) - each one correctly
deduped by the inbox, contributing nothing extra to any count. This is
exactly the scenario the inbox dedup exists for, now observed on fresh
live traffic, not just backlog replay.

**ack_wait re-examined, and the earlier diagnosis corrected**: per the
instruction to inspect this and reconcile config vs. documentation,
re-tested the live `activity-insights-v1` consumer's reported
`ack_wait` (still 1.0s) against two freshly-created throwaway
consumers on the real server - one with `ack_wait=10` and
`backoff=[2,4]` (reported `ack_wait: 2.0`, i.e. `backoff[0]`), one with
`ack_wait=10` and no `backoff` (reported `ack_wait: 10.0`, honored
exactly). This proves the 1s value is **correct JetStream behavior
given this consumer's own configured `backoff` array**, not
provisioning staleness - the earlier note in `docs/EVENT_CATALOG.md`
(written during Phase 5's first pass) asserting a Node-side
reconciliation bug was itself wrong and has been corrected in place,
with the real mechanism explained and a new decision record added
(`docs/DECISIONS.md` #21). No code change was needed or made -
`jetstream.config.ts`'s `ack_wait: nanos(30_000)` is harmlessly inert
once `backoff` is set, not a bug worth touching Management Service
code for.

Full automated suite (`pytest`, 42/42), `ruff check`, and `mypy src`
re-confirmed clean after this session (no source changes this round -
verification and documentation only). Nothing committed or pushed.

### Phase 6 notes (Admin UI)

Audited the existing repo/APIs first (per instruction) and found two
things worth noting before writing any UI code:

- `GET /api/users` (`src/identity/`) **already existed**, built in
  Phase 3 with the comment "for the future UI", but was never
  documented in `docs/API.md` and had no tests. Documented it and
  added `users.repository.spec.ts`/`users.controller.spec.ts` (13 new
  assertions) - this is filling a real documentation/test gap, not
  adding a new capability.
- There was **no existing endpoint** returning a per-event activity
  list (only aggregate `insights`), but the brief requires an Activity
  screen showing "actor, time, action, affected item, chronological
  ordering" sourced from "existing backend APIs". Added
  `GET /api/projects/:projectId/activity`, mirroring `insights`'s Core
  NATS request/reply pattern exactly (`ActivityClientService`
  server-side, a new `ActivityResponder` on the Python side reading
  the same real `activity_projection` the consumer already writes) -
  see `docs/DECISIONS.md` #22. 7 new NestJS unit tests
  (`activity-client.service.spec.ts`) + 2 new real-NATS e2e tests
  (stub-responder ok / no-responder) + 4 new Python unit tests
  (`test_activity_responder.py`).

Also added `app.enableCors()` (`src/main.ts`, explicit
`ADMIN_UI_ORIGIN` allow-list, no wildcard, no credentials -
`docs/DECISIONS.md` #26) - required for the browser-based UI to reach
the API at all, since no prior phase had any cross-origin caller.

Built `admin-ui/` (React + TypeScript + Vite + Vitest/React Testing
Library, hand-rolled AdminLTE-style CSS over Bootstrap 5 rather than
the real jQuery-coupled `admin-lte` package - `docs/DECISIONS.md` #23):
a sign-in gate (`docs/DECISIONS.md` #24), Dashboard, Teams
(create/members/roles), Projects (create/status/dates/link to board),
a Kanban board (drag/drop + keyboard move, optimistic-with-rollback +
409 recovery - `docs/DECISIONS.md` #25, filters, WIP badge), a
work-item drawer (team-restricted assignee, matching not replacing the
server check), an Activity panel, and an Insights panel with explicit
ready/not_ready/pending/unavailable states.

**Automated test suite**: 29 Vitest + React Testing Library tests
across 11 files - teams create/validation-error, project creation,
board rendering/column-order/WIP-badge, filters (re-request with query
params), move command behavior (`expectedVersion` sent, optimistic
position kept only after success, rollback on non-conflict failure,
409 triggers a full board refresh with a clear message), keyboard/
non-drag reordering (up/down buttons, disabled-state-correctly-not-
focusable), invalid-assignee handling (UI restricts the picker to team
members, and a forced/bypassed choice still gets the real server 400
message), team member add/role-update/remove, activity rendering
(chronological order, actor/action/item), insights ready/not_ready/
pending/unavailable states, item-drawer accessibility (aria-modal,
focus-on-open, Escape-to-close, every field labeled), and the sign-in
gate (including its own regression test, below). `npm run build`
(`tsc -b && vite build`) and `npm run lint` (oxlint) both clean -
2 pre-existing stylistic warnings only (`react/only-export-components`
fast-refresh advice, `react/purity` on a `Date.now()` freshness
comparison), no errors.

**Real bug #1, found by its own test**: an earlier `CurrentUserContext`
used a boolean (`isSignedIn = currentUserId !== null`) to gate the
app shell. `SignInGate.test.tsx`'s second test (re-run after the
first test's real sign-in had written to `localStorage`) immediately
showed "Protected content" even though that test's own mock rejected
every id with 401 - proving the gate would flash real content for a
stale/invalid stored id on a genuine page reload before the async
re-validation caught up and reverted it. Fixed by making `status` a
real three-state machine (`checking`/`signed-out`/`signed-in`) -
`checking` is a loading state, never a pass-through - and adding a
dedicated regression test plus `afterEach(() => localStorage.clear())`
test hygiene. Full root cause in `docs/DECISIONS.md` #24.

**Found and fixed while writing tests (not "bugs" at runtime, since
nothing shipped with them, but real mistakes caught before they
could)**: several ambiguous RTL queries (`getByText('ENG1-1', {exact:
false})` also matching a card's own hidden "Move ENG1-1 to column"
label; `getByRole('status')` matching the loading spinner, which also
uses that role, instead of the intended not-ready message; `.focus()`
asserted on a `disabled` button, which browsers correctly never give
focus to) - all fixed by querying more specifically
(`data-testid`, `findByText` after confirming load finished, filtering
to enabled controls only), not by weakening the component being
tested.

**Live verification against the real stack** (real Management
Service, restarted to pick up the CORS/activity-route changes; real
Python service; real Atlas; real local NATS; `admin-ui`'s Vite dev
server actually running on `:5173`) - no browser-automation tool was
available this session, so the full workflow was driven via direct
HTTP calls using the exact same endpoints/headers/payload shapes
`admin-ui`'s API client sends (verified by reading `src/api/
endpoints.ts` alongside each call), with `Origin: http://localhost:5173`
set to also prove the real CORS preflight succeeds
(`Access-Control-Allow-Origin: http://localhost:5173` confirmed via a
real `OPTIONS` request) - the component-level rendering of these exact
responses is separately covered by the Vitest suite above, which does
render real React components into a real DOM:

1. Created a real team, added two real members with different roles,
   created a real project owned by the same workspace, fetched its
   real board (5 default columns).
2. Created a real work item (assigned to one member), reassigned it to
   a different real team member, moved it to a different real column -
   three real domain events per the pattern established in Phase 4/5.
3. Waited for the already-running Python consumer to catch up (`GET
   /health/consumer` advanced to the new real stream sequence within
   seconds, no restart needed).
4. `GET /api/projects/:id/activity` returned all 6 real events for
   that project (`project.created`, `project.team_assigned`,
   `board.created`, `workitem.created`, `workitem.assigned`,
   `workitem.moved`), newest-first, actor/time/type all real.
5. `GET /api/projects/:id/insights` showed genuinely non-zero,
   non-duplicated workload: the reassigned-away member's count
   correctly dropped to **0** (not absent, not negative - the
   decrement-on-reassignment design from `docs/DECISIONS.md` #17,
   confirmed on fresh live data for the first time since Phase 5a used
   only pre-existing test-fixture data), the new assignee's count was
   **1**, the old column's count dropped to **0**, the new column's
   count was **1**.
6. Separately confirmed the two critical error paths live, exactly as
   `admin-ui`'s error handling expects them: assigning a user outside
   the team's own membership → real `400 VALIDATION_ERROR` ("assigneeId
   must be an active member of this project's owning team."); a move
   sent with a stale `expectedVersion` → real `409 CONFLICT` with
   `details.currentVersion` populated.
7. Archived the verification team and project afterward (soft-delete,
   same as every prior phase's live-verification data).

**Real bug #2, found live, in Phase 5 code (not Phase 6's own
code)**: partway through re-running the full regression suite with
the long-running Python service from Phase 5a/6 verification still up,
that process crashed entirely with an unhandled `asyncio.TimeoutError`
- not during any request/response work, but from its own idle-poll
loop finding no new messages on an otherwise-quiet stream. Traced to
`nats-py`'s installed source: `js/client.py`'s `_fetch_n` sometimes
raises the *bare builtin* `TimeoutError` directly (not always wrapped
in its own `nats.errors.TimeoutError` subclass), which
`messaging/consumer.py`'s `run_forever` only caught as
`nats.errors.TimeoutError` - the subclass, which does not match an
instance of the parent class raised directly. The escaped exception
propagated through `asyncio.gather()` in `main.py` and killed every
other task in the process (the health HTTP server, both responders),
not just the consumer loop - a crashed-and-never-restarted consumer is
exactly the kind of silent failure the whole messaging-reliability
design exists to avoid. Fixed by catching the builtin `TimeoutError`
instead (a strict superset - it still catches
`nats.errors.TimeoutError` instances too, since that class subclasses
the builtin) in both `messaging/consumer.py` and `replay.py`'s
matching fetch loop. Added a deterministic regression test
(`test_run_forever_survives_a_raw_builtin_timeout_error_from_an_idle_fetch`)
that reproducibly fails against the old clause and passes against the
fix - verified both directions before moving on, not just "added a
test and assumed it covers the bug." Full root cause in
`docs/DECISIONS.md` #27. Python suite re-confirmed clean afterward:
47/47 (up from 46 - the one new regression test), `ruff`/`mypy` clean.

**Not verified this round (honest gaps)**: no literal browser/GUI
click-through was performed (no browser-automation tool was available
in this session) - the claims above are "the real backend behaves
exactly as the UI code expects, proven with the UI's own exact request
shapes" plus "the UI's real React components render those exact
response shapes correctly, proven by Vitest+RTL", not "a human/agent
visually watched it in Chrome." Drag-and-drop's native HTML5
`dataTransfer` behavior specifically is exercised in the test suite
via `fireEvent`-level drag events, not a real OS-level drag gesture -
the keyboard/non-drag path (required to exist regardless) is the one
exercised identically to how a real user would operate it. Responsive
layout below 768px is implemented (`src/styles/app.css`'s mobile
sidebar rules) but only visually verifiable in a real browser, which
this session did not have.

No changes to `management_db`'s/`insights_db`'s existing collections'
schemas, no changes to any already-shipped Phase 1-5 business logic,
no `.env` secret values read, printed, or committed. Nothing committed
or pushed.

### Phase 6 follow-up: two bugs from the user's own manual Chrome verification

The user completed the manual browser verification Phase 6's own
report asked for (no browser tool was available to this session) and
reported two real bugs, both fixed this round:

1. **Mobile sidebar (<768px)**: stayed open/full-width, squeezing main
   content. Root-caused to two real issues: the fixed-position
   sidebar relied on a negative `margin-left` with no explicit
   `top`/`left`/`bottom` (ambiguous inset-resolution across layout
   contexts), and the Vite scaffold's leftover default `src/index.css`
   (a centered fixed-width `#root` with marketing-page heading styles)
   was never removed and was fighting the real layout. Fixed with
   explicit insets, a backdrop (click-to-close), auto-close-on-
   navigate, and deleting the scaffold CSS residue. `Shell.test.tsx`
   (3 new tests) covers the behavioral contract (class toggling,
   backdrop, auto-close) - jsdom cannot evaluate `@media` queries or
   real layout, so the visual result still needs the user's own eyes.
   See `docs/DECISIONS.md` #28.
2. **Activity showed raw WorkItem ids** ("moved WorkItem 6ac5...").
   Fixed by capturing `issueKey` (the only per-item identifier any
   event ever names) from `workitem.created`'s own payload into
   `item_state`, and resolving it server-side for every WorkItem
   activity entry - never a management_db read, and never a
   fabricated title (this project's events deliberately never carry
   free-text content - a pre-existing, deliberate design rule this fix
   does not violate just to make one screen prettier). 2 new
   `test_activity_responder.py` tests, a new `test_item_state.py` (3
   tests), and a new `ActivityPanel.test.tsx` test. See
   `docs/DECISIONS.md` #29.

**Full re-verification**: `pytest` 51 passed, 1 skipped (the real-Atlas
regression test - Atlas was transiently unreachable from this
environment during this session, the same class of local-network
condition documented in `docs/DECISIONS.md` #11, unrelated to this
round's code changes; confirmed independently via a direct Python
ping, not just the one test) - `ruff`/`mypy` clean. `admin-ui`: 33
Vitest tests passed (12 files, up from 11), `npm run build` clean,
`npm run lint` clean (one new stylistic-only warning on the
navigation-closes-on-route-change effect, same category as two
pre-existing ones - not an error). NestJS: 169 unit + 16 real-NATS e2e
tests, all passed. `git diff --check` clean (CRLF notices only).

This session also found Docker Desktop itself had stopped (and with
it, the local NATS container and both long-running service processes)
between the end of the prior session and this one - restarted it,
confirmed the file-backed JetStream stream/consumer data survived,
and restarted the Management Service and `admin-ui` dev server. The
Python service was **not** restarted this round: Atlas was still
unreachable when this session ended, and starting it against an
unreachable database would not have added anything verifiable.

No changes to `management_db`'s/`insights_db`'s schemas beyond the
additive `issueKey` field on `item_state` (Phase 5's own collection),
no changes to Phase 1-5 business logic otherwise, no `.env` secret
values read/printed/committed. Nothing committed or pushed.

**Phase 6 follow-up #2: the user's re-verification still showed raw
WorkItem ids - the prior fix was necessary but not sufficient.**
Diagnosed by directly inspecting the real `insights_db.item_state`
collection: all 3 real WorkItem documents had no `issueKey` field,
confirming the prior fix only affects events processed going forward,
not documents already projected by the old code (`apply_event`'s
version gate correctly treats a redelivered same-version `created`
event as STALE - see `docs/DECISIONS.md` #30 for the full mechanism).

Added `activity_insights/backfill.py`, a narrow one-off script (never
an HTTP endpoint): a new JetStream consumer filtered to only
`tm.v1.workitem.created`, reading each event's real `issueKey` and
calling a new `ItemStateRepository.backfill_issue_key`, which only
ever fills in a *missing* issueKey on an *existing* document - never
creates one, never overwrites one, never touches any other field.
Never reads/writes `management_db`. 7 new tests (`test_item_state.py`
+3, new `test_backfill.py` with 3 unit tests for the extracted
per-event decision logic). Ran it against the real stream: 16
`workitem.created` events seen, 3 documents updated (exactly the 3
real WorkItems found missing `issueKey`).

**Verification**: direct `tm.query.v1.project_activity` NATS request
and the real `GET /api/projects/:id/activity` HTTP endpoint (with a
valid `X-Dev-User-Id`) both now return `issueKey: "PH5VER-1"` /
`"PH5VER-2"` on every WorkItem entry instead of `null`. `pytest`: 58
passed (up from 51), `ruff`/`mypy` clean. `admin-ui`: 33 Vitest tests
still passing (frontend code unchanged this round - `ActivityPanel`
already consumed `issueKey` correctly once the API started returning
it). Nothing committed or pushed; Phase 7 not started.

**USER-MANUALLY VERIFIED in Chrome (both items PASS, per the user's own report):**
- Responsive mobile layout at ~390px (sidebar/hamburger/backdrop behavior - `docs/DECISIONS.md` #28).
- Activity entries show human-readable issue keys (`PH5VER-1` / `PH5VER-2`) instead of raw WorkItem database IDs (`docs/DECISIONS.md` #29, #30).

**Phase 6 is complete.** Nothing committed or pushed. Phase 7 not started.

### Phase 7 notes (Testing & Hardening)

Audited the existing test suites (both services) against the Phase 7
checklist via two parallel focused passes, then closed every genuine
gap found with narrowly-scoped additive tests (no production-code
redesign):

**NestJS** (`services/management-service/`): most checklist items
already had real coverage. Three genuine gaps closed: (1)
**cross-workspace access** - the actual tenant-isolation mechanism
(`WorkspaceScopedRepository.findOneScoped`, via each real repository's
`findById`) was never exercised with two real tenants' documents
through real repository code, only stipulated via fully-mocked specs;
new `database/cross-workspace-isolation.spec.ts` (3 tests) proves a
document that exists under workspace A is unreachable via workspace
B's `findById`. (2) The `getXOrThrow` NotFound-wrapper helpers used by
every controller route had no direct test; added to
`teams.service.spec.ts`/`projects.service.spec.ts`/
`work-items.service.spec.ts`. (3) Issue-key generation's real atomic
`$inc`+upsert uniqueness guarantee was untested (only the pure
string-formatting helper was); new
`work-items/counters.repository.spec.ts` (3 tests). No production bugs
found - all three were test-coverage gaps.

**Python** (`services/activity-insights-service/`): likewise mostly
already covered via `test_processor.py`/`test_envelope.py`. Two
genuine gaps closed: (1) the inbox's `(event_id, consumer)` **unique
index** as a backstop (distinct from the in-process
`already_processed` read) had no test; new `tests/test_inbox.py` (4
tests, using `fake_mongo.py`'s `declare_unique`/`DuplicateKeyError`).
(2) `replay.py` had zero automated coverage (only ever hand-verified -
Phase 5 notes above); new `tests/test_replay.py` publishes one fresh,
uniquely-identified real event to the real `TEAM_EVENTS` stream, runs
a real `run_replay` into a throwaway namespace/consumer, asserts it
landed correctly, and cleans up its own namespaced collections and
consumer afterward. No production bugs found.

**Reproducibility, re-run and independently re-confirmed (not just
trusting the sub-audits' own reported numbers):**
- Management Service: `npm ci` clean, `npm run build` clean,
  `npm run lint` clean, `npm test` **181 passed / 24 suites** (up from
  169/22), `npm run test:e2e` **13 passed / 3 failed** (16 total) -
  the 3 failures are a live-environment conflict, not a defect: those
  tests assert `NO_RESPONDER`/`TIMEOUT` on the real subject names, but
  the real, already-running Python service genuinely answers them
  right now. Root cause confirmed and documented, not silently
  ignored - see `docs/DECISIONS.md` #31.
- `activity-insights-service`: `pytest -q` **63 passed** (up from 58,
  including the real-NATS and real-Atlas integration tests, both
  reachable this run), `ruff check` clean, `mypy src` clean (29
  files).
- `admin-ui`: `npm ci` **crashed** (`EPERM` - its own live Vite dev
  server, left running from Phase 6's manual verification, held a
  native binding file open; `npm ci` deletes `node_modules` before
  reinstalling and cannot complete while that file is locked) and left
  `node_modules/.bin` empty. Repaired with `npm install` (merges/
  repairs rather than wiping first); `npm test` **33 passed**,
  `npm run build` clean, `npm run lint` clean (0 errors, 6 pre-existing
  stylistic warnings) all confirmed clean immediately after. A true
  from-cold `npm ci` with the dev server stopped was not attempted
  (would mean stopping shared live infrastructure without asking - see
  `docs/DECISIONS.md` #31).
- Repository: `docker compose config` valid, `git diff --check` clean
  (CRLF notices only), `git check-ignore -v` confirmed all three
  services' `.env` files still ignored/untracked. No dedicated secret
  scanner (gitleaks/trufflehog) was available in this environment; used
  a `git grep` pattern scan instead (`mongodb+srv://`, AWS key shape,
  PEM private-key headers) - clean, only doc prose mentioning the
  pattern name, no real secret.

**Live MongoDB/Atlas evidence**: queried the real clusters directly and
confirmed every declared index actually exists - `management_db`:
`event_id_unique`/`unpublished_lookup_idx` (outbox),
`workspace_issue_key_unique` (work_items), `active_team_user_unique`
(memberships, partial), plus every other `INDEX_REGISTRY` entry,
all present; `insights_db`: `event_id_consumer_unique` (inbox),
`project_occurred_idx` (activity_projection), `project_idx`
(workload_projection).

**Live end-to-end run against the real stack** (real Management
Service, real Python service, real Atlas, real local NATS) - fresh
team (`PH7E2E`) → 2 members (LEAD/MEMBER) → project (auto-created
board) → 3 work items → assign (Carol→Bob) → move (Backlog→In
Progress) → reorder (move back into Backlog between two siblings,
rank correctly computed as the midpoint, 1536 between 1024/2048) →
archive one item → real `400` on an out-of-team assignee → real `409`
on a stale `expectedVersion` (`currentVersion` detail populated) →
activity (9 real entries, every WorkItem entry's `issueKey` resolved,
chronological) → insights (workload/status/priority counts all
independently verified correct, including the archived item correctly
excluded and the reassigned-away member's count at 0, not negative).

**Python consumer restart, the specific Phase 7 requirement**: with
the workflow's events fully processed (`lastProcessedStreamSeq: 137`
on both the NestJS BFF and the Python health endpoint), the real
Python process was stopped and restarted. Confirmed via the real
broker, not just application logs: `consumer_info` for
`activity-insights-v1` showed `ack_floor.stream=137`,
`delivered.stream=137`, `num_pending=0`, `num_ack_pending=0` after the
restart - nothing was redelivered. Re-fetched `GET .../activity` and
`GET .../insights` immediately after and diffed them byte-for-byte
against the pre-restart responses: identical in every field except the
request-time `generatedAt` timestamp. **No duplication.** Test data
(team + project, soft-delete only) archived afterward, same convention
as every prior phase's live-verification data.

**Not verified this round (honest gaps, not hidden)**: no dedicated
secret-scanning tool was available (pattern-grep used instead, see
above); the 3 management-service e2e failures are logically correct
but not green in this exact concurrent-process configuration (would be
green with the Python service stopped first - not attempted, see
above); queue-group load balancing across two live consumer instances
and a mid-test real NATS server restart remain out of scope, carried
over from Phase 4's own documented stretch-goal gaps; no new
browser/GUI click-through was performed (Phase 6's manual Chrome
verification already covers the UI; Phase 7 is backend/API/infra
hardening). Phase 8 scope was not reviewed, per instruction.

No production-code defects were found this phase - every gap closed
was a missing test, not a bug. No changes to `management_db`'s/
`insights_db`'s schemas, no `.env` secret values read/printed/
committed. **Nothing committed or pushed. Phase 8 not started.**

### Phase 7 follow-up: closing the two remaining required-verification gaps

Told to make the 3 live-conflicted e2e tests reproducibly green
(without weakening assertions) and to add real evidence for the
assignment's queue-group/competing-consumer requirement:

1. **Deterministic test isolation, not process orchestration.** Gave
   `InsightsClientService`/`ActivityClientService` a test-only
   constructor-config override (`INSIGHTS_QUERY_SUBJECT_OVERRIDE` /
   `ACTIVITY_QUERY_SUBJECT_OVERRIDE`, read exactly like the existing
   `INSIGHTS_QUERY_TIMEOUT_MS` lookup - never set in real deployment
   config, so production always resolves the real documented subject,
   now asserted directly in a new test per client). Rewrote all five
   request/reply tests in `test/nats-integration.e2e-spec.ts` to
   generate their own unique `test.insights.<uuid>`/
   `test.activity.<uuid>` subject instead of using the real production
   subject - immune to the live Python service (or anything else)
   ever being subscribed to it. See `docs/DECISIONS.md` #32.
2. **Queue-group/competing-consumer evidence.** Added one new real-
   broker test to the existing durable-pull-consumer block: two
   independent `Consumer` handles bound to the same durable name
   concurrently fetch a real 10-message backlog; asserts zero
   duplicate sequence numbers across both and that both actually
   received a share (real distribution, not one handle doing
   everything). No new production code - this is JetStream pull
   consumers' existing, already-relied-upon behavior, proven, not a
   new feature.
3. **A real defect in this session's own prior doc edit was caught by
   `git diff --check` during re-verification**: trailing whitespace on
   one `docs/TIMELOG.md` line from this phase's earlier evidence
   section. Fixed immediately, re-confirmed clean.

**Final re-verification, every command run fresh after the fixes
above:**
- `npm test` (management-service): **181 passed, 24 suites** (run
  twice, identical).
- `npm run test:e2e` (management-service): **19 passed, 2 suites** (16
  original + 1 new queue-group test + 2 new subject-fallback anchor
  tests; the 3 previously-conflicted tests now pass deterministically) -
  run **5 times total** across this task (3 isolated re-runs of just
  the new queue-group test, plus 2 full-suite runs), identical
  pass results every time, with the real Python service never stopped.
- `npm run build` / `npm run lint` (management-service): clean.
- `pytest -q` (activity-insights-service): **61 passed, 2 skipped**.
  The 2 skips are both Atlas-dependent (`test_real_mongo_integration.py`,
  `test_replay.py`) - Atlas was independently confirmed transiently
  unreachable right now via a direct driver ping
  (`ServerSelectionTimeoutError` / TLS handshake failure, the same
  class of issue as `docs/DECISIONS.md` #11, which has flickered
  reachable/unreachable repeatedly across this session), re-checked
  twice more a few minutes apart with the same result - a real,
  external, already-documented condition, not a hidden failure (both
  tests skip loudly with a stated reason, by design, rather than
  falsely pass or silently vanish).
- `ruff check src tests` / `mypy src`: both clean (29 source files).
- `admin-ui`: `npm test` **33 passed (12 files)**, `npm run build`
  clean, `npm run lint` clean (0 errors, same 6 pre-existing
  stylistic-only warnings as every prior re-run this phase).
- `docker compose config`: valid.
- `git diff --check`: **clean** (CRLF notices only, after the
  trailing-whitespace fix above).

**PHASE 7 COMPLETE.** The only non-fully-green item (pytest's 2 Atlas-
dependent skips) is an external cloud-connectivity condition outside
this codebase's control, independently reconfirmed rather than taken
on faith, and both tests are specifically *designed* to skip loudly
with a clear reason under exactly this condition rather than fail
silently or give a false pass - this is the tests behaving correctly,
not an unresolved gap in this phase's own required work. Both of the
user's required fixes (deterministic e2e isolation; queue-group
evidence) are done, verified, and reproducible. Nothing committed or
pushed. Phase 8 not started.
