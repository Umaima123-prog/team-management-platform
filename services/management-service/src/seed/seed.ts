/**
 * Development data seed: one workspace + several users (see
 * seed-ids.ts for why the ids are fixed/deterministic). Run with
 * `npm run seed`. Idempotent - upserts by the fixed _id, so re-running
 * never duplicates data. Never creates teams/projects/work items -
 * those are created through the API, same as any other client would.
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
import { UserDocument } from '../identity/user.schema';
import { WorkspaceDocument } from '../identity/workspace.schema';
import { SEED_USERS, SEED_WORKSPACE_ID } from './seed-ids';

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
      await users.updateOne(
        { _id: user._id },
        {
          $setOnInsert: {
            workspaceId: SEED_WORKSPACE_ID.toHexString(),
            name: user.name,
            email: user.email,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      console.log(`User ready: ${user.name} (${user._id.toHexString()})`);
    }

    console.log(
      'Seed complete. Use header "X-Dev-User-Id: <user id above>" to act as a seeded user.',
    );
  } finally {
    await app.close();
  }
}

seed().catch((error: unknown) => {
  console.error(`Seed failed (${(error as Error).name})`);
  process.exitCode = 1;
});
