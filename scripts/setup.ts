import { existsSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

const root = join(import.meta.dirname, "..");
const dbDir = join(root, "packages/database");

// Load .env into process so child commands inherit it
function loadEnv(envPath: string) {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function run() {
  // 1. Copy .env.example to .env if it doesn't exist
  const envPath = join(root, ".env");
  const envExamplePath = join(root, ".env.example");
  if (!existsSync(envPath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("Created .env from .env.example");
  } else {
    console.log(".env already exists, skipping copy");
  }

  // Load env vars so Prisma can find DATABASE_URL
  loadEnv(envPath);

  // 2. Start PostgreSQL
  console.log("\nStarting PostgreSQL...");
  await $`docker compose -f docker-compose.dev.yml up -d`.cwd(root);

  // Wait for Postgres to be ready
  console.log("Waiting for PostgreSQL to be ready...");
  for (let i = 0; i < 30; i++) {
    try {
      await $`docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U atrium`.cwd(root).quiet();
      break;
    } catch {
      await Bun.sleep(1000);
    }
  }

  // 3. Install dependencies
  console.log("\nInstalling dependencies...");
  await $`bun install`.cwd(root);

  // 4. Generate Prisma client
  console.log("\nGenerating Prisma client...");
  await $`bunx prisma generate`.cwd(dbDir);

  // 5. Push schema to database
  console.log("\nPushing database schema...");
  await $`bun run ./scripts/ensure-extensions.ts`.cwd(dbDir);
  await $`bunx prisma db push`.cwd(dbDir);

  // 6. Seed demo data
  console.log("\nSeeding demo data...");
  await $`bun run packages/database/src/seed.ts`.cwd(root);

  console.log("\n--- Ready! Run: bun run dev ---");
}

run().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
