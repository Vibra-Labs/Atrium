import {
  Catch,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";

/**
 * Sends a failed demo entry to the web app's "demo is unavailable" page.
 *
 * Entry is reached as a top-level form navigation, so the browser renders
 * whatever comes back. Without this, anything that went wrong — a rate limit,
 * a reset mid-request, a missing seed — painted a raw JSON error object across
 * the only door into the product, on the one page whose whole job is a good
 * first impression. The page it lands on instead offers another try and a
 * signup link.
 *
 * 404 is deliberately left alone: demo mode being off must stay
 * indistinguishable from the route not existing, so an ordinary install does
 * not advertise that this endpoint is here.
 */
@Catch()
export class DemoEntryFilter implements ExceptionFilter {
  private readonly logger = new Logger(DemoEntryFilter.name);

  constructor(private config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof NotFoundException) {
      // The same body AllExceptionsFilter would have produced. A 404 shaped
      // unlike every other 404 on the server would itself be the tell that
      // this endpoint is here and merely switched off.
      response
        .status(404)
        .json({ statusCode: 404, message: exception.message, error: "Not Found" });
      return;
    }

    const status: number = exception instanceof HttpException ? exception.getStatus() : 500;
    this.logger.warn(
      `Demo entry failed (${status}): ` +
        `${exception instanceof Error ? exception.message : String(exception)}`,
    );

    const webUrl: string = this.config.get("WEB_URL", "http://localhost:3000");
    // 303 for the same reason the success path uses it: the request was a POST
    // and the page it lands on is GET-only.
    response.redirect(303, `${webUrl}/demo/unavailable`);
  }
}
