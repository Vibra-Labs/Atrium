import { SMTP_SECURITY, SMTP_SECURITY_VALUES } from "@atrium/shared";
import type { SmtpSecurity } from "@atrium/shared";

const IMPLICIT_TLS_PORT = 465;

/**
 * The connection mode to use. A stored mode wins. Older rows only have the
 * "Use TLS/SSL" checkbox, which nodemailer reads as implicit TLS, so on
 * port 587 a ticked box failed the handshake. Port 465 is always implicit TLS;
 * on any other port a ticked box means STARTTLS and an unticked one means none.
 */
export function resolveSmtpSecurity(
  stored: string | null | undefined,
  legacySecure: boolean | null | undefined,
  port: number | null | undefined,
): SmtpSecurity {
  const known: SmtpSecurity | undefined = SMTP_SECURITY_VALUES.find((value: SmtpSecurity) => value === stored);
  if (known) return known;
  if (port === IMPLICIT_TLS_PORT) return SMTP_SECURITY.TLS;
  return legacySecure === false ? SMTP_SECURITY.NONE : SMTP_SECURITY.STARTTLS;
}

/** The nodemailer options for a mode. "none" still upgrades to TLS when the server offers it. */
export function smtpTransportSecurity(security: SmtpSecurity): { secure: boolean; requireTLS: boolean } {
  return {
    secure: security === SMTP_SECURITY.TLS,
    requireTLS: security === SMTP_SECURITY.STARTTLS,
  };
}

export interface SmtpConfig {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  security: SmtpSecurity;
}

/** The nodemailer connection options for an SMTP config; one place so sending and the test email agree. */
export function smtpTransportOptions(smtp: SmtpConfig): {
  host: string | undefined;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string } | undefined;
} {
  return {
    host: smtp.host ?? undefined,
    port: smtp.port,
    ...smtpTransportSecurity(smtp.security),
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
  };
}

/** Turns the raw handshake errors people hit when mode and port disagree into something they can act on. */
export function smtpErrorMessage(err: unknown, security: SmtpSecurity, port: number): string {
  const message: string = err instanceof Error ? err.message : "Unknown error";
  if (security === SMTP_SECURITY.TLS && /wrong version number/i.test(message)) {
    return `The server on port ${port} did not accept an SSL/TLS connection. Most servers on port 587 want STARTTLS instead: set Security to STARTTLS, or use SSL/TLS with port 465.`;
  }
  if (security !== SMTP_SECURITY.TLS && /greeting never received/i.test(message)) {
    return `The server on port ${port} did not answer. If this is port 465, set Security to SSL/TLS.`;
  }
  return message;
}
