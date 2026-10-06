import { ObjectId } from 'mongodb';

/** Maps a Mongo document's `_id: ObjectId` to a plain `id: string` for
 * API responses, so clients never need to know about BSON types. */
export function withId<T extends { _id: ObjectId }>(doc: T): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id.toHexString() };
}
