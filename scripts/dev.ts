import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

const root = join(import.meta.dirname, "..");
const dbDir = join(root, "packages/database");

function loadEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function main() {
  const envPath = join(root, ".env");

  // Copy .env.example if .env doesn't exist
  if (!existsSync(envPath)) {
    const { copyFileSync } = await import("fs");
    copyFileSync(join(root, ".env.example"), envPath);
    console.log("Created .env from .env.example");
  }

  loadEnv(envPath);

  // Start PostgreSQL if docker is available
  try {
    await $`docker compose -f docker-compose.dev.yml up -d`.cwd(root).quiet();
    console.log("PostgreSQL container started");

    // Wait for Postgres to accept connections
    for (let i = 0; i < 30; i++) {
      try {
        await $`docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U atrium`.cwd(root).quiet();
        break;
      } catch {
        if (i === 29) console.warn("Warning: PostgreSQL may not be ready");
        await Bun.sleep(1000);
      }
    }
  } catch {
    console.warn("Warning: Docker not available — make sure PostgreSQL is running manually");
  }

  // Generate Prisma client and push schema
  // Always run generate — bun hoists to node_modules/.bun/ so checking existence is unreliable
  console.log("Generating Prisma client...");
  await $`bunx prisma generate`.cwd(dbDir).quiet();

  console.log("Syncing database schema...");
  try {
    await $`bunx prisma db push --skip-generate`.cwd(dbDir).quiet();
  } catch {
    console.warn("Warning: Could not push database schema — the API may fail to start");
  }

  // Run turbo dev
  const turbo = Bun.spawn(["bunx", "turbo", "run", "dev"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });

  await turbo.exited;
}

main().catch((err) => {
  console.error("Dev startup failed:", err.message);
  process.exit(1);
});
