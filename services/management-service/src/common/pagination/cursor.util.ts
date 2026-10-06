import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { ErrorCode } from '../errors/error-codes';

/**
 * Opaque keyset/cursor pagination on _id. ObjectIds are naturally
 * monotonic (timestamp-prefixed) and unique, so `_id` alone is a
 * stable, collision-free cursor key - no secondary sort field needed
 * for correctness (callers that need a different primary sort still
 * use `_id` as the tie-breaker).
 */
export function encodeCursor(id: ObjectId): string {
  return Buffer.from(id.toHexString(), 'hex').toString('base64url');
}

export function decodeCursor(cursor: string): ObjectId {
  let hex: string;
  try {
    hex = Buffer.from(cursor, 'base64url').toString('hex');
  } catch {
    throw new BadRequestException({
      code: ErrorCode.INVALID_CURSOR,
      message: 'Invalid pagination cursor.',
    });
  }
  if (!/^[0-9a-f]{24}$/i.test(hex)) {
    throw new BadRequestException({
      code: ErrorCode.INVALID_CURSOR,
      message: 'Invalid pagination cursor.',
    });
  }
  return new ObjectId(hex);
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}
