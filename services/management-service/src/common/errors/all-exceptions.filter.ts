import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode } from './error-codes';

/**
 * Normalizes every error (HttpException or not) into one stable
 * envelope: { error: { code, message, details? } }. Never forwards a
 * raw driver/internal error message to the client - unexpected errors
 * log the error name server-side only (see DatabaseService.ping for
 * the same pattern) and return a generic message.
 */
const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(this.toEnvelope(status, body));
      return;
    }

    // Unexpected/unhandled error - never leak internals to the client.
    this.logger.error(`Unhandled exception (${(exception as Error)?.name ?? 'Unknown'})`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error.' },
    } satisfies ErrorEnvelope);
  }

  private toEnvelope(status: number, body: unknown): ErrorEnvelope {
    const fallbackCode = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;

    if (typeof body === 'string') {
      return { error: { code: fallbackCode, message: body } };
    }

    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;

      // ValidationPipe's default shape: { statusCode, message: string[], error: 'Bad Request' }
      if (Array.isArray(record.message)) {
        return {
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Validation failed.',
            details: record.message,
          },
        };
      }

      const code = typeof record.code === 'string' ? record.code : fallbackCode;
      const message =
        typeof record.message === 'string' ? record.message : 'Request failed.';
      // statusCode/error are Nest's own default HttpException wrapper
      // metadata (e.g. new BadRequestException('x') produces
      // {statusCode, message, error}) - already represented by the
      // HTTP status and `code` above, so excluded as noise rather
      // than real details.
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key !== 'code' && key !== 'message' && key !== 'statusCode' && key !== 'error') {
          rest[key] = value;
        }
      }
      const hasDetails = Object.keys(rest).length > 0;

      return {
        error: {
          code,
          message,
          ...(hasDetails ? { details: rest } : {}),
        },
      };
    }

    return { error: { code: fallbackCode, message: 'Request failed.' } };
  }
}
