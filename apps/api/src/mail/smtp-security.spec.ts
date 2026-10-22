import { describe, expect, it } from "bun:test";
import { resolveSmtpSecurity, smtpErrorMessage, smtpTransportOptions, smtpTransportSecurity } from "./smtp-security";
import type { SmtpConfig } from "./smtp-security";

describe("smtpTransportOptions", () => {
  const base: SmtpConfig = { host: "smtp.example.com", port: 587, user: "me", pass: "secret", security: "starttls" };

  it("builds the connection options with the mode's TLS flags", () => {
    expect(smtpTransportOptions(base)).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "me", pass: "secret" },
    });
    expect(smtpTransportOptions({ ...base, port: 465, security: "tls" })).toMatchObject({ secure: true, requireTLS: false });
  });

  it("leaves auth out without a username and password", () => {
    expect(smtpTransportOptions({ ...base, user: null, pass: null }).auth).toBeUndefined();
    expect(smtpTransportOptions({ ...base, pass: null }).auth).toBeUndefined();
  });

  it("leaves the host undefined when none is set", () => {
    expect(smtpTransportOptions({ ...base, host: null }).host).toBeUndefined();
  });
});

describe("resolveSmtpSecurity", () => {
  it("uses a stored mode as is", () => {
    expect(resolveSmtpSecurity("tls", true, 587)).toBe("tls");
    expect(resolveSmtpSecurity("starttls", false, 465)).toBe("starttls");
    expect(resolveSmtpSecurity("none", true, 465)).toBe("none");
  });

  it("derives a mode from the old checkbox when none is stored", () => {
    expect(resolveSmtpSecurity(null, true, 465)).toBe("tls");
    expect(resolveSmtpSecurity(null, true, 587)).toBe("starttls");
    expect(resolveSmtpSecurity(null, false, 587)).toBe("none");
  });

  it("treats port 465 as implicit TLS even with the old checkbox off", () => {
    expect(resolveSmtpSecurity(null, false, 465)).toBe("tls");
  });

  it("defaults to STARTTLS when nothing is known", () => {
    expect(resolveSmtpSecurity(null, null, null)).toBe("starttls");
    expect(resolveSmtpSecurity(undefined, undefined, undefined)).toBe("starttls");
  });

  it("ignores an unknown stored value", () => {
    expect(resolveSmtpSecurity("ssl", true, 587)).toBe("starttls");
  });
});

describe("smtpTransportSecurity", () => {
  it("maps each mode to nodemailer options", () => {
    expect(smtpTransportSecurity("tls")).toEqual({ secure: true, requireTLS: false });
    expect(smtpTransportSecurity("starttls")).toEqual({ secure: false, requireTLS: true });
    expect(smtpTransportSecurity("none")).toEqual({ secure: false, requireTLS: false });
  });
});

describe("smtpErrorMessage", () => {
  const openssl = "80A1B9F401000000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number";

  it("explains a TLS handshake against a plain-text server", () => {
    const message: string = smtpErrorMessage(new Error(openssl), "tls", 587);
    expect(message).toContain("port 587");
    expect(message).toContain("STARTTLS");
    expect(message).not.toContain("OPENSSL");
  });

  it("explains a silent server when STARTTLS is used on an implicit-TLS port", () => {
    const message: string = smtpErrorMessage(new Error("Greeting never received"), "starttls", 465);
    expect(message).toContain("port 465");
    expect(message).toContain("SSL/TLS");
  });

  it("passes other errors through unchanged", () => {
    expect(smtpErrorMessage(new Error("Invalid login: 535"), "starttls", 587)).toBe("Invalid login: 535");
  });

  it("handles non-Error values", () => {
    expect(smtpErrorMessage("boom", "starttls", 587)).toBe("Unknown error");
  });
});
