CREATE TABLE "Pack" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "deliveryMessage" TEXT NOT NULL,
  CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Pack_workspaceId_productId_number_key" ON "Pack"("workspaceId", "productId", "number");
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_workspaceId_productId_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "Product"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD COLUMN "selectedPackNumber" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN "selectedPackName" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "selectedPackDeliveryMessage" TEXT;
ALTER TABLE "Payment" ADD COLUMN "packNumber" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "packName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "deliveryMessage" TEXT;
