# Team Management Platform

Event-driven microservices platform: a NestJS Management Service and a
Python Activity & Insights Service, integrated through NATS JetStream.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces
fit together and what is/isn't implemented yet, and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for why.

## Repository layout

```
.
├── docker-compose.yml          # Local NATS (JetStream) only - no Mongo locally
├── docker/nats/                # NATS server config (JetStream + persistence)
├── services/
│   ├── management-service/     # NestJS + TypeScript - owns management_db
│   └── activity-insights-service/  # Python 3.12+ - owns insights_db
├── docs/
│   ├── ARCHITECTURE.md
│   ├── EVENT_CATALOG.md
│   ├── DECISIONS.md
│   └── TIMELOG.md
├── .env.example                 # docker-compose-level vars only
└── .gitignore
```

An `admin-ui/` (AdminLTE) directory is planned but not yet created -
it is out of scope until the administration UI phase begins.

## Local infrastructure

```bash
cp .env.example .env
docker compose up -d
```

This starts a single local NATS server with JetStream enabled and
persistent file storage. MongoDB is **not** run locally; both services
connect to MongoDB Atlas via their own `.env` files (see each service's
`.env.example` - never commit real connection strings).

## Services

- [`services/management-service`](services/management-service) - see
  its own README/scripts for running locally.
- [`services/activity-insights-service`](services/activity-insights-service) -
  see its [README](services/activity-insights-service/README.md).

## Status

Phase 1: repository foundation, service skeletons, local NATS/JetStream
infra, and documentation. No business logic (teams/projects/boards/work
items, event publishing/consumption) is implemented yet.
