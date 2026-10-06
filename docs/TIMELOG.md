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
