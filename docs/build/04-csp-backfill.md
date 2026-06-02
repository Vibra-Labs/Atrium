# 04 — CSP Work History Backfill

## 1. What

City Safe Partners May 2026 work history was captured in Pexlo Portal as agent-created projects, tasks, deliverables, and audit events.

## 2. Why

The backfill gives Chris a client-readable project ledger for CSP/CitySafe work that can support:

- Soyini invoice substantiation: what was done, when it originally happened, and what artifacts were produced.
- Pexlo Portal validation: this was the first real write-through test of the new `/api/agent/*` layer.
- R&D tax-credit evidence: technical uncertainty, software/AI/platform work, M365/Intune engineering work, and briefing artifacts are preserved with source dates.
- Future operations: the portal now has a pattern for converting raw memory logs into structured projects/tasks without direct SQL inserts.

`clientId` is intentionally unset because the Pexlo organization currently has only Chris and Omni as members; there is no CSP/Soyini portal user record yet.

## 3. Considered & Rejected

- **Manual SQL inserts** — rejected. They would bypass the agent API and skip the audit trail, which was the point of PXL-7.
- **Modifying the schema to add original-date overrides** — rejected for this pass. The original dates are preserved in task descriptions; `createdAt` honestly represents the backfill date.
- **Backdating `createdAt` / `completedAt`** — rejected. Audit evidence should show when the records were created in the portal, not pretend the portal existed on May 25.
- **Fabricating broader GuardScribe/body-camera/scheduling tasks from memory** — rejected. The assigned source logs for May 25–28 did not contain new discrete implementation work for those items, so the Phase 0 project only includes portal/onboarding/accounting items actually present in those logs.
- **Deliverable idempotency by direct DB lookup/write** — rejected. The deliverable API does not have `externalId`; the script only creates deliverables when its parent task is newly created, so a successful second run writes zero new events.

## 4. What We Built

### Files committed

- `scripts/backfill/csp-may-2026-agent-backfill.py` — idempotent backfill runner using the agent API and Crank API key from macOS Keychain.
- `docs/build/04-csp-backfill.md` — this build doc.
- `docs/build/csp-backfill-summary.json` — verification summary from the first and second runs.
- `docs/build/README.md` — index updated from backlog to current.

### API base URL used

`http://localhost:3001`

Production `https://portal.pexlo.com` was checked first and returned `404` for `/api/agent/projects`, so the API was run locally against the configured Pexlo Portal database.

### Projects created

| Project | ID | Tasks |
|---|---:|---:|
| CSP IT Onboarding — May 2026 | `cmpr56yzc0000xamc73anntuo` | 8 done |
| CSP Internal Operations Platform — Phase 0 Discovery | `cmpr5718s002vxamceml5h4yu` | 2 done |
| Pexlo R&D Tax Credit Briefing for CSP — Briefing No. 001 | `cmpr571tx003mxamcvrlwxy3o` | 3 done |

### Tasks created

13 tasks were created and patched to `done`:

1. Full Microsoft Graph tenant audit + baseline health score — `cmpr56z5r0004xamcdatvm8xm`
2. Entra/Intune cleanup strategy + field execution kit — `cmpr56zmh000qxamcadabhvoy`
3. HP 8CG1108HR6 Autopilot infrastructure and enrollment repair — `cmpr56zyw0018xamcbpfciz4r`
4. CSP device naming convention decision — `cmpr5708x001mxamckohxjhul`
5. SyncroMSP RMM installer link captured for CSP evaluation — `cmpr570eb001sxamcgkrcgt3q`
6. Lenovo PF4TJXBM Autopilot enrollment + dynamic group fix — `cmpr570lo0022xamcljn485cf`
7. Lenovo PF4TJXBM policy and BitLocker verification — `cmpr570rd0028xamcju4zk7c1`
8. Nitro PDF Pro 14 Intune Win32 deployment package build — `cmpr570wy002examca10wbqx7`
9. Pexlo Portal production launch with CSP onboarding queued for Phase 2 — `cmpr571cl002zxamcuioppwb9`
10. CitySafe accounting platform comparison reviewed — `cmpr571kk0039xamc1qiexdz0`
11. CitySafe §174A / §41 R&D credit one-pager — `cmpr571xk003qxamcnwc0jct3`
12. Federal, NYS, and NYC R&D credit research memo — `cmpr5727n0044xamcjod6076t`
13. Pexlo R&D briefing template and PDF design iterations — `cmpr572fi004examcn8dk4kzj`

