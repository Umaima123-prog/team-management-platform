import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestContext } from './request-context';

interface RequestWithContext extends Request {
  context?: RequestContext;
}

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    // Set by RequestContextGuard, which runs on every non-@Public()
    // route before any controller method executes.
    return request.context as RequestContext;
  },
);
