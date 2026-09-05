import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithUser } from './request-with-user';

/**
 * Injects the authenticated caller into a controller method, e.g.
 * `create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ...)` —
 * mirrors @CurrentCompany() exactly (src/common/tenant/). The
 * controller passes it straight through to the service, never reading
 * req.user itself.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    return req.user;
  },
);
