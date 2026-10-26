import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "edgar@atrium.local" },
    include: { members: true },
  });

  if (!user || !user.members[0]) {
    throw new Error("User or organization not found");
  }

  const organizationId = user.members[0].organizationId;
  console.log("Using org:", organizationId);

  // Clean up any previous test project for this org
  await prisma.project.deleteMany({
    where: { organizationId, name: "Website Redesign" },
  });

  // Create Project
  const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const endDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

  const project = await prisma.project.create({
    data: {
      organizationId,
      name: "Website Redesign",
      description: "Modern overhaul of the marketing site and customer portal.",
      status: "in_progress",
      startDate,
      endDate,
    },
  });

  console.log("Created project:", project.id);

  // Create Files
  const file1 = await prisma.file.create({
    data: {
      organizationId,
      projectId: project.id,
      filename: "homepage-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_450_000,
      storageKey: `dummy/${project.id}/homepage-v2.pdf`,
      uploadedById: user.id,
      type: "UPLOAD",
    },
  });

  const file2 = await prisma.file.create({
    data: {
      organizationId,
      projectId: project.id,
      filename: "wireframes-final.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1_200_000,
      storageKey: `dummy/${project.id}/wireframes-final.pdf`,
      uploadedById: user.id,
      type: "UPLOAD",
    },
  });

  const file3 = await prisma.file.create({
    data: {
      organizationId,
      projectId: project.id,
      filename: "sitemap-architecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 680_000,
      storageKey: `dummy/${project.id}/sitemap-architecture.pdf`,
      uploadedById: user.id,
      type: "UPLOAD",
    },
  });

  // Create Deliverable Document (Needs Review)
  const deliverable = await prisma.document.create({
    data: {
      organizationId,
      projectId: project.id,
      fileId: file1.id,
      uploadedById: user.id,
      title: "Homepage designs, version 2",
      type: "deliverable",
      status: "pending",
      requiresApproval: true,
      requestNote: "Please review the updated hero typography, social proof banner, and interactive pricing calculator.",
    },
  });

  console.log("Created deliverable:", deliverable.id);

  // Create Invoice
  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      projectId: project.id,
      invoiceNumber: "1042",
      type: "standard",
      status: "sent",
      amount: 240000, // $2,400.00
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: "Visual design milestone payment (50% upfront for phase 2).",
      lineItems: {
        create: [
          {
            description: "Visual design phase & responsive layouts",
            quantity: 1,
            unitPrice: 240000,
          },
        ],
      },
    },
  });

  console.log("Created invoice:", invoice.id);

  // Create Timeline Updates
  await prisma.projectUpdate.create({
    data: {
      organizationId,
      projectId: project.id,
      authorId: user.id,
      content: "Homepage designs are ready for review! Leave comments directly on the file and we'll fold them into this week's build.",
      fileId: file1.id,
    },
  });

  await prisma.projectUpdate.create({
    data: {
      organizationId,
      projectId: project.id,
      authorId: user.id,
      content: "Sitemap and wireframes are approved. Moving full speed ahead into visual design.",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  // Create Tasks
  await prisma.task.create({
    data: {
      organizationId,
      projectId: project.id,
      title: "Confirm domain registrar credentials",
      type: "general",
      status: "open",
    },
  });

  await prisma.task.create({
    data: {
      organizationId,
      projectId: project.id,
      title: "Provide brand color codes and SVG logo asset",
      type: "general",
      status: "done",
      closedAt: new Date(),
    },
  });

  console.log("Successfully seeded project data! Project ID:", project.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
