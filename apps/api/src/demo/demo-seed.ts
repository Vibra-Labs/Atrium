/**
 * Writes the demo workspace described by demoSeedPlan.
 *
 * Lives in the API rather than in @atrium/database because the API is its only
 * runtime consumer, and a relative re-export from that package's TypeScript
 * source cannot be resolved by Node once the API is compiled. Here it is built
 * as part of the API; the CLI wrapper and the e2e setup run under Bun, which
 * imports it from this path directly.
 *
 * Idempotent, and deliberately non-destructive about identity: the
 * Organization and User rows are upserted and never deleted, so a reset that
 * runs while someone is clicking around does not invalidate their session.
 * Everything inside the workspace is replaced.
 */
import type { PrismaClient } from "@atrium/database";
import { DEFAULT_STATUSES } from "@atrium/shared";
import { demoSeedPlan, type DemoSeedPlan, type DemoUser } from "./demo-seed-plan";

const DAY_MS = 24 * 60 * 60 * 1000;

function at(offsetDays: number): Date {
  return new Date(Date.now() + offsetDays * DAY_MS);
}

/** Stable ids so a reseed reuses the same rows rather than accumulating them. */
function userId(slug: string, key: string): string {
  return `demo-${slug}-user-${key}`;
}

function orgId(slug: string): string {
  return `demo-${slug}-org`;
}

async function clearWorkspace(prisma: PrismaClient, organizationId: string): Promise<void> {
  // Ordered by dependency. Organization and User rows are left alone on purpose,
  // so a reset that lands mid-visit does not invalidate anyone's session.
  //
  // Notification and ClientProfile carry an organizationId but no FK relation,
  // so nothing cascades them: left out, they accumulate visitor-typed text and
  // links to deleted projects forever — the opposite of what the reset is for.
  // SystemSettings is not deleted (the workspace needs one) but is reset: the
  // 2FA requirement lives there, and left on it would gate every later
  // visitor behind an enrollment screen that no reset clears.
  await prisma.systemSettings.upsert({
    where: { organizationId },
    update: { requireTwoFactor: false },
    create: { organizationId, requireTwoFactor: false },
  });
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.clientProfile.deleteMany({ where: { organizationId } });
  await prisma.timeEntry.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.document.deleteMany({ where: { organizationId } });
  await prisma.project.deleteMany({ where: { organizationId } });
  await prisma.contact.deleteMany({ where: { organizationId } });
  await prisma.company.deleteMany({ where: { organizationId } });
  await prisma.leadSource.deleteMany({ where: { organizationId } });
  await prisma.label.deleteMany({ where: { organizationId } });
  await prisma.pursuitStage.deleteMany({ where: { organizationId } });
  await prisma.pursuitPipeline.deleteMany({ where: { organizationId } });
  await prisma.projectStatus.deleteMany({ where: { organizationId } });
}

async function upsertUsers(
  prisma: PrismaClient,
  slug: string,
  organizationId: string,
  users: DemoUser[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const user of users) {
    const id: string = userId(slug, user.key);
    await prisma.user.upsert({
      where: { id },
      // twoFactorEnabled is reset explicitly: User rows survive a reset on
      // purpose (so do live sessions), so anything a visitor enabled on the
      // account would otherwise outlive the workspace it was enabled in.
      update: {
        name: user.name,
        email: user.email,
        emailVerified: true,
        twoFactorEnabled: false,
      },
      create: { id, name: user.name, email: user.email, emailVerified: true },
    });
    await prisma.twoFactor.deleteMany({ where: { userId: id } });
    await prisma.passkey.deleteMany({ where: { userId: id } });
    await prisma.member.upsert({
      where: { id: `${id}-member` },
      // The per-member preferences are reset too. The Member row itself has to
      // survive (deleting it would drop the membership and the session with
      // it), so anything a visitor changed here — a hidden dashboard card, a
      // digest toggle — would otherwise persist for everyone who came after.
      update: {
        role: user.role,
        dashboardHidden: [],
        weeklyUpdateReminders: true,
        mondayDigest: true,
      },
      create: { id: `${id}-member`, organizationId, userId: id, role: user.role },
    });
    ids.set(user.key, id);
  }
  return ids;
}

async function pinToPlan(
  prisma: PrismaClient,
  organizationId: string,
  planSlug: string,
): Promise<void> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { slug: planSlug } });
  if (!plan) {
    throw new Error(
      `The demo needs the "${planSlug}" plan. Run the main seed first (bun run db:seed).`,
    );
  }
  // No trial fields: a trial would expire and quietly cripple the demo.
  await prisma.subscription.upsert({
    where: { organizationId },
    update: { planId: plan.id, status: "active", trialEndedAt: null },
    create: { organizationId, planId: plan.id, status: "active" },
  });
}

