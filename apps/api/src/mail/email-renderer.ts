import { Injectable } from "@nestjs/common";
import { render } from "@react-email/render";

export type EmailElement = Parameters<typeof render>[0];

/**
 * Turns a React Email template into HTML. Injected rather than imported so
 * scheduled tasks can be unit-tested with a fake instead of a module mock.
 */
@Injectable()
export class EmailRenderer {
  render(element: EmailElement): Promise<string> {
    return render(element);
  }
}
