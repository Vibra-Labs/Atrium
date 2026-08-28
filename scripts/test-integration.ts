import { join } from "path";
import { $ } from "bun";

/**
 * Runs the API integration tests against a disposable database.
 *
 * These tests truncate whole tables between cases, so they must never touch
 * the dev database. This script brings up docker-compose.test.yml (Postgres on
 * 5433, tmpfs-backed, database "atrium_test"), pushes the schema, and points
 * the tests at it. apps/api/test/integration/guard.ts refuses to run against
 * anything that isn't clearly disposable, so the two work as a pair.
 *
 * The container is left running afterwards: it is tmpfs-backed, so nothing
 * persists, and reusing it makes reruns fast. `docker compose -f
 * docker-compose.test.yml down` removes it.
 */
const root = join(import.meta.dirname, "..");
const TEST_DB_URL = "postgresql://atrium:atrium@localhost:5433/atrium_test";

async function dockerAvailable(): Promise<boolean> {
  try {
    await $`docker info`.quiet();
    return true;
  } catch {
    return false;
  }
}

const composeFile = join(root, "docker-compose.test.yml");

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // Addressed by service, not container name, so it survives any change
      // to the compose project name.
      await $`docker compose -f ${composeFile} exec -T postgres-test pg_isready -q`.quiet();
      return;
    } catch {
      await Bun.sleep(1000);
    }
  }
  throw new Error("Test database did not become ready in 30s");
}

async function main(): Promise<void> {
  if (!(await dockerAvailable())) {
    console.error(
      "Docker is not running. The integration tests need the disposable " +
        "Postgres from docker-compose.test.yml.",
    );
    process.exit(1);
  }

  console.log("Starting disposable test database...");
  await $`docker compose -f ${composeFile} up -d`;
  await waitForPostgres();

  console.log("Pushing schema...");
  await $`bunx prisma db push --skip-generate`
    .cwd(join(root, "packages/database"))
    .env({
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      DIRECT_URL: TEST_DB_URL,
    });

  console.log("Running integration tests...\n");
  const result = await $`bun test test/integration`
    .cwd(join(root, "apps/api"))
    .env({
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      DIRECT_URL: TEST_DB_URL,
    })
    .nothrow();

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error("Integration test run failed:", err);
  process.exit(1);
});
