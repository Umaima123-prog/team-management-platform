# Management Service

NestJS + TypeScript service that owns `management_db`: workspaces,
users, teams, memberships, projects, boards, columns, work items, and
the transactional outbox.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full
system design.

## Phase 1 status

This is a skeleton only: a single unauthenticated `GET /health`
endpoint and app bootstrap/config wiring. No domain entities, no outbox
relay, and no NATS integration are implemented yet.

## Local development

```bash
cp .env.example .env
npm ci
npm run start:dev
```

- `npm run build` - compile with `nest build`.
- `npm run lint` - ESLint.
- `npm test` - unit tests (Jest).
- `npm run test:e2e` - end-to-end tests against a running Nest app instance.
