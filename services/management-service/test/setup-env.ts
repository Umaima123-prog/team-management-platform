// Test-only env defaults. The application itself never hardcodes a
// MongoDB URI - DatabaseModule requires MONGODB_URI/MONGODB_DB_NAME to
// be configured via the environment. This file exists solely so Jest
// can construct the app's dependency graph without a real .env file
// (e.g. in CI, where no Atlas credentials are ever present). The host
// below does not need to be reachable: nothing in these tests performs
// a real database operation except the dedicated readiness test, which
// asserts the *failure* path (503) precisely because nothing is
// listening there.
//
// Phase 3 note: a real (in-memory, via mongodb-memory-server) MongoDB
// instance was attempted for genuine integration-style e2e tests of
// the business domain, but the required mongod binary download
// stalled indefinitely in this sandboxed network environment (stuck
// at a fixed byte offset across repeated attempts - not a slow
// transfer, a dead one). Phase 3's business-rule tests use this
// project's existing documented strategy instead: mocked-repository
// unit tests (see src/**/*.spec.ts), consistent with how
// database.service.spec.ts already covered Phase 2's DatabaseService.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB_NAME ??= 'management_db_test';

// Same reasoning for NATS: a deliberately unreachable local port (NOT
// 4222, where this project's real local Docker NATS listens - keeping
// the generic unit/e2e suite hermetic from it). The dedicated
// real-NATS integration suite (test/nats-integration.e2e-spec.ts)
// points at the real server explicitly instead of relying on this
// default. See src/messaging/nats/nats-connection.service.ts - the
// connection is lazy, so this only matters for code paths that
// actually attempt to connect.
process.env.NATS_URL ??= 'nats://127.0.0.1:4224';

// Keeps the outbox relay's background setInterval out of the generic
// unit/e2e suite (open-handle noise, irrelevant log spam) - the
// dedicated NATS integration suite explicitly re-enables it.
process.env.OUTBOX_RELAY_DISABLED ??= 'true';
