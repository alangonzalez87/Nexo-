import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { startLocalDb } from "../../../scripts/local-db.js";
import { seed } from "../../../packages/database/src/seed.js";
import { SalesService } from "../src/sales.js";
import { configFromEnv } from "../src/config.js";
import { evaluateReceipt, type ExtractedReceipt } from "../src/receipt-verification.js";
import { pdfFixture } from "./pdf-fixture.js";

const valid: ExtractedReceipt = {
  isTransferReceipt: true,
  status: "completed",
  amount: 6900,
  currency: "ARS",
  recipientAlias: "demo.nexo.ventas",
  transactionId: "OP123456789",
  transactionDate: new Date().toISOString().slice(0, 10),
};

test("a photo, pending transfer, or mismatched amount stays in manual review", () => {
  const expected = { amountCents: 690000, currency: "ARS", alias: "demo.nexo.ventas", earliest: new Date() };
  assert.equal(evaluateReceipt({ ...valid, isTransferReceipt: false }, expected).ok, false);
  assert.equal(evaluateReceipt({ ...valid, status: "pending" }, expected).ok, false);
  assert.equal(evaluateReceipt({ ...valid, amount: 690 }, expected).ok, false);
  assert.equal(evaluateReceipt({ ...valid, recipientAlias: "otro.alias" }, expected).ok, false);
  assert.equal(evaluateReceipt({ ...valid, transactionId: null }, expected).ok, false);
  assert.equal(evaluateReceipt(valid, expected).ok, true);
});

test("opt-in product delivers only the selected pack and never reuses a receipt", { timeout: 60000 }, async () => {
  const storageDir = await mkdtemp(join(tmpdir(), "nexo-receipt-test-"));
  const local = await startLocalDb(55434);
  const db = new PrismaClient({ datasources: { db: { url: local.url } } });
  try {
    process.env.JWT_SECRET = "receipt-test-secret-at-least-32-characters";
    process.env.STORAGE_DIR = storageDir;
    const config = configFromEnv();
    const { workspaceId } = await seed(db, `${randomUUID()}@nexo.local`, "receipt-test-password");
    const connection = await db.connection.findFirstOrThrow({ where: { workspaceId } });
    const product = await db.product.create({
      data: { workspaceId, name: "Curso de prueba con packs", priceCents: 490000, receiptMode: "AUTO_RECEIPT" },
    });
    await db.pack.createMany({ data: [
      { workspaceId, productId: product.id, number: 1, name: "Pack 1", priceCents: 490000, deliveryMessage: "Entrega sólo del Pack 1" },
      { workspaceId, productId: product.id, number: 2, name: "Pack 2", priceCents: 690000, deliveryMessage: "Entrega sólo del Pack 2" },
    ] });
    await db.campaign.create({ data: { workspaceId, productId: product.id, name: "Auto receipt", code: "AUTO-RECEIPT" } });
    let extracted = valid;
    const sales = new SalesService(db, config, undefined, undefined, {
      extract: async () => extracted,
    });
    const send = (contact: string, text: string, media?: Buffer) =>
      sales.receive(workspaceId, {
        connectionId: connection.id, contact, eventId: randomUUID(), text,
        ...(media ? { media: { data: media, name: "comprobante.pdf" } } : {}),
      });
    await send("buyer-1", "AUTO-RECEIPT");
    await send("buyer-1", "2");
    const receipt = pdfFixture("comprobante de transferencia");
    const first = await send("buyer-1", "", receipt);
    assert.ok(first.paymentId);
    await sales.verifyReceipt(workspaceId, first.paymentId!);
    const approved = await db.payment.findUniqueOrThrow({ where: { id: first.paymentId } });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.packNumber, 2);
    assert.equal(approved.reviewedBy, "auto:receipt");
    const delivery = await db.message.findFirstOrThrow({ where: { conversationId: first.conversationId, text: "Entrega sólo del Pack 2" } });
    assert.equal(delivery.direction, "OUT");

    await send("buyer-2", "AUTO-RECEIPT");
    await send("buyer-2", "2");
    const repeated = await send("buyer-2", "", receipt);
    assert.ok(repeated.paymentId);
    await sales.verifyReceipt(workspaceId, repeated.paymentId!);
    const duplicate = await db.payment.findUniqueOrThrow({ where: { id: repeated.paymentId } });
    assert.equal(duplicate.status, "PENDING");
    assert.equal(duplicate.receiptCheckStatus, "NEEDS_REVIEW");

    extracted = { ...valid, isTransferReceipt: false, transactionId: "OP987654321" };
    await send("buyer-3", "AUTO-RECEIPT");
    await send("buyer-3", "2");
    const photo = await send("buyer-3", "", pdfFixture("not a receipt"));
    await sales.verifyReceipt(workspaceId, photo.paymentId!);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: photo.paymentId } })).status, "PENDING");
  } finally {
    await db.$disconnect();
    await local.close();
    await rm(storageDir, { recursive: true, force: true });
  }
});
