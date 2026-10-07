import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

interface RequestWithCorrelationId extends Request {
  correlationId?: string;
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Assigns every request a correlationId - accepting a valid
 * caller-supplied X-Correlation-Id (so a client-side trace continues
 * across this service) or generating one server-side otherwise. Runs
 * before RequestContextGuard (middleware executes before guards in
 * Nest's request lifecycle) so the guard can fold it into
 * RequestContext and from there into outbox rows and NATS headers -
 * see docs/ARCHITECTURE.md "Correlation / observability".
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
    const header = req.headers[CORRELATION_ID_HEADER];
    const supplied = Array.isArray(header) ? header[0] : header;
    const correlationId =
      supplied && CORRELATION_ID_PATTERN.test(supplied) ? supplied : randomUUID();

    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
