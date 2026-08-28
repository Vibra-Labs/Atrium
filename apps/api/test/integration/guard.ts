/**
 * Integration tests in this directory truncate whole tables between cases
 * (`deleteMany({ where: {} })`). That is only safe against a throwaway
 * database — CI gives them one, but a developer who points them at the
 * DATABASE_URL from .env would lose every project, task and invoice in their
 * local Atrium.
 *
 * The precondition used to be invisible: the tests simply failed with "no
 * DATABASE_URL" locally, and the obvious fix was the destructive one. Make it
 * explicit instead — refuse to run unless the target database is clearly
 * disposable.
 *
 * A database counts as disposable when its name ends in `_test`, or the
 * operator has said so with ALLOW_DESTRUCTIVE_TESTS=1. CI is not special-cased:
 * its service container is named atrium_test so it passes the same rule as a
 * developer's machine. (A CI=true bypass would have let any machine with that
 * variable exported — GitHub Actions, GitLab, act, or a shell profile — skip
 * the check against a real database.)
 */
export function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "Integration tests need DATABASE_URL. Start a disposable database " +
        "(docker compose -f docker-compose.test.yml up -d) and point " +
        "DATABASE_URL at it — not at your dev database, since these tests " +
        "truncate tables.",
    );
  }

  if (process.env.ALLOW_DESTRUCTIVE_TESTS === "1") return;

  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run destructive integration tests against database ` +
        `"${databaseName}". These tests truncate tables. Use a database whose ` +
        `name ends in _test (docker-compose.test.yml provides atrium_test), ` +
        `or set ALLOW_DESTRUCTIVE_TESTS=1 if you really mean it.`,
    );
  }
}
