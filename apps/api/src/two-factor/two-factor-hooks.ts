import { APIError } from "better-auth/api";
import type { PrismaService } from "../prisma/prisma.service";
import type { SecondFactor } from "./second-factor";
import type { SecurityAlert } from "./security-alerts";

/** Wrong codes a pending session may enter before it is signed out. */
export const STEP_UP_ATTEMPTS: number = 5;

/** The parts of Better Auth's hook context these hooks read. */
export interface AuthHookContext {
  path: string;
  body?: unknown;
  context: {
    /** The endpoint's result, or the APIError it threw. */
    returned?: unknown;
    /** The session the request came with, if any. */
    session?: {
      session: { id: string; token: string; secondFactor?: string | null };
      user: { id: string };
    } | null;
    /** Set when the endpoint created a session (sign-in, enable). */
    newSession?: { user?: { id: string } } | null;
  };
}

export interface TwoFactorHookDeps {
  prisma: Pick<PrismaService, "session">;
  /** Drops a session token from SessionMiddleware's cache. */
  forgetSession: (token: string) => void;
  /** Drops every cached session of a user, so a change to their factors applies at once. */
  forgetUser: (userId: string) => void;
  /** Emails the user about a security change. Never throws. */
  sendAlert: (userId: string, alert: SecurityAlert) => Promise<void>;
  /** Recovery codes the user has left. */
  recoveryCodesLeft: (userId: string) => Promise<number>;
  /** Whether the user is an owner or admin of a workspace that requires 2FA. */
  isStaffInRequiringWorkspace: (userId: string) => Promise<boolean>;
  /** Counts a wrong step-up code for a session and returns the running total. */
  recordStepUpFailure: (sessionId: string) => Promise<number>;
}

const STEP_UP_FACTORS: ReadonlyMap<string, SecondFactor> = new Map<string, SecondFactor>([
  ["/two-factor/verify-totp", "totp"],
  ["/two-factor/verify-backup-code", "backup_code"],
]);

function failed(returned: unknown): boolean {
  return returned instanceof Error;
}

/**
 * Step-up on an existing session. When the request already had a session,
 * the plugin verifies the code and returns without creating a new one, so the
 * session.create hook never sees it: mark it here. Without a session (the
 * password challenge, or enabling 2FA) the plugin creates a new session,
 * which the create hook stamps.
 */
export async function twoFactorAfterHook(ctx: AuthHookContext, deps: TwoFactorHookDeps): Promise<void> {
  await alertAfter(ctx, deps);
  await stepUpAfter(ctx, deps);
}

/** Alert emails for successful recovery-code use and for turning 2FA off. */
async function alertAfter(ctx: AuthHookContext, deps: TwoFactorHookDeps): Promise<void> {
  if (failed(ctx.context.returned)) return;
  const userId: string | undefined = ctx.context.session?.user.id ?? ctx.context.newSession?.user?.id;
  if (!userId) return;
  if (ctx.path === "/two-factor/verify-backup-code") {
    await deps.sendAlert(userId, { kind: "recovery_code_used", remaining: await deps.recoveryCodesLeft(userId) });
  } else if (ctx.path === "/two-factor/disable") {
    deps.forgetUser(userId);
    await deps.sendAlert(userId, { kind: "two_factor_disabled", by: "you" });
  }
}

async function stepUpAfter(ctx: AuthHookContext, deps: TwoFactorHookDeps): Promise<void> {
  const factor: SecondFactor | undefined = STEP_UP_FACTORS.get(ctx.path);
  const current = ctx.context.session;
  if (!factor || !current) return;
  if (ctx.context.newSession) {
    // Turning 2FA on replaces this session; every other one is now pending.
    if (!failed(ctx.context.returned)) deps.forgetUser(current.user.id);
    return;
  }

  if (failed(ctx.context.returned)) {
    // The plugin limits attempts on the password challenge only. A pending
    // session gets a fixed number of tries, then has to sign in again.
    if (current.session.secondFactor) return;
    const attempts: number = await deps.recordStepUpFailure(current.session.id);
    if (attempts >= STEP_UP_ATTEMPTS) {
      await deps.prisma.session.deleteMany({ where: { id: current.session.id } });
      deps.forgetSession(current.session.token);
    }
    return;
  }

  await deps.prisma.session.update({
    where: { token: current.session.token },
    data: { secondFactor: factor },
  });
  deps.forgetSession(current.session.token);
}

/**
 * Runs before a Better Auth endpoint. `userId` is the caller's, resolved by
 * the wrapper only for the paths that need it.
 */
export async function twoFactorBeforeHook(
  input: { path: string; userId: string | null },
  deps: TwoFactorHookDeps,
): Promise<void> {
  if (input.path !== "/two-factor/disable" || !input.userId) return;
  // TOTP is the only factor until passkeys arrive, so turning it off would
  // leave staff of a requiring workspace with none.
  if (await deps.isStaffInRequiringWorkspace(input.userId)) {
    throw new APIError("FORBIDDEN", {
      message: "Your workspace requires two-factor authentication, so it can't be turned off.",
    });
  }
}
