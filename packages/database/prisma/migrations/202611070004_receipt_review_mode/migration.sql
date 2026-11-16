ALTER TABLE "Product" ADD COLUMN "receiptMode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Payment" ADD COLUMN "receiptMode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Payment" ADD COLUMN "receiptCheckStatus" TEXT NOT NULL DEFAULT 'NOT_RUN';
ALTER TABLE "Payment" ADD COLUMN "receiptCheckSummary" TEXT;
ALTER TABLE "Payment" ADD COLUMN "receiptCheckStartedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "receiptReference" TEXT;
ALTER TABLE "Payment" ADD COLUMN "receiptFingerprint" TEXT;
CREATE UNIQUE INDEX "Payment_workspaceId_receiptReference_key" ON "Payment"("workspaceId", "receiptReference");
CREATE UNIQUE INDEX "Payment_workspaceId_receiptFingerprint_key" ON "Payment"("workspaceId", "receiptFingerprint");
