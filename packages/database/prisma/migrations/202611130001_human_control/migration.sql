ALTER TABLE "Conversation" ADD COLUMN "humanControlled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "Payment" ADD COLUMN "deliveryMode" TEXT;
UPDATE "Message" SET "origin" = 'HUMAN' WHERE "externalId" LIKE 'human:%';
UPDATE "Conversation" c SET "humanControlled" = true WHERE c."state" = 'HUMAN' OR (c."paused" = true AND EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m."origin" = 'HUMAN'));
UPDATE "Message" m SET "origin" = 'PAYMENT' FROM "Payment" p WHERE m."externalId" = 'payment:' || p.id || ':' || p.status AND p."reviewedBy" IS NOT NULL AND p."reviewedBy" <> 'auto:receipt';
UPDATE "Message" m SET status = 'CANCELLED' FROM "Conversation" c WHERE m."conversationId" = c.id AND c."humanControlled" = true AND m.status = 'PENDING' AND m.origin <> 'HUMAN';
