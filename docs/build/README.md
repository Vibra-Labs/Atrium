# Pexlo Portal — Build Documentation

> Every infrastructure/product build gets a build doc in the same session it's built.
> See `AGENTS.md` for the mandatory rule and standard sections.

## Index

| # | Doc | Status | Linear |
|---|---|---|---|
| 00 | [Architecture Overview](./00-architecture-overview.md) | ✅ Current | — |
| 01 | [Schema Foundation](./01-schema-foundation.md) | ✅ Current | [PXL-4](https://linear.app/mastermind365/issue/PXL-4/audit-existing-pexlo-portal-projecttask-schema-identify-gaps), [PXL-5](https://linear.app/mastermind365/issue/PXL-5/build-pexlo-portal-ai-agent-tool-service-account-api) |
| 02 | [Agent API Layer](./02-agent-api-layer.md) | ✅ Current | [PXL-5](https://linear.app/mastermind365/issue/PXL-5/build-pexlo-portal-ai-agent-tool-service-account-api) |
| 03 | Client Portal View | 📋 Backlog | PXL-6 |
| 04 | CSP Backfill | 📋 Backlog | PXL-7 |
| 05 | [Test Database Isolation](./05-test-isolation.md) | ✅ Current | [PXL-17](https://linear.app/mastermind365/issue/PXL-17) |
| 06 | [Docker Entrypoint Safety](./06-docker-entrypoint-safety.md) | ✅ Current | [PXL-18](https://linear.app/mastermind365/issue/PXL-18) |
| 07 | [Agent Comments, Updates, Notes](./07-agent-comments-updates-notes.md) | ✅ Current | [PXL-19](https://linear.app/mastermind365/issue/PXL-19) |
| 08 | [WorkOS Auth Migration](./08-workos-auth.md) | 🚧 Phase 3 linked | PXL-20 |
| 10 | [Time Tracking — Session Journal](./time-tracking/01-session-journal.md) | ✅ Current | — |
| 99 | Operational Runbook | 📋 Backlog | — |

## Linear Project

https://linear.app/mastermind365/project/pexlo-portal-ai-agent-projecttask-layer-c4a2bf078e60

## How to Read These Docs

Each build doc follows the same shape:

1. **What** — one-sentence summary
2. **Why** — business/technical motivation and decision context
3. **Considered & Rejected** — road-not-taken notes; usually the most useful section later
4. **What We Built** — concrete files, models, endpoints, migrations, and behavior
5. **How to Extend** — the blueprint for the next person touching it
6. **Verification** — actual proof it works: commands, SQL, counts, screenshots, or links
7. **Known Gaps / Deferred** — honest list of what was punted
8. **References** — Linear issues, research docs, commits, and audit files

## Current Build Sequence

The first three docs establish the foundation for the Pexlo Portal AI-agent project/task layer:

- `00-architecture-overview.md` explains the system: what already existed from Atrium, what Pexlo is adding, and which operating principles apply to future work.
- `01-schema-foundation.md` records the PXL-4 audit and PXL-5a schema migration/drift fix: what was missing, why the migration had to be baselined, and how to safely extend the database without creating fresh drift.
- `02-agent-api-layer.md` records the PXL-5b API layer: API-key auth, scoped agent endpoints, idempotent writes, audit events, tests, and the manual key-creation CLI.
- `05-test-isolation.md` records the PXL-17 safety fix: long-lived Neon `test` branch, preflight guards, direct `bun test` preload guard, reset script, and production-data verification.
- `06-docker-entrypoint-safety.md` records the PXL-18 deploy safety fix: no `prisma db push`, migration-only startup, and rollback image discipline.
- `07-agent-comments-updates-notes.md` records the PXL-19 restored agent backend surface for comments, project updates, and notes.
- `08-workos-auth.md` records the PXL-20 WorkOS/AuthKit migration state and the Phase 3 Chris/Pexlo Internal user-org linkage.
- `time-tracking/01-session-journal.md` records the Session Journal build: timer-bound notes/task completions, pending no-timer captures, and resolution into billable time entries.

Do not close future PXL implementation issues as Done until the relevant build doc is created or updated in this directory and committed with the code.
