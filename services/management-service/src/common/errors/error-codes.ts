/**
 * Stable, machine-readable error codes used across the stable error
 * envelope (see all-exceptions.filter.ts). Controllers/services throw
 * Nest HttpExceptions with one of these as the `code` field of the
 * response body; unmapped statuses fall back to a generic code.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INVALID_CURSOR = 'INVALID_CURSOR',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
