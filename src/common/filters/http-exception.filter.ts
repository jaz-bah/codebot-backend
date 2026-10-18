import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Uniform error envelope for NEST-owned routes:
 *   { statusCode, message, error, timestamp, path }
 * `/api/auth/**` responses are BetterAuth-owned (PRD D4) and are NOT passed
 * through this filter (they never reach Nest's exception layer; the guard is
 * only a belt-and-suspenders skip for those paths).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? typeof exception.getResponse() === 'string'
          ? exception.getResponse()
          : ((exception.getResponse() as Record<string, unknown>)?.message ?? exception.message)
        : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `${request?.method} ${request?.originalUrl ?? request?.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (response?.status) {
      response.status(status).json({
        statusCode: status,
        message: Array.isArray(message) ? message.join(', ') : message,
        error: exception instanceof HttpException ? exception.name : 'HttpException',
        timestamp: new Date().toISOString(),
        path: request?.originalUrl ?? request?.url ?? null,
      });
    }
  }
}
