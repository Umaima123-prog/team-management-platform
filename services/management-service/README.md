# Management Service

NestJS + TypeScript service that owns `management_db`: workspaces,
users, teams, memberships, projects, boards, columns, work items, and
the transactional outbox (`outbox_events`).

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design and [`docs/API.md`](../../docs/API.md) for request/response
examples of every route below.

## Phase 4 status

The authoritative business domain and its REST API are implemented:
workspaces/users (seed-only), teams + memberships + roles, projects,
one Kanban board per project with default columns, and Jira-like work
items with optimistic concurrency and a move/reorder API. As of
Phase 4, the relevant mutating commands also write a transactional
outbox fact (same MongoDB session transaction as the domain mutation)
and a background relay publishes it to a real local JetStream server -
see [`docs/EVENT_CATALOG.md`](../../docs/EVENT_CATALOG.md) for exactly
which command emits which event. A `GET /api/projects/:projectId/insights`
endpoint answers over Core NATS request/reply with a bounded timeout.
**Not implemented yet**: the Python consumer that processes these
events into projections (Phase 5), and the AdminLTE UI - see
`docs/ARCHITECTURE.md`'s implementation-status section for the precise
boundary.

## Local development

```bash
cp .env.example .env
npm ci
docker compose -f ../../docker-compose.yml up -d   # local NATS/JetStream
npm run start:dev
```

On boot, the app idempotently creates the `TEAM_EVENTS` JetStream
stream and the `activity-insights-v1` durable consumer on whatever
`NATS_URL` points at (default `nats://localhost:4222`), and starts the
outbox publisher relay on a timer. None of this blocks startup or
`GET /health` if NATS is unreachable - see `docs/ARCHITECTURE.md`
"Health model".

Then seed one development workspace + a few users (idempotent, safe
to re-run):

```bash
npm run seed
```

The seed output prints each user's id - use one as the
`X-Dev-User-Id` header (see "Request context" below) to call the API
as that user, e.g.:

```bash
curl -X POST http://localhost:3000/api/teams \
  -H "Content-Type: application/json" \
  -H "X-Dev-User-Id: <id from npm run seed>" \
  -d '{"code":"PAY","name":"Payments"}'
```

## Request context (read this before calling the API)

There is no real authentication in Phase 3 by design (explicitly out
of scope - see docs/ARCHITECTURE.md). Every request must carry an
`X-Dev-User-Id` header naming a real seeded/created user id;
`RequestContextGuard` looks that user up and derives `workspaceId`
from their own record - **the browser/client can never supply
workspaceId directly**, which is what makes workspace isolation
enforceable server-side rather than merely client-trusted. Missing or
unknown ids get a 401. `GET /health` and `GET /health/ready` are the
only routes exempt from this (`@Public()`).

## Commands

- `npm run build` - compile with `nest build`.
- `npm run lint` - ESLint.
- `npm test` - unit tests (Jest, mocked repositories - see
  `docs/DECISIONS.md` for why no real database is used here).
- `npm run test:e2e` - end-to-end tests against a running Nest app
  instance, **including a real local NATS JetStream integration suite**
  (`test/nats-integration.e2e-spec.ts` - stream/consumer bootstrap,
  real publish+ack, `Nats-Msg-Id` dedup, redelivery, durable-consumer
  resume, request/reply success/timeout/no-responder). Requires
  `docker compose up -d nats` at the repo root first - this suite
  fails loudly, not silently, if nothing is listening on `NATS_URL`.
- `npm run seed` - idempotent development data seed (one workspace + a
  few users).

## Messaging environment variables

See `.env.example` for the full list with defaults. Summary:
`NATS_URL` (required for any messaging feature to work - the app still
boots without it), `OUTBOX_RELAY_INTERVAL_MS`/`OUTBOX_RELAY_BATCH_SIZE`/
`OUTBOX_RELAY_LEASE_MS` (relay tuning, all optional), and
`INSIGHTS_QUERY_TIMEOUT_MS` (optional, default 2000ms).
