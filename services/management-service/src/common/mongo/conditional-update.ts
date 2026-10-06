import { ConflictException, NotFoundException } from '@nestjs/common';
import { Collection, Document, Filter, UpdateFilter, WithId } from 'mongodb';
import { ErrorCode } from '../errors/error-codes';

interface Versioned {
  version: number;
}

/**
 * The one place optimistic concurrency is implemented (see
 * docs/DECISIONS.md and docs/ARCHITECTURE.md). `filter` must identify
 * the target document (_id + workspaceId, plus any extra invariants
 * the caller wants enforced atomically, e.g. archivedAt: null) but
 * must NOT include `version` - that's added here from
 * `expectedVersion`. On success the document's version is
 * incremented and `updatedAt` refreshed automatically.
 *
 * - Document not found at all (wrong id, wrong workspace, or an extra
 *   invariant in `filter` failed) -> 404.
 * - Document found but its version didn't match `expectedVersion`
 *   (i.e. a concurrent write already happened) -> 409, with the
 *   current version so the client can re-fetch and retry.
 */
export async function conditionalUpdate<T extends Document & Versioned>(
  collection: Collection<T>,
  filter: Filter<T>,
  expectedVersion: number,
  update: UpdateFilter<T>,
): Promise<WithId<T>> {
  const versionedFilter = { ...filter, version: expectedVersion } as Filter<T>;
  const fullUpdate = {
    ...update,
    $inc: { ...(update.$inc ?? {}), version: 1 },
    $set: { ...(update.$set ?? {}), updatedAt: new Date() },
  } as unknown as UpdateFilter<T>;

  const result = await collection.findOneAndUpdate(versionedFilter, fullUpdate, {
    returnDocument: 'after',
  });
  if (result) return result;

  const existing = await collection.findOne(filter);
  if (!existing) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Resource not found.' });
  }
  throw new ConflictException({
    code: ErrorCode.CONFLICT,
    message: 'Resource has been modified since you last read it.',
    currentVersion: (existing as Versioned).version,
  });
}
