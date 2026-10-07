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
