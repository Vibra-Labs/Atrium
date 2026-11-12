/** Parsed command line for `script:disable-2fa`. */
export type ParsedArgs = { email: string; reason: string } | { error: string };

export const USAGE: string = 'Usage: bun run script:disable-2fa <email> --reason "<ticket or note>"';

export function parseArgs(argv: string[]): ParsedArgs {
  let email: string | undefined;
  let reason: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reason") {
      reason = argv[i + 1];
      i++;
    } else if (!argv[i].startsWith("--")) {
      email = argv[i];
    }
  }
  if (!email) return { error: `An email is required. ${USAGE}` };
  if (!reason?.trim()) return { error: `--reason is required, e.g. a support ticket. ${USAGE}` };
  return { email, reason: reason.trim() };
}

export interface RunDeps {
  findUser: (email: string) => Promise<{ id: string } | null>;
  reset: (userId: string) => Promise<{ hadTwoFactor: boolean }>;
  /** Emails the user that 2FA was turned off by the operator. */
  alert: (userId: string) => Promise<void>;
  /** Structured log line. */
  log: (line: { event: string; userId: string; reason: string }) => void;
  /** Human output. */
  print: (text: string) => void;
}

/** Removes a user's 2FA and signs them out everywhere. Returns the exit code. Safe to run twice. */
export async function run(deps: RunDeps, email: string, reason: string): Promise<number> {
  const user = await deps.findUser(email.trim().toLowerCase());
  if (!user) {
    deps.print("No user with that email.");
    return 1;
  }
  const { hadTwoFactor } = await deps.reset(user.id);
  await deps.alert(user.id);
  deps.log({ event: "two_factor.reset_by_operator", userId: user.id, reason });
  deps.print(
    hadTwoFactor
      ? `Removed two-factor for ${email} and signed them out everywhere. They can sign in with their password and set it up again.`
      : `${email} had no two-factor set up. Signed them out everywhere.`,
  );
  return 0;
}
