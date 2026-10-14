import type { EmailElement, EmailRenderer } from "../../mail/email-renderer";

/**
 * Stands in for EmailRenderer in unit tests. The "HTML" is the element tree as
 * JSON, so a spec can check that a name, date or URL reached the email without
 * rendering React, and without caring whether another spec has mocked the templates.
 */
export function fakeEmailRenderer(): EmailRenderer {
  return {
    render: async (element: EmailElement): Promise<string> => JSON.stringify(element),
  } as EmailRenderer;
}
