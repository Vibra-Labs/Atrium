import type { PrismaService } from "../prisma/prisma.service";
import type { SecondFactor } from "./second-factor";

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
    newSession?: unknown;
  };
}

export interface TwoFactorHookDeps {
  prisma: Pick<PrismaService, "session">;
  /** Drops a session token from SessionMiddleware's cache. */
  forgetSession: (token: string) => void;
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
  const factor: SecondFactor | undefined = STEP_UP_FACTORS.get(ctx.path);
  const current = ctx.context.session;
  if (!factor || !current || ctx.context.newSession) return;

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
