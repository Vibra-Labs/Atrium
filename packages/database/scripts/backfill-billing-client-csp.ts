/**
 * One-time backfill for Billing System v1 PR 1.
 *
 * Creates the CSP billing client in the Pexlo organization and links the three
 * existing CSP projects to it. Idempotent and transactional.
 *
 * SAFETY: This script is intentionally write-guarded. It will not mutate data
 * unless EXECUTE_BILLING_CSP_BACKFILL=1 is set.
 *
 * Usage after Omni review:
 *   EXECUTE_BILLING_CSP_BACKFILL=1 DATABASE_URL="..." bun run packages/database/scripts/backfill-billing-client-csp.ts
 */

import { PrismaClient } from "@prisma/client";

const PEXLO_ORG_ID = "70483073F84A4BFBBFE35B04";
const CSP_CLIENT_NAME = "CSP";
const CSP_CLIENT_SLUG = "csp";

const CSP_PROJECTS = [
  {
    id: "cmpr571tx003mxamcvrlwxy3o",
    name: "Pexlo R&D Tax Credit Briefing for CSP — Briefing No. 001",
  },
  {
    id: "cmpr5718s002vxamceml5h4yu",
    name: "CSP Internal Operations Platform — Phase 0 Discovery",
  },
  {
    id: "cmpr56yzc0000xamc73anntuo",
    name: "CSP IT Onboarding — May 2026",
  },
] as const;

async function main(): Promise<void> {
  if (process.env.EXECUTE_BILLING_CSP_BACKFILL !== "1") {
    console.log("DRY RUN ONLY — no writes performed.");
    console.log("Set EXECUTE_BILLING_CSP_BACKFILL=1 after review to apply this backfill.");
    console.log(`Would create/find BillingClient ${CSP_CLIENT_NAME} (${CSP_CLIENT_SLUG}) in org ${PEXLO_ORG_ID}.`);
    console.log(`Would link ${CSP_PROJECTS.length} CSP project(s):`);
    for (const project of CSP_PROJECTS) {
      console.log(`- ${project.id} — ${project.name}`);
    }
    return;
  }

  const prisma = new PrismaClient();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: PEXLO_ORG_ID },
        select: { id: true, name: true },
      });

      if (!organization) {
        throw new Error(`Organization ${PEXLO_ORG_ID} not found.`);
      }

      const existingClients = await tx.billingClient.findMany({
        where: {
          organizationId: PEXLO_ORG_ID,
          OR: [{ slug: CSP_CLIENT_SLUG }, { name: CSP_CLIENT_NAME }],
        },
        select: { id: true, name: true, slug: true },
      });

      const uniqueClientIds = new Set(existingClients.map((client) => client.id));
      if (uniqueClientIds.size > 1) {
        throw new Error(
          `Refusing to backfill: found multiple CSP-like billing clients in org ${PEXLO_ORG_ID}: ${JSON.stringify(existingClients)}`,
        );
      }

      const billingClient =
        existingClients[0] ??
        (await tx.billingClient.create({
          data: {
            organizationId: PEXLO_ORG_ID,
            name: CSP_CLIENT_NAME,
            slug: CSP_CLIENT_SLUG,
            defaultHourlyRateCents: null,
            billingPeriod: null,
            billingNotes: null,
            externalReference: null,
          },
          select: { id: true, name: true, slug: true },
        }));

      const expectedIds = CSP_PROJECTS.map((project) => project.id);
      const projects = await tx.project.findMany({
        where: { id: { in: expectedIds }, organizationId: PEXLO_ORG_ID },
        select: { id: true, name: true, billingClientId: true },
      });

      const foundIds = new Set(projects.map((project) => project.id));
      const missing = CSP_PROJECTS.filter((project) => !foundIds.has(project.id));
      if (missing.length > 0) {
        throw new Error(`Refusing to backfill: missing expected CSP project(s): ${JSON.stringify(missing)}`);
      }

      const nameMismatches = CSP_PROJECTS.flatMap((expected) => {
        const actual = projects.find((project) => project.id === expected.id);
        return actual && actual.name !== expected.name ? [{ expected, actual }] : [];
      });
      if (nameMismatches.length > 0) {
        throw new Error(`Refusing to backfill: project name mismatch(es): ${JSON.stringify(nameMismatches)}`);
      }

      const conflictingAssignments = projects.filter(
        (project) => project.billingClientId && project.billingClientId !== billingClient.id,
      );
      if (conflictingAssignments.length > 0) {
        throw new Error(
          `Refusing to backfill: project(s) already assigned to another billing client: ${JSON.stringify(conflictingAssignments)}`,
        );
      }

      const updated = await tx.project.updateMany({
        where: {
          id: { in: expectedIds },
          organizationId: PEXLO_ORG_ID,
          billingClientId: null,
        },
        data: { billingClientId: billingClient.id },
      });

      return {
        organization,
        billingClient,
        projectsFound: projects.length,
        projectsUpdated: updated.count,
      };
    });

    console.log("Backfill completed:", result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Billing CSP backfill failed:", err);
  process.exit(1);
});
