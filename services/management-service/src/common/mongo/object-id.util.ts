import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { ErrorCode } from '../errors/error-codes';

/** Parses a route/body id param, rejecting malformed ids with a 400
 * instead of letting them reach the database (never trust raw input
 * where a client could otherwise smuggle a non-ObjectId value into a
 * query). */
export function parseObjectId(value: string, fieldName = 'id'): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_ERROR,
      message: `${fieldName} is not a valid id.`,
    });
  }
  return new ObjectId(value);
}
