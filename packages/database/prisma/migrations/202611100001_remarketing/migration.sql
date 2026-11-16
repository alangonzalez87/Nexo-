ALTER TABLE "Product" ADD COLUMN "remarketingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "remarketingDelayHours" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Product" ADD COLUMN "remarketingMessage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Conversation" ADD COLUMN "marketingOptOutAt" TIMESTAMP(3);
