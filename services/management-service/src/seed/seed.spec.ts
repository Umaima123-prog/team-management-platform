import { demoPasswordFor } from './seed';

/**
 * Only `demoPasswordFor` is unit-testable in isolation - `seed()`
 * itself boots a real Nest application context against a real Mongo
 * connection (it's a script, run via `npm run seed`, not something
 * exercised by the regular test suite).
 */
describe('demoPasswordFor', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SEED_ADMIN_PASSWORD;
    delete process.env.SEED_EMPLOYEE_PASSWORD;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses SEED_ADMIN_PASSWORD when set, regardless of NODE_ENV', () => {
    process.env.SEED_ADMIN_PASSWORD = 'from-env-admin';
    expect(demoPasswordFor('ADMIN')).toBe('from-env-admin');
  });

  it('uses SEED_EMPLOYEE_PASSWORD when set, regardless of NODE_ENV', () => {
    process.env.SEED_EMPLOYEE_PASSWORD = 'from-env-employee';
    expect(demoPasswordFor('EMPLOYEE')).toBe('from-env-employee');
  });

  it('falls back to the committed default in development when unset', () => {
    process.env.NODE_ENV = 'development';
    expect(demoPasswordFor('ADMIN')).toBe('AdminDemo#2026');
    expect(demoPasswordFor('EMPLOYEE')).toBe('EmployeeDemo#2026');
  });

  it('refuses to fall back to the committed default ADMIN password in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => demoPasswordFor('ADMIN')).toThrow(/SEED_ADMIN_PASSWORD is required/);
  });

  it('refuses to fall back to the committed default EMPLOYEE password in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => demoPasswordFor('EMPLOYEE')).toThrow(/SEED_EMPLOYEE_PASSWORD is required/);
  });

  it('still honors the env var override in production (no error)', () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_ADMIN_PASSWORD = 'real-prod-password';
    expect(demoPasswordFor('ADMIN')).toBe('real-prod-password');
  });
});
