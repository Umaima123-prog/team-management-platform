# Activity & Insights Service

Python 3.12+ service that consumes durable domain events published by the
Management Service over NATS JetStream, projects them into read-optimized
views, and serves insight queries over NATS Core request/reply.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design. This service owns only: inbox/deduplication records, the
activity projection, the workload projection, and processing failure
records, all inside `insights_db`.

## Phase 1 status

This is a skeleton only: configuration loading, logging, and connection
helpers for MongoDB and NATS. No event consumption, projection, or
request/reply handling is implemented yet.

## Local development

```bash
python -m venv .venv
. .venv/Scripts/activate   # Windows (Git Bash: source .venv/Scripts/activate)
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
python -m activity_insights.main
```
