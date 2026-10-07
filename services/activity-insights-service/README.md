# Activity & Insights Service

Python 3.12+ service that consumes durable domain events published by the
Management Service over NATS JetStream, projects them into read-optimized
views, and serves insight queries over NATS Core request/reply.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design. This service owns only: inbox/deduplication records, the
activity projection, the workload projection, and processing failure
records, all inside `insights_db`.

## Status

- **Phase 2**: MongoDB persistence foundation - configuration loading,
  logging, connection helpers, liveness/readiness HTTP endpoints
  (`health_app.py`), and index bootstrap.
- **Phase 5**: event consumption and projections. `python -m
  activity_insights.main` now runs three concurrent pieces in one
  process: the health/readiness/consumer-state HTTP app, the durable
  JetStream consumer (bound to `activity-insights-v1` on
  `TEAM_EVENTS`), and the Core NATS `tm.query.v1.project_insights`
  responder. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)
  "Python inbox and projections" for the full design and
  [`docs/TIMELOG.md`](../../docs/TIMELOG.md) for test/live-run
  evidence.

Not yet implemented: Phase 6 (AdminLTE UI).

## Local development

```bash
python -m venv .venv
. .venv/Scripts/activate   # Windows (Git Bash: source .venv/Scripts/activate)
pip install -r requirements-dev.txt
cp .env.example .env
python -m activity_insights.main
```

`requirements.txt` installs this package itself in editable mode
(`-e .`, via the `src/` layout declared in `pyproject.toml`), so
`activity_insights` is importable - and `python -m activity_insights.main`
runs - without ever setting `PYTHONPATH` by hand.

Requires the repo-root `docker compose up -d nats` (real local
JetStream) and a reachable MongoDB Atlas `insights_db` (see the
repo-root README's "Database setup"). `GET /healthz`, `GET /readyz`,
and `GET /health/consumer` report liveness, Mongo readiness, and
durable-consumer freshness respectively.

## Testing

```bash
pytest                       # full suite (unit + real-local-NATS integration)
ruff check src tests
mypy src
```

`tests/test_nats_integration.py` requires the real local NATS server
(`docker compose up -d nats` at the repo root) and genuinely fails -
not a silent skip - if nothing is listening; it uses its own
throwaway stream/consumer per test, never the live `TEAM_EVENTS`/
`activity-insights-v1`. `tests/test_real_mongo_integration.py`
requires a real, reachable Atlas `insights_db` and SKIPS (with a
clear reason) otherwise - everything else in the suite needs neither
a real NATS server nor a real database.

## Replay

```bash
python -m activity_insights.replay --namespace replay1_
```

Replays full `TEAM_EVENTS` history through the exact same processing
logic into collections prefixed `replay1_...` - never the live
projections, never `management_db`. Deliberately a script, not an
HTTP endpoint - see `src/activity_insights/replay.py` and
`docs/ARCHITECTURE.md` "Replay into a clean projection".