### Deliverables created

27 deliverables were attached to the relevant tasks. They point to local/R2 paths for now, including:

- CitySafe tenant audit PDFs and raw tenant snapshot folder.
- Entra cleanup plan, field kit, and bonus pack PDFs.
- Autopilot setup spec and HP hardware hash CSV.
- Nitro MSI / `.intunewin` local archive paths and R2 staging path.
- CitySafe accounting comparison PDF/HTML.
- CitySafe R&D tax one-pager PDF/HTML.
- May 29 R&D research memo.
- Pexlo R&D briefing HTML, PDF v1–v4, text extract, and v4 page screenshots.

## 5. How to Extend

Use the same pattern for future backfills:

1. Read the relevant memory logs and artifact folders first.
2. Define stable `externalId` values for every project and task.
3. Create projects through `POST /api/agent/projects` with a valid `ProjectStatus.slug` (`complete` in this database).
4. Create tasks through `POST /api/agent/tasks`; if newly created, patch to `done` via `PATCH /api/agent/tasks/:id`.
5. Attach deliverables only on first task creation until the API gains deliverable-level `externalId` support.
6. Run the script twice. The second run must show zero new project/task/deliverable/status/audit writes.
7. Capture counts in `docs/build/*summary*.json` and paste the numbers into the build doc.

If a CSP client portal user is later created, link new projects to that `clientId` at creation time or add a small agent update flow to attach clients after the fact.

## 6. Verification

### Health and routing

- `https://portal.pexlo.com/api/health` returned database connected.
- `https://portal.pexlo.com/api/agent/projects?limit=5` returned `404`, so the merged API was not deployed there yet.
- Local API started successfully on `http://localhost:3001` and mapped:
  - `/api/agent/projects`
  - `/api/agent/tasks`
  - `/api/agent/tasks/:id/deliverables`
  - `/api/agent/audit`

### First run

```text
newProjectCount: 3
newTaskCount: 13
newDeliverableCount: 27
taskStatusPatchCount: 13
createdAuditEvents: 56
```

Expected audit math: `3 project creates + 13 task creates + 13 task status_changed + 27 deliverable creates = 56`.

### Project detail verification

```text
CSP IT Onboarding — May 2026: { done: 8 }
CSP Internal Operations Platform — Phase 0 Discovery: { done: 2 }
Pexlo R&D Tax Credit Briefing for CSP — Briefing No. 001: { done: 3 }
```

### Audit feed verification

```text
audit_items_returned: 56
actions: { created: 43, status_changed: 13 }
entityTypes: { deliverable: 27, task: 26, project: 3 }
```

`task: 26` is expected because each of the 13 tasks has both a `created` event and a `status_changed` event.

### Idempotency test

Second run results:

```text
newProjectCount: 0
newTaskCount: 0
newDeliverableCount: 0
taskStatusPatchCount: 0
createdAuditEvents: 0
```

Result: **PASS** — successful second run wrote zero new audit events.

## 7. Known Gaps / Deferred

- `clientId` is unset because no CSP/Soyini portal member exists yet.
- Deliverables point to local paths or R2 staging paths; proper R2/public upload and portal file records are pending.
- The production portal does not yet expose the merged agent API routes; the backfill used a local API process.
- Project `completedAt` stayed `null` because the valid status slug is `complete`, while the current agent project service only auto-stamps `completedAt` for `completed` or `done`. Task `completedAt` was stamped through the `done` patch path.
- Deliverable-level idempotency depends on the script convention, not the API schema. A future improvement should add `externalId` or uniqueness to `TaskDeliverable`.

## 8. References

- Linear: PXL-7 — CSP backfill via agent API.
- Linear: PXL-5 — agent API validation follow-up.
- Source memory logs:
  - `/Users/bizman247/.openclaw/workspace/memory/2026-05-25.md`
  - `/Users/bizman247/.openclaw/workspace/memory/2026-05-26.md`
  - `/Users/bizman247/.openclaw/workspace/memory/2026-05-27.md`
  - `/Users/bizman247/.openclaw/workspace/memory/2026-05-28.md`
- R&D source docs:
  - `/Users/bizman247/.openclaw/workspace/csp-rd-credit-program-overview.html`
  - `/Users/bizman247/.openclaw/workspace/memory/research/rd-tax-credit-program-2026-05-29.md`
- Verification artifact: `docs/build/csp-backfill-summary.json`
