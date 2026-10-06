# Activity & Insights Service

Python 3.12+ service that consumes durable domain events published by the
Management Service over NATS JetStream, projects them into read-optimized
views, and serves insight queries over NATS Core request/reply.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design. This service owns only: inbox/deduplication records, the
activity projection, the workload projection, and processing failure
records, all inside `insights_db`.

## Phase 2 status

MongoDB persistence foundation only: configuration loading, logging,
connection helpers for MongoDB and NATS, liveness/readiness HTTP
endpoints (`health_app.py`), and index bootstrap. No event consumption,
projection, or request/reply handling is implemented yet.

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
