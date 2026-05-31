-- CreateTable
CREATE TABLE "billing_client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "defaultHourlyRateCents" INTEGER,
    "billingPeriod" TEXT,
    "billingNotes" TEXT,
    "externalReference" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_client_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "project" ADD COLUMN "billingClientId" TEXT;

-- CreateIndex
CREATE INDEX "billing_client_organizationId_archivedAt_idx" ON "billing_client"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_client_organizationId_slug_key" ON "billing_client"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "billing_client_organizationId_name_key" ON "billing_client"("organizationId", "name");

-- CreateIndex
CREATE INDEX "project_billingClientId_idx" ON "project"("billingClientId");

-- AddForeignKey
ALTER TABLE "billing_client" ADD CONSTRAINT "billing_client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_billingClientId_fkey" FOREIGN KEY ("billingClientId") REFERENCES "billing_client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
