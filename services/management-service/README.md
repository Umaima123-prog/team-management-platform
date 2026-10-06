# Management Service

NestJS + TypeScript service that owns `management_db`: workspaces,
users, teams, memberships, projects, boards, columns, work items, and
(not yet implemented) the transactional outbox.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design and [`docs/API.md`](../../docs/API.md) for request/response
examples of every route below.

## Phase 3 status

The authoritative business domain and its REST API are implemented:
workspaces/users (seed-only), teams + memberships + roles, projects,
one Kanban board per project with default columns, and Jira-like work
items with optimistic concurrency and a move/reorder API. Event
publishing (JetStream/outbox) and the AdminLTE UI are **not**
implemented yet - see `docs/ARCHITECTURE.md`'s implementation-status
section for the precise boundary.

## Local development

```bash
cp .env.example .env
npm ci
npm run start:dev
```

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
  instance (health checks only - see docs/DECISIONS.md for why the
  Phase 3 business-rule tests are unit, not e2e).
- `npm run seed` - idempotent development data seed (one workspace + a
  few users).
