import { ObjectId } from 'mongodb';
import { UserRole } from '../identity/user.schema';

/**
 * Fixed, deterministic ids for the development seed data, so
 * `npm run seed` is idempotent (safe to re-run) and so these ids are
 * stable enough to put in documentation/examples. Pre-Phase-9 docs
 * referenced these for the (now removed) X-Dev-User-Id header; they
 * now identify the same demo accounts' real email/password logins -
 * see docs/DECISIONS.md and the Phase 9 final report for the actual
 * demo credentials.
 */
export const SEED_WORKSPACE_ID = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');

export const SEED_USERS: ReadonlyArray<{
  _id: ObjectId;
  name: string;
  email: string;
  role: UserRole;
}> = [
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0001'), name: 'Alice Owner', email: 'alice@example.test', role: 'ADMIN' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0002'), name: 'Bob Lead', email: 'bob@example.test', role: 'EMPLOYEE' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0003'), name: 'Carol Member', email: 'carol@example.test', role: 'EMPLOYEE' },
  { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaa0004'), name: 'Dave Member', email: 'dave@example.test', role: 'EMPLOYEE' },
];
