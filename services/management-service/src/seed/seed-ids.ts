import { ObjectId } from 'mongodb';

/**
 * Fixed, deterministic ids for the Phase 3 development seed data, so
 * `npm run seed` is idempotent (safe to re-run) and so these ids are
 * stable enough to put in documentation/examples for local testing
 * with the X-Dev-User-Id header (see docs/ARCHITECTURE.md).
 */
export const SEED_WORKSPACE_ID = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');

export const SEED_USERS = [
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0001'), name: 'Alice Owner', email: 'alice@example.test' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0002'), name: 'Bob Lead', email: 'bob@example.test' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0003'), name: 'Carol Member', email: 'carol@example.test' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0004'), name: 'Dave Member', email: 'dave@example.test' },
] as const;
