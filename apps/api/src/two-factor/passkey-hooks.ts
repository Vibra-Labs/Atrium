import { APIError } from "better-auth/api";
import type { TwoFactorHookDeps } from "./two-factor-hooks";
import type { PasskeyDeleteOutcome } from "./passkey-delete";

/** Better Auth passkey paths passkeyBeforeHook acts on; the wrapper resolves the caller only for these. */
export const PASSKEY_BEFORE_PATHS: ReadonlySet<string> = new Set<string>([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/update-passkey",
  "/passkey/delete-passkey",
]);

const REGISTER_PATHS: ReadonlySet<string> = new Set<string>([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
]);

const NAMED_PATHS: ReadonlySet<string> = new Set<string>(["/passkey/verify-registration", "/passkey/update-passkey"]);

/** Longest passkey name accepted ("MacBook Pro", "YubiKey 5C"). The plugin sets no limit. */
export const MAX_PASSKEY_NAME: number = 64;

export type PasskeyHookDeps = Pick<
  TwoFactorHookDeps,
  "prisma" | "forgetSession" | "forgetUser" | "sendAlert" | "isStaffInRequiringWorkspace"
> & {
  /** Whether the user is an owner or admin of any workspace. */
  isStaffAnywhere: (userId: string) => Promise<boolean>;
  /** Removes one of the user's passkeys under a row lock; see deletePasskeyGuarded. */
  deletePasskey: (userId: string, passkeyId: string) => Promise<PasskeyDeleteOutcome>;
};

export interface PasskeyBeforeInput {
  path: string;
  userId: string | null;
  body: Record<string, unknown>;
}

/**
 * Rules the passkey plugin doesn't know: staff-only registration, registration
 * never signs anyone in, sane names, and staff of a workspace that requires
 * 2FA keep at least one factor. Adding and removing need no extra proof (the
 * owner's call); both send an alert email.
 */
export async function passkeyBeforeHook(
  input: PasskeyBeforeInput,
  deps: PasskeyHookDeps,
): Promise<{ status: true } | void> {
  if (!PASSKEY_BEFORE_PATHS.has(input.path) || !input.userId) return;

  // Checked on both steps, so someone demoted between them is still refused.
  if (REGISTER_PATHS.has(input.path) && !(await deps.isStaffAnywhere(input.userId))) {
    throw new APIError("FORBIDDEN", { message: "Passkeys are for workspace owners and admins." });
  }

  // createSession would make registration a sign-in route outside the gate.
  if (input.path === "/passkey/verify-registration" && input.body.createSession === true) {
    throw new APIError("BAD_REQUEST", { message: "Adding a passkey can't sign you in." });
  }

  const name: unknown = input.body.name;
  if (NAMED_PATHS.has(input.path) && typeof name === "string" && name.length > MAX_PASSKEY_NAME) {
    throw new APIError("BAD_REQUEST", { message: `Passkey names can be up to ${MAX_PASSKEY_NAME} characters.` });
  }

  // Atrium removes the passkey itself, in one locked transaction, and answers
  // the request; the plugin's own delete never runs (nor do after-hooks).
  if (input.path === "/passkey/delete-passkey") {
    const id: unknown = input.body.id;
    if (typeof id !== "string" || !id) throw new APIError("BAD_REQUEST", { message: "Which passkey?" });
    const outcome: PasskeyDeleteOutcome = await deps.deletePasskey(input.userId, id);
    if (outcome === "not_found") throw new APIError("UNAUTHORIZED", { message: "That passkey isn't yours." });
    if (outcome === "last_factor") {
      throw new APIError("FORBIDDEN", {
        message:
          "Your workspace requires two-factor authentication, so you can't remove your last way to provide it. Add another passkey or an authenticator app first.",
      });
    }
    deps.forgetUser(input.userId);
    await deps.sendAlert(input.userId, { kind: "passkey_removed" });
    return { status: true };
  }
}

export interface PasskeyAfterInput {
  path: string;
  /** The endpoint succeeded. */
  ok: boolean;
  userId: string | null;
  /** The session the request came with, when the endpoint resolved one. */
  currentSession: { token: string; secondFactor: string | null } | null;
  /** The session token the browser sent, read from the cookie. */
  previousToken: string | null;
  /** The session the endpoint created, if any. */
  newSessionToken: string | null;
}

export async function passkeyAfterHook(input: PasskeyAfterInput, deps: PasskeyHookDeps): Promise<void> {
  if (!input.ok) return;

  if (input.path === "/passkey/verify-authentication") {
    if (!input.newSessionToken) return;
    const replaced: boolean = input.previousToken !== null && input.previousToken !== input.newSessionToken;
    // Record the ceremony itself: the proof "confirm with your passkey" checks.
    const data: { passkeyVerifiedAt: Date; activeOrganizationId?: string } = { passkeyVerifiedAt: new Date() };
    if (replaced && input.previousToken) {
      // Same person stepping up: stay in the workspace they were working in,
      // not whichever one a brand-new session would pick.
      const previous = await deps.prisma.session.findUnique({
        where: { token: input.previousToken },
        select: { userId: true, activeOrganizationId: true },
      });
      if (previous && previous.userId === input.userId && previous.activeOrganizationId) {
        data.activeOrganizationId = previous.activeOrganizationId;
      }
    }
    await deps.prisma.session.update({ where: { token: input.newSessionToken }, data });
    if (replaced && input.previousToken) {
      // The plugin leaves the session the browser had (often a pending one)
      // alive. Its cookie is being replaced, so end it.
      await deps.prisma.session.deleteMany({ where: { token: input.previousToken } });
      deps.forgetSession(input.previousToken);
    }
    return;
  }

  if (!input.userId) return;

  if (input.path === "/passkey/verify-registration") {
    // The ceremony proved the passkey, so the session that added it stays
    // verified; the user's other sessions now need a factor.
    if (input.currentSession && input.currentSession.secondFactor === null) {
      await deps.prisma.session.update({
        where: { token: input.currentSession.token },
        data: { secondFactor: "passkey" },
      });
      deps.forgetSession(input.currentSession.token);
    }
    deps.forgetUser(input.userId);
    await deps.sendAlert(input.userId, { kind: "passkey_added" });
  }
}
