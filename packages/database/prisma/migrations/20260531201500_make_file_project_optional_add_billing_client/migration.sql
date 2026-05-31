-- AlterTable
ALTER TABLE "file" ADD COLUMN     "billingClientId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "file_billingClientId_idx" ON "file"("billingClientId");

-- AddForeignKey
ALTER TABLE "file" ADD CONSTRAINT "file_billingClientId_fkey" FOREIGN KEY ("billingClientId") REFERENCES "billing_client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

