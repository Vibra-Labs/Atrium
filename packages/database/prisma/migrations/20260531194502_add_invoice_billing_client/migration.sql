-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "billingClientId" TEXT,
ADD COLUMN     "externalReference" TEXT;

-- CreateIndex
CREATE INDEX "invoice_billingClientId_idx" ON "invoice"("billingClientId");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_billingClientId_fkey" FOREIGN KEY ("billingClientId") REFERENCES "billing_client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
