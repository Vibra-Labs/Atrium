import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/** "PAYLOAD_TOO_LARGE" -> "Payload Too Large", matching HttpException responses. */
function reasonPhrase(status: number): string | undefined {
  const name: string | undefined = HttpStatus[status] as string | undefined;
  if (!name) return undefined;
  return name
    .toLowerCase()
    .split("_")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The status of a body-parser (or other Connect middleware) rejection: an
 * ordinary Error carrying an HTTP status, and `expose: true` when its message
 * is safe to send on. `PayloadTooLargeError` and `entity.parse.failed` reach
 * this filter that way, and without this they were answered 500 "Internal
 * Server Error". Anything without `expose`, or outside 4xx, is left to the
 * generic path so nothing internal leaks.
 */
function clientErrorStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) return undefined;
  const err = exception as Error & { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (err.expose !== true) return undefined;
  const status: unknown = typeof err.status === "number" ? err.status : err.statusCode;
  if (typeof status !== "number" || status < 400 || status > 499) return undefined;
  return status;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let error = "Internal Server Error";

    const clientStatus: number | undefined = clientErrorStatus(exception);

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        message = res;
      } else if (typeof res === "object" && res !== null) {
        const obj = res as Record<string, unknown>;
        message = (obj.message as string) ?? message;
        error = (obj.error as string) ?? error;
      }
    } else if (clientStatus !== undefined) {
      statusCode = clientStatus;
      message = (exception as Error).message;
      error = reasonPhrase(clientStatus) ?? error;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error("Unknown exception", exception);
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
    });
  }
}
