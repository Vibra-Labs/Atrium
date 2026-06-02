#!/usr/bin/env python3
"""Backfill City Safe Partners May 2026 work via the Pexlo Portal agent API.

Idempotency pattern:
- projects/tasks use externalId and are upsert-like through the agent API.
- task status patches and deliverables are only written when the task was just created.
  A successful second run therefore writes zero audit events.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = os.environ.get("PEXLO_AGENT_BASE", "http://localhost:3001")
KEYCHAIN_SERVICE = "pexlo-portal-api-crank"
KEYCHAIN_ACCOUNT = "chris@dwelbase.io"

WS = "/Users/bizman247/.openclaw/workspace"
CITYSAFE = f"{WS}/clients/citysafe/2026-05-25"

PROJECTS: list[dict[str, Any]] = [
    {
        "name": "CSP IT Onboarding — May 2026",
        "slug": "csp-it-onboarding-may-2026",
        "externalId": "csp-it-onboarding-may-2026",
        "description": (
            "Backfill of City Safe Partners Microsoft 365, Entra, Intune, Autopilot, tenant-audit, "
            "device-enrollment, BitLocker, RMM-evaluation, and app-packaging work completed May 25–28, 2026. "
            "Original work dates are preserved in each task description; createdAt reflects the backfill date. "
            "Source logs: memory/2026-05-25.md, 2026-05-26.md, 2026-05-28.md. clientId intentionally unset: "
            "no City Safe Partners user/member record exists in the Pexlo organization yet."
        ),
        "tasks": [
            {
                "title": "Full Microsoft Graph tenant audit + baseline health score",
                "externalId": "csp-m365-tenant-audit-2026-05-25",
                "description": (
                    "Original date: 2026-05-25. Pulled a full Microsoft Graph snapshot for citysafepartners.com "
                    "(tenant f56897a0-e048-46fb-97c1-7c7e5111bd9d): 69 users, 44 groups, 43 Entra devices, "
                    "27 Intune-managed devices, 10 license SKUs, 4 config profiles, 1 compliance policy, 46 MFA records, "
                    "11 active admin roles, 5 Global Admins, 0 Conditional Access policies, Secure Score 550.2/1132 (48.6%). "
                    "Produced technical and executive audit deliverables with top risks: no CA policies, excess Global Admins, "
                    "and 59% unencrypted devices. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "CitySafe tenant audit — technical deep dive", "type": "pdf", "url": f"{CITYSAFE}/citysafe-tenant-audit-before.pdf"},
                    {"title": "CitySafe tenant health scorecard", "type": "pdf", "url": f"{CITYSAFE}/citysafe-tenant-health-score.pdf"},
                    {"title": "Raw tenant snapshot JSON folder", "type": "folder", "url": f"{WS}/csp-tenant-snapshot-before/"},
                    {"title": "Tenant snapshot PowerShell script", "type": "script", "url": f"{WS}/csp-tenant-snapshot.ps1"},
                ],
            },
            {
                "title": "Entra/Intune cleanup strategy + field execution kit",
                "externalId": "csp-entra-intune-cleanup-kit-2026-05-25",
                "description": (
                    "Original date: 2026-05-25. Built client-facing and technician-facing remediation documents after discovery "
                    "showed 27 M365 admin devices, 43 Entra devices, 27 Intune-managed devices, and 15/27 Intune devices "
                    "showing Jordon West as primary user instead of the actual end user. The package covered cleanup strategy, "
                    "on-site device tracker, LAPS prep, communications templates, and OneDrive audit prep. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "Entra cleanup plan", "type": "pdf", "url": f"{CITYSAFE}/citysafe-entra-cleanup-plan.pdf"},
                    {"title": "Entra field kit", "type": "pdf", "url": f"{CITYSAFE}/citysafe-entra-field-kit.pdf"},
                    {"title": "Entra bonus pack", "type": "pdf", "url": f"{CITYSAFE}/citysafe-entra-bonus-pack.pdf"},
                ],
            },
            {
                "title": "HP 8CG1108HR6 Autopilot infrastructure and enrollment repair",
                "externalId": "csp-hp-8cg1108hr6-autopilot-2026-05-25",
                "description": (
                    "Original dates: 2026-05-25 to 2026-05-26. Registered HP Pavilion x360 serial 8CG1108HR6 in Autopilot, "
                    "fixed the Get-WindowsAutopilotInfo CSV encoding issue by producing ANSI/CRLF hardware hash CSV, created the "
                    "CSP Autopilot Laptops dynamic device group and CSP User Driven Laptops deployment profile, assigned HP group tag "
                    "Laptop, created IT-Validate@citysafepartners.com for enrollment testing, diagnosed MDM user license error "
                    "-2145910760, and resolved it by assigning Chris Microsoft 365 Business Premium. May 26 follow-up: primary-user "
                    "assignment and full reset behavior reviewed; bulk naming convention agreed as CSP-{TYPE}-####. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "CitySafe Autopilot setup spec", "type": "markdown", "url": f"{CITYSAFE}/citysafe-autopilot-setup.md"},
                    {"title": "HP Autopilot hardware hash CSV", "type": "csv", "url": f"{CITYSAFE}/csp-hp-laptop-autopilot-hash.csv"},
                ],
            },
            {
                "title": "CSP device naming convention decision",
                "externalId": "csp-device-naming-convention-2026-05-26",
                "description": (
                    "Original date: 2026-05-26. Locked the device naming convention as CSP-{TYPE}-#### with type prefixes "
                    "LT, DT, DP, FD, SV, and KS. Bulk rename script was left as TODO. This was captured as part of the tenant cleanup "
                    "and Autopilot standardization work. Time estimate: not recorded."
                ),
                "deliverables": [],
            },
            {
                "title": "SyncroMSP RMM installer link captured for CSP evaluation",
                "externalId": "csp-syncromsp-rmm-link-2026-05-26",
                "description": (
                    "Original date: 2026-05-26. Captured Chris's SyncroMSP RMM download link for possible CSP/Pexlo RMM agent evaluation. "
                    "Memory note says this may replace or compete with the earlier NinjaOne plan and needs confirmation before rollout. "
                    "Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "SyncroMSP RMM download link", "type": "link", "url": "https://rmm.syncromsp.com/dl/rs/djEtMzU4NzUzMzMtMTgxNTYxNDYwMi03OTk2Ny01MDEyNDk0"},
                ],
            },
            {
                "title": "Lenovo PF4TJXBM Autopilot enrollment + dynamic group fix",
                "externalId": "csp-lenovo-pf4tjxbm-autopilot-2026-05-28",
                "description": (
                    "Original date: 2026-05-28. Diagnosed Lenovo CSP-PF4TJXBM (serial PF4TJXBM, Jordon West primary user, corporate, "
                    "Entra-joined, Intune-enrolled, compliant) landing in inherited Entra to Autotune group but not CSP Autopilot Laptops. "
                    "Root cause: group rule expected [OrderID]:Laptop while Chris's convention was CSP Laptop. Updated dynamic membership rule "
                    "to [OrderID]:CSP , renamed group CSP Autopilot Laptops → CSP Autopilot Devices, added description, and locked a unified "
                    "CSP group-tag convention (CSP Laptop/Desktop/Kiosk/Lab). Time estimate: not recorded."
                ),
                "deliverables": [],
            },
            {
                "title": "Lenovo PF4TJXBM policy and BitLocker verification",
                "externalId": "csp-lenovo-pf4tjxbm-policy-bitlocker-2026-05-28",
                "description": (
                    "Original date: 2026-05-28. Verified CSP-PF4TJXBM landed in CSP Autopilot Devices and all listed device configuration "
                    "policies reported Succeeded: Block Store, Default EDR, Endpoint Protection, Update policy, Windows 10 Policy, and "
                    "Windows OneDrive Settings Catalog. BitLocker pre-encryption prompt triggered, Chris confirmed Yes, and drive began encrypting. "
                    "Known gap from source log: primary user still showed None in Intune and should be assigned to Jordon West later. Time estimate: not recorded."
                ),
                "deliverables": [],
            },
            {
                "title": "Nitro PDF Pro 14 Intune Win32 deployment package build",
                "externalId": "csp-nitro-pdf-pro-14-intune-package-2026-05-28",
                "description": (
                    "Original date: 2026-05-28. Built Nitro PDF Pro 14.43.6.0 deployment package for CSP devices. Downloaded 413MB MSI, "
                    "wrapped it with IntuneWinAppUtil into a 407MB .intunewin package on Lenovo, archived MSI/tool/package in R2, captured product "
                    "code {57DCD858-C04D-4569-B362-49DEE87D6CBE}, install/uninstall commands, registry detection rule, test-assignment plan, "
                    "and rollout strategy. Status from source log: package built and archived; Intune Win32 app not yet created; test Lenovo first because "
                    "reseller license activation risk exists. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "Mac Pro Nitro MSI path", "type": "file", "url": "/Users/bizman247/Projects/intune-packages/nitro-pro-14/source/nitro_pro14_x64.msi"},
                    {"title": "Mac Pro Nitro .intunewin path", "type": "file", "url": "/Users/bizman247/Projects/intune-packages/nitro-pro-14/output/nitro_pro14_x64.intunewin"},
                    {"title": "R2 Intune staging path", "type": "r2", "url": "s3://assets/intune-staging/"},
                ],
            },
        ],
    },
    {
        "name": "CSP Internal Operations Platform — Phase 0 Discovery",
        "slug": "csp-internal-ops-phase-0-discovery",
        "externalId": "csp-internal-ops-phase-0-discovery",
        "description": (
            "Backfill of CSP-adjacent platform planning captured in the May 25–28 logs: portal readiness, CSP onboarding planning, "
            "and accounting/procurement decision support. Guard scheduling/body-camera platform details were intentionally not expanded here "
            "because the assigned source logs for May 25–28 did not contain new discrete implementation work for those areas. clientId unset "
            "until a City Safe Partners portal member exists."
        ),
        "tasks": [
            {
                "title": "Pexlo Portal production launch with CSP onboarding queued for Phase 2",
                "externalId": "csp-portal-onboarding-phase2-planning-2026-05-26",
                "description": (
                    "Original date: 2026-05-26. Shipped portal.pexlo.com production infrastructure (Hetzner CPX21, Neon, R2, Resend, SSL, "
                    "signup lockdown, invite flow, owner/member validation) and captured Phase 2 items that directly support CSP onboarding: "
                    "create City Safe Partners as organization #2, invite Soyini as CSP member, create first test project 'CitySafe Internal Ops Platform', "
                    "connect Toggl Track API, and wire Stripe invoices. Pexlo Portal build duration recorded in log: 90 minutes for initial build; "
                    "CSP-specific follow-on estimate not recorded."
                ),
                "deliverables": [
                    {"title": "Live Pexlo Portal", "type": "link", "url": "https://portal.pexlo.com"},
                ],
            },
            {
                "title": "CitySafe accounting platform comparison reviewed",
                "externalId": "csp-accounting-comparison-2026-05-26",
                "description": (
                    "Original date: 2026-05-26. Reviewed CitySafe accounting comparison PDF covering Digits vs Puzzle vs Sage Intacct; "
                    "purchase-order requirement pushed value toward Sage Intacct. This was decision support for CSP operations tooling, not an implementation. "
                    "Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "CitySafe accounting comparison PDF", "type": "pdf", "url": f"{WS}/citysafe-accounting-comparison.pdf"},
                    {"title": "CitySafe accounting comparison HTML", "type": "html", "url": f"{WS}/citysafe-accounting-comparison.html"},
                ],
            },
        ],
    },
    {
        "name": "Pexlo R&D Tax Credit Briefing for CSP — Briefing No. 001",
        "slug": "pexlo-rd-tax-credit-briefing-csp-001",
        "externalId": "pexlo-rd-tax-credit-briefing-csp-001",
        "description": (
            "Backfill of R&D tax-credit research and briefing materials connected to CSP/CitySafe software and AI development. "
            "This includes the May 25 CitySafe one-pager and the May 29 Pexlo briefing/template/PDF iterations. Created for invoice substantiation, "
            "audit trail, and tax-credit evidence; not tax/legal advice. clientId unset until CSP has a portal user."
        ),
        "tasks": [
            {
                "title": "CitySafe §174A / §41 R&D credit one-pager",
                "externalId": "citysafe-rd-tax-credit-onepager-2026-05-25",
                "description": (
                    "Original date: 2026-05-25. Built CPA reference one-pager for CitySafe software development R&D tax-credit treatment, "
                    "covering §174A retroactive election mechanics, §41 qualification, documentation, and IRS audit defense. Source log estimates "
                    "$8K–$11K federal tax benefit on a $33K CitySafe platform project. A broader proposal addendum was built and deleted per Chris's "
                    "decision to keep only the one-pager. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "CitySafe R&D tax credit one-pager PDF", "type": "pdf", "url": f"{CITYSAFE}/citysafe-rd-tax-credit-onepager.pdf"},
                    {"title": "CitySafe R&D tax credit one-pager HTML", "type": "html", "url": f"{CITYSAFE}/citysafe-rd-tax-credit-onepager.html"},
                ],
            },
            {
                "title": "Federal, NYS, and NYC R&D credit research memo",
                "externalId": "csp-rd-credit-research-memo-2026-05-29",
                "description": (
                    "Original date: 2026-05-29. Researched federal §41 R&D credit, §174A domestic R&D expensing restored by OBBBA, QSB payroll-tax "
                    "offset path, non-QSB income-tax-credit path, and New York incentives including Excelsior, Life Sciences R&D, R&D property ITC, and QETC. "
                    "Research was written for small/mid-market businesses including NY-based security/software/AI operations. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "R&D tax credit research notes", "type": "markdown", "url": f"{WS}/memory/research/rd-tax-credit-program-2026-05-29.md"},
                ],
            },
            {
                "title": "Pexlo R&D briefing template and PDF design iterations",
                "externalId": "csp-rd-credit-briefing-template-iterations-2026-05-29",
                "description": (
                    "Original date: 2026-05-29. Produced Pexlo-branded R&D Tax Credit Program Overview briefing HTML/PDF and iterated through "
                    "PDF v1–v4 plus page screenshots. Final v4 presents §41 + §174A program overview with credit mechanics, qualification tests, "
                    "QSB vs non-QSB path, NY incentives, documentation standards, and Pexlo/CSP positioning. Time estimate: not recorded."
                ),
                "deliverables": [
                    {"title": "R&D Credit Briefing source HTML", "type": "html", "url": f"{WS}/csp-rd-credit-program-overview.html"},
                    {"title": "R&D Credit Briefing PDF v1", "type": "pdf", "url": f"{WS}/csp-rd-credit-program-overview.pdf"},
                    {"title": "R&D Credit Briefing PDF v2", "type": "pdf", "url": f"{WS}/csp-rd-credit-program-overview-v2.pdf"},
                    {"title": "R&D Credit Briefing PDF v3", "type": "pdf", "url": f"{WS}/csp-rd-credit-program-overview-v3.pdf"},
                    {"title": "R&D Credit Briefing PDF v4", "type": "pdf", "url": f"{WS}/csp-rd-credit-program-overview-v4.pdf"},
                    {"title": "R&D Credit Briefing PDF v4 text extract", "type": "text", "url": f"{WS}/csp-rd-credit-program-overview-v4.txt"},
                    {"title": "R&D Credit Briefing v4 page 1 screenshot", "type": "image", "url": f"{WS}/csp-rd-credit-program-overview-v4-page-1.png"},
                    {"title": "R&D Credit Briefing v4 page 2 screenshot", "type": "image", "url": f"{WS}/csp-rd-credit-program-overview-v4-page-2.png"},
                ],
            },
        ],
    },
]


def get_key() -> str:
    env_key = os.environ.get("PEXLO_AGENT_KEY")
    if env_key:
        return env_key
    return subprocess.check_output([
        "security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"
    ], text=True).strip()


def api(method: str, path: str, payload: dict[str, Any] | None = None, key: str | None = None) -> dict[str, Any]:
    data = None
    headers = {"Authorization": f"Bearer {key or KEY}", "Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {path} failed HTTP {e.code}: {body}") from e


def count_audit_since(since: str) -> int:
    qs = urllib.parse.urlencode({"since": since, "limit": 500})
    res = api("GET", f"/api/agent/audit?{qs}")
    return len(res["data"]["items"])


def list_project_by_slug(slug: str) -> dict[str, Any] | None:
    qs = urllib.parse.urlencode({"slug": slug, "limit": 1})
    items = api("GET", f"/api/agent/projects?{qs}")["data"]["items"]
    return items[0] if items else None


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    summary: dict[str, Any] = {
        "baseUrl": BASE,
        "startedAt": started_at,
        "projects": [],
        "tasks": [],
        "deliverables": [],
        "createdAuditEvents": 0,
        "newProjectCount": 0,
        "newTaskCount": 0,
        "newDeliverableCount": 0,
        "taskStatusPatchCount": 0,
    }

    # quick auth/read check
    api("GET", "/api/agent/projects?limit=1")

    for project_def in PROJECTS:
        project_payload = {
            "name": project_def["name"],
            "description": project_def["description"],
            "status": "complete",
            "externalId": project_def["externalId"],
            "slug": project_def["slug"],
        }
        project_res = api("POST", "/api/agent/projects", project_payload)
        project = project_res["data"]
        project_created = bool(project_res.get("meta", {}).get("auditEventId"))
        if project_created:
            summary["newProjectCount"] += 1
        project_id = project["id"]
        summary["projects"].append({"id": project_id, "name": project["name"], "externalId": project["externalId"], "created": project_created})

        for task_def in project_def["tasks"]:
            task_payload = {
                "projectId": project_id,
                "title": task_def["title"],
                "description": task_def["description"],
                "externalId": task_def["externalId"],
                "clientVisible": True,
            }
            task_res = api("POST", "/api/agent/tasks", task_payload)
            task = task_res["data"]
            task_created = bool(task_res.get("meta", {}).get("auditEventId"))
            if task_created:
                summary["newTaskCount"] += 1
                # Only patch newly-created tasks. This preserves second-run zero-audit idempotency.
                patched = api("PATCH", f"/api/agent/tasks/{task['id']}", {"status": "done"})
                summary["taskStatusPatchCount"] += 1
                task = patched["data"]
                for deliverable_def in task_def.get("deliverables", []):
                    deliverable_res = api("POST", f"/api/agent/tasks/{task['id']}/deliverables", deliverable_def)
                    deliverable = deliverable_res["data"]
                    summary["newDeliverableCount"] += 1
                    summary["deliverables"].append({"id": deliverable["id"], "taskId": task["id"], "title": deliverable["title"], "type": deliverable["type"]})
            summary["tasks"].append({"id": task["id"], "title": task["title"], "externalId": task["externalId"], "created": task_created, "status": task.get("status")})

    summary["createdAuditEvents"] = count_audit_since(started_at)
    # Fetch project details with task summaries for verification.
    summary["projectDetails"] = []
    for project in summary["projects"]:
      detail = api("GET", f"/api/agent/projects/{project['id']}")["data"]
      summary["projectDetails"].append({"id": detail["id"], "name": detail["name"], "taskSummary": detail.get("taskSummary", {})})

    out_path = Path("docs/build/csp-backfill-summary.json")
    out_path.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    KEY = get_key()
    raise SystemExit(main())
