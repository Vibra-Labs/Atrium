# Atrium -- Claude Code Context

## Project Overview

Atrium is a self-hosted client portal for agencies/freelancers. Monorepo with Turborepo + Bun.

## Architecture

```
apps/api/       NestJS 11 REST API (port 3001)
apps/web/       Next.js 15 + React 19 frontend (port 3000)
packages/database/  Prisma ORM schema, client, seed
packages/shared/    Shared types and constants
packages/email/     React Email templates (compiled to CJS)
e2e/            Playwright end-to-end tests
docker/         Production Dockerfiles + entrypoint
```

## Commands

```bash
bun run dev             # Start dev (Postgres + API + Web)
bun run build           # Build all packages and apps
bun run test            # Unit tests (Bun test runner)
bun run test:e2e        # Playwright e2e tests
bun run test:all        # Unit + e2e
bun run db:generate     # Regenerate Prisma client
bun run db:push         # Push schema to database
bun run db:seed         # Seed demo data
```

## Development Workflow

`bun run dev` runs `scripts/dev.ts` which:
1. Starts Postgres via `docker-compose.dev.yml`
2. Generates Prisma client + pushes schema
3. Runs `turbo dev` (builds workspace deps first via `^build`, then starts API + Web)

The API uses `nest start --watch` for hot reload. The web app uses Next.js dev server.

## API Structure (apps/api)

- **Auth**: `auth/` -- Better Auth proxy controller, session middleware
- **Projects**: `projects/` -- CRUD, status management
- **Files**: `files/` -- Upload/download, storage provider abstraction (local/S3/MinIO/R2)
- **Branding**: `branding/` -- Org customization (colors, logo)
- **Clients**: `clients/` -- Member management, invitations
- **Updates**: `updates/` -- Project progress updates with image attachments
- **Onboarding**: `onboarding/` -- Signup endpoint
- **Mail**: `mail/` -- Resend integration with React Email templates
- **Health**: `health.controller.ts` -- DB connectivity check

Global middleware/guards applied in `app.module.ts` and `main.ts`:
- `AuthGuard` + `RolesGuard` on all routes (bypass with `@Public()`)
- `ThrottlerGuard` (100 req/min)
- `ValidationPipe` (whitelist + forbidNonWhitelisted)
- `AllExceptionsFilter` (hides stack traces)
- Helmet CSP + CORS (single origin)

## Web App Structure (apps/web)

Next.js App Router with route groups:
- `(auth)/` -- `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite`
- `(dashboard)/` -- `/dashboard`, `/dashboard/projects`, `/dashboard/projects/[id]`, `/dashboard/clients`, `/dashboard/settings/{account,workspace,payments}`
- `(portal)/` -- `/portal`, `/portal/projects`, `/portal/projects/[id]`

## Database (packages/database)

PostgreSQL 16 via Prisma. Key models:
- `User`, `Session`, `Account`, `Organization`, `Member`, `Invitation` (Better Auth)
- `Project`, `ProjectClient`, `File`, `ProjectUpdate`, `Branding`, `ProjectStatus` (app)

Schema: `packages/database/prisma/schema.prisma`

## Email Package (packages/email)

React Email templates compiled to CommonJS (`module: "commonjs"` in tsconfig). The `main` field points to `dist/index.js` -- the package must be built before the API can start. Turbo handles this via `"dev": { "dependsOn": ["^build"] }`.

## Environment

Required env vars (API refuses to start without them):
- `DATABASE_URL` -- Postgres connection string
- `BETTER_AUTH_SECRET` -- Auth token signing key (min 32 chars)

See `.env.example` for all variables.

## Testing

- **Unit tests**: `apps/api/src/**/*.spec.ts` using Bun's test runner
- **E2E tests**: `e2e/tests/*.e2e.ts` using Playwright
- E2E global setup (`e2e/global-setup.ts`) creates a unique test account per run
- Playwright auto-starts servers when not already running

## Docker

- `docker-compose.dev.yml` -- Postgres only (for local dev)
- `docker-compose.yml` -- Full production stack (Postgres + API + Web)
- Both Dockerfiles use `oven/bun:1`, multi-stage builds, non-root `bun` user, `NODE_ENV=production`
- API entrypoint runs `prisma db push` before starting
- DB credentials and URLs are parameterized with defaults

## Feature Development Rules

- **Every new feature must include Playwright e2e tests.** When adding new pages, API endpoints, or user-facing functionality, always create corresponding tests in `e2e/tests/`. Follow the patterns in existing test files (auth, projects, portal, etc.). This is not optional — no feature is complete without e2e coverage.

## Key Patterns

- Workspace packages referenced via `workspace:*` in package.json
- Auth uses Better Auth with NestJS proxy pattern (Express req -> Web API Request -> Better Auth -> Express res)
- Storage is abstracted behind `StorageProvider` interface with DI token `STORAGE_PROVIDER`
- Roles: `owner`, `admin`, `member` -- enforced via `@Roles()` decorator + `RolesGuard`
- Public endpoints use `@Public()` decorator to bypass auth
- Rate limiting skipped on health check via `@SkipThrottle()`

## Git

- Never add `Co-Authored-By` lines to commit messages. All commits should show only the user as author.
- **Releases mean tagging, not PRs.** When asked to "create a release", create a git tag on `main` (e.g. `git tag v1.4.3 && git push origin v1.4.3`). Do not open a PR for a release. PRs are for feature branches merging into main.
