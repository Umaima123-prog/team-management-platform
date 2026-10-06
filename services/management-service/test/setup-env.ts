// Test-only env defaults. The application itself never hardcodes a
// MongoDB URI - DatabaseModule requires MONGODB_URI/MONGODB_DB_NAME to
// be configured via the environment. This file exists solely so Jest
// can construct the app's dependency graph without a real .env file
// (e.g. in CI, where no Atlas credentials are ever present). The host
// below does not need to be reachable: nothing in these tests performs
// a real database operation except the dedicated readiness test, which
// asserts the *failure* path (503) precisely because nothing is
// listening there.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB_NAME ??= 'management_db_test';
