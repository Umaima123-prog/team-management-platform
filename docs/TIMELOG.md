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