export async function seedDemo(
  prisma: PrismaClient,
  slug: string,
  options: { ownerEmail?: string; clientEmail?: string } = {},
): Promise<{ organizationId: string }> {
  const plan: DemoSeedPlan = demoSeedPlan(
    slug,
    options.ownerEmail ?? "owner@demo.invalid",
    options.clientEmail ?? "client@demo.invalid",
  );

  // Keyed on the stable id, not the slug. A slug that drifted (a rename, a
  // half-finished seed) would make a slug-keyed upsert miss and take the
  // create branch with an id the existing row still holds — a unique
  // violation that breaks every reset from then on. Upserting by id instead
  // puts the slug back where it belongs.
  const organization = await prisma.organization.upsert({
    where: { id: orgId(slug) },
    update: { name: plan.organization.name, slug, setupCompleted: true },
    create: {
      id: orgId(slug),
      name: plan.organization.name,
      slug,
      setupCompleted: true,
    },
    select: { id: true },
  });
  const organizationId: string = organization.id;

  await clearWorkspace(prisma, organizationId);
  const users: Map<string, string> = await upsertUsers(prisma, slug, organizationId, plan.users);
  await pinToPlan(prisma, organizationId, plan.planSlug);

  const ownerId: string = users.get("owner")!;

  // Recreated, not just cleared: without statuses, assertStatus 400s on every
  // status change and the status chips have nothing to render — and the only
  // other thing that restores defaults is a boot-time backfill, so the demo
  // would stay broken until the next API restart.
  await prisma.projectStatus.createMany({
    data: DEFAULT_STATUSES.map((status) => ({ ...status, organizationId })),
    skipDuplicates: true,
  });

  await prisma.branding.upsert({
    where: { organizationId },
    update: { primaryColor: "#1f6feb", accentColor: "#f0883e" },
    create: { organizationId, primaryColor: "#1f6feb", accentColor: "#f0883e" },
  });

  const companies = new Map<string, string>();
  for (const name of plan.companies) {
    const company = await prisma.company.create({
      data: { organizationId, name },
      select: { id: true },
    });
    companies.set(name, company.id);
  }

  for (const contact of plan.contacts) {
    await prisma.contact.create({
      data: {
        organizationId,
        name: contact.name,
        email: contact.email,
        status: contact.status,
        jobTitle: contact.jobTitle,
        companyId: contact.company ? (companies.get(contact.company) ?? null) : null,
        userId: contact.email === plan.users[1].email ? users.get("client") : null,
      },
    });
  }

  const projects = new Map<string, string>();
  for (const spec of plan.projects) {
    const project = await prisma.project.create({
      data: {
        organizationId,
        name: spec.name,
        description: spec.description,
        status: spec.status,
        startDate: at(spec.startOffsetDays),
        endDate: at(spec.endOffsetDays),
      },
      select: { id: true },
    });
    projects.set(spec.key, project.id);
    for (const clientKey of spec.clientKeys) {
      await prisma.projectClient.create({
        data: { projectId: project.id, userId: users.get(clientKey)! },
      });
    }
  }

  for (const update of plan.updates) {
    await prisma.projectUpdate.create({
      data: {
        organizationId,
        projectId: projects.get(update.projectKey)!,
        authorId: users.get(update.authorKey)!,
        content: update.content,
        createdAt: at(update.createdOffsetDays),
      },
    });
  }

  for (const task of plan.tasks) {
    await prisma.task.create({
      data: {
        organizationId,
        projectId: projects.get(task.projectKey)!,
        title: task.title,
        status: task.status,
        order: task.order,
        assigneeId: task.assigneeKey ? users.get(task.assigneeKey) : null,
        requestedById: task.requestedByKey ? users.get(task.requestedByKey) : null,
        dueDate: task.dueOffsetDays === null ? null : at(task.dueOffsetDays),
        closedAt: task.status === "done" ? at(-1) : null,
      },
    });
  }

  for (const invoice of plan.invoices) {
    const total: number = invoice.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    await prisma.invoice.create({
      data: {
        organizationId,
        projectId: projects.get(invoice.projectKey)!,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        dueDate: at(invoice.dueOffsetDays),
        paidAt: invoice.status === "paid" ? at(invoice.dueOffsetDays - 2) : null,
        paidAmount: invoice.status === "paid" ? total : null,
        lineItems: { create: invoice.items },
      },
    });
  }

  for (const doc of plan.documents) {
    const projectId: string = projects.get(doc.projectKey)!;
    const file = await prisma.file.create({
      data: {
        organizationId,
        projectId,
        uploadedById: ownerId,
        filename: doc.filename,
        mimeType: "application/pdf",
        sizeBytes: 182_000,
        // No storageKey: uploads are off in the demo and nothing serves these bytes.
      },
      select: { id: true },
    });
    const document = await prisma.document.create({
      data: {
        organizationId,
        projectId,
        uploadedById: ownerId,
        fileId: file.id,
        type: doc.type,
        title: doc.title,
        status: doc.status,
        requiresSignature: doc.requiresSignature,
        sentAt: at(-11),
      },
      select: { id: true },
    });
    if (doc.requiresSignature) {
      await prisma.signatureField.create({
        data: {
          documentId: document.id,
          pageNumber: 0,
          x: 0.12,
          y: 0.78,
          width: 0.3,
          height: 0.06,
          label: "Client signature",
          signerOrder: 1,
        },
      });
    }
    const events: string[] = doc.status === "signed" ? ["created", "sent", "viewed", "signed"] : ["created", "sent"];
    for (const [index, action] of events.entries()) {
      await prisma.documentAuditEvent.create({
        data: {
          documentId: document.id,
          action,
          userId: action === "signed" ? users.get("client") : ownerId,
          createdAt: at(-11 + index),
        },
      });
    }
  }

  for (const entry of plan.timeEntries) {
    const startedAt: Date = at(entry.startedOffsetDays);
    await prisma.timeEntry.create({
      data: {
        organizationId,
        projectId: projects.get(entry.projectKey)!,
        userId: users.get(entry.userKey)!,
        description: entry.description,
        startedAt,
        endedAt: new Date(startedAt.getTime() + entry.durationSec * 1000),
        durationSec: entry.durationSec,
      },
    });
  }

  return { organizationId };
}
