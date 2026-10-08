/**
 * Development data seed: one workspace + several users (see
 * seed-ids.ts for why the ids are fixed/deterministic). Run with
 * `npm run seed`. Idempotent - upserts by the fixed _id, so re-running
 * never duplicates data. Never creates teams/projects/work items -
 * those are created through the API, same as any other client would.
 *
 * Phase 9: also a safe backfill path for users created by the
 * pre-auth version of this script (or already deployed before real
 * auth existed), which never had passwordHash/role/active/
 * tokenVersion. The backfill only ever fills in a field that is
 * genuinely MISSING (`$exists: false` guards) - it never resets an
 * already-set passwordHash or overwrites a role an admin changed
 * after the fact, and it never touches teams/projects/work items.
 *
 * Uses plain console output, not Nest's Logger: createApplicationContext's
 * `{ logger: false }` (used here to suppress framework noise) silences
 * the Logger class process-wide, which would otherwise swallow this
 * script's own output along with it.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { hashPassword } from '../auth/password.util';
import { UserDocument } from '../identity/user.schema';
import { WorkspaceDocument } from '../identity/workspace.schema';
import { SEED_USERS, SEED_WORKSPACE_ID } from './seed-ids';

// Committed, publicly-known placeholders - fine for a local/dev
// database only. In production these must never actually be used:
// see the NODE_ENV guard below, which fails fast instead of silently
// falling back to these if the real env vars are unset.
const DEFAULT_ADMIN_PASSWORD = 'AdminDemo#2026';
const DEFAULT_EMPLOYEE_PASSWORD = 'EmployeeDemo#2026';

export function demoPasswordFor(role: 'ADMIN' | 'EMPLOYEE'): string {
  const envVar = role === 'ADMIN' ? 'SEED_ADMIN_PASSWORD' : 'SEED_EMPLOYEE_PASSWORD';
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    // Refuse to seed a real/deployed workspace with a password that
    // is committed in this file and therefore publicly known - unlike
    // local dev, there is no safe fallback here.
    throw new Error(
      `${envVar} is required when NODE_ENV=production - refusing to seed the ${role} ` +
        'account with the committed default demo password.',
    );
  }

  return role === 'ADMIN' ? DEFAULT_ADMIN_PASSWORD : DEFAULT_EMPLOYEE_PASSWORD;
}

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const databaseService = app.get(DatabaseService);

  try {
    const workspaces = databaseService.getCollection<WorkspaceDocument>('workspaces');
    await workspaces.updateOne(
      { _id: SEED_WORKSPACE_ID },
      {
        $setOnInsert: {
          name: 'Acme Dev Workspace',
          slug: 'acme-dev',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    console.log(`Workspace ready: ${SEED_WORKSPACE_ID.toHexString()}`);

    const users = databaseService.getCollection<UserDocument>('users');
    for (const user of SEED_USERS) {
      const passwordHash = await hashPassword(demoPasswordFor(user.role));

      // Fresh install: inserts the complete document, auth fields
      // included, in one write.
      await users.updateOne(
        { _id: user._id },
        {
          $setOnInsert: {
            workspaceId: SEED_WORKSPACE_ID.toHexString(),
            name: user.name,
            email: user.email,
            role: user.role,
            passwordHash,
            active: true,
            tokenVersion: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      // Backfill: a user that already existed before Phase 9 (no
      // passwordHash at all) gets one filled in now - guarded so an
      // already-migrated user (passwordHash already set, however it
      // got there) is never touched by this branch.
      const backfillResult = await users.updateOne(
        { _id: user._id, passwordHash: { $exists: false } },
        {
          $set: {
            role: user.role,
            passwordHash,
            active: true,
            tokenVersion: 0,
          },
        },
      );
      if (backfillResult.modifiedCount > 0) {
        console.log(`User ready: ${user.name} (${user._id.toHexString()}) - backfilled auth fields`);
      } else {
        console.log(`User ready: ${user.name} (${user._id.toHexString()})`);
      }
    }

    console.log('Seed complete. Demo credentials are printed separately - see the Phase 9 report.');
  } finally {
    await app.close();
  }
}

// Only auto-run when executed directly (`npm run seed`) - guarded so
// `seed.spec.ts` can import `demoPasswordFor` from this module without
// also triggering a real NestFactory/Mongo bootstrap as a side effect.
if (require.main === module) {
  seed().catch((error: unknown) => {
    console.error(`Seed failed (${(error as Error).name})`);
    process.exitCode = 1;
  });
}
