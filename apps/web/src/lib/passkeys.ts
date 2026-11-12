import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { postAuth } from "./auth-fetch";
import type { AuthResult } from "./auth-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type JsonBody = Record<string, unknown>;

/**
 * What to tell the person after a passkey ceremony failed, or null when they
 * simply cancelled the browser prompt. `code` is the server's error code,
 * `serverMessage` its message.
 */
export function passkeyErrorMessage(err: unknown, code?: string, serverMessage?: string): string | null {
  const e = (err ?? {}) as { code?: string; name?: string; message?: string };
  if (e.code === "ERROR_CEREMONY_ABORTED" || e.name === "NotAllowedError" || e.name === "AbortError") return null;
  if (code === "SESSION_NOT_FRESH") return "For your security, sign in again to add a passkey.";
  if (e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already has a passkey for your account.";
  return serverMessage || e.message || "Something went wrong with the passkey. Please try again.";
}

async function getJson(path: string): Promise<{ ok: boolean; body: JsonBody }> {
  const res: Response = await fetch(`${API_URL}/api/auth${path}`, { credentials: "include" });
  const body: JsonBody = (await res.json().catch((err: unknown) => {
    console.error(err);
    return {};
  })) as JsonBody;
  return { ok: res.ok, body };
}

/** "Sign in with a passkey" and "Use a passkey": the browser picks the passkey, no email typed. */
export async function signInWithPasskey(): Promise<AuthResult | { ok: false; cancelled: true; status: 0 }> {
  try {
    const options = await getJson("/passkey/generate-authenticate-options");
    if (!options.ok) {
      return { ok: false, status: 0, message: passkeyErrorMessage(null, undefined, options.body.message as string) ?? undefined };
    }
    const response = await startAuthentication({ optionsJSON: options.body as unknown as PublicKeyCredentialRequestOptionsJSON });
    return await postAuth("/passkey/verify-authentication", { response });
  } catch (err) {
    console.error("Passkey sign-in failed", err);
    const message: string | null = passkeyErrorMessage(err);
    return message === null ? { ok: false, cancelled: true, status: 0 } : { ok: false, status: 0, message };
  }
}

export type RegisterResult = { ok: true } | { ok: false; message: string | null };

/** Adds a passkey on this device to the signed-in account. `message` is null when the person cancelled. */
export async function registerPasskey(name: string): Promise<RegisterResult> {
  try {
    const options = await getJson("/passkey/generate-register-options");
    if (!options.ok) {
      return {
        ok: false,
        message: passkeyErrorMessage(null, options.body.code as string, options.body.message as string),
      };
    }
    const response = await startRegistration({
      optionsJSON: options.body as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    const res: Response = await fetch(`${API_URL}/api/auth/passkey/verify-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ response, name: name.trim() || undefined }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch((err: unknown) => {
      console.error(err);
      return {};
    })) as JsonBody;
    return { ok: false, message: passkeyErrorMessage(null, body.code as string, body.message as string) };
  } catch (err) {
    console.error("Adding a passkey failed", err);
    return { ok: false, message: passkeyErrorMessage(err) };
  }
}
