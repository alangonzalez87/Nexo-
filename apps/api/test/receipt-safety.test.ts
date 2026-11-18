import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { startLocalDb } from "../../../scripts/local-db.js";
import { seed } from "../../../packages/database/src/seed.js";
import { buildApp } from "../src/app.js";
import { WebhookService } from "../src/webhooks.js";
import { SalesService } from "../src/sales.js";
import type { Config } from "../src/config.js";
import type { IntegrationSettings } from "../src/integrations.js";
import type { ReceiptVerifier } from "../src/receipt-verification.js";
import { sha256 } from "../src/security.js";
import { pdfFixture } from "./pdf-fixture.js";
import { resolveCampaignMatch } from "../src/sales/selection.js";
import { resolveCourseScope } from "../src/sales/course-scope.js";
import { normalize } from "../src/seller/text.js";
import {
  isShortConfirmation,
  packOfferText,
} from "../src/sales/confirmations.js";
let db: PrismaClient;
let local: Awaited<ReturnType<typeof startLocalDb>>;
let config: Config;
let storageDir: string;
test("generic advertising phrases need a linked ad, not just a sales keyword", () => {
  const products = [
    { id: "course", name: "Calendarios", active: true, agentEnabled: true },
  ];
  const campaigns = [
    {
      productId: "course",
      code: "Hola quiero mas informacion",
      adId: "linked-ad",
    },
  ];
  assert.equal(
    resolveCourseScope(
      "hola quiero mas informacion",
      undefined,
      campaigns,
      products,
    ).product,
    undefined,
  );
  assert.equal(
    resolveCourseScope("hola", { adId: "linked-ad" }, campaigns, products)
      .product?.id,
    "course",
  );
  assert.equal(
    resolveCourseScope("precio", undefined, campaigns, products).product,
    undefined,
  );
  assert.equal(
    resolveCourseScope("calendarios", undefined, campaigns, products).product
      ?.id,
    "course",
  );
});
test("short confirmations exclude questions, conditions and payment claims", () => {
  for (const text of [
    "Sí",
    "Si si",
    "sisi",
    "Dale!",
    "Sí, gracias",
    "ok perfecto",
  ])
    assert.equal(isShortConfirmation(text), true, text);
  for (const text of [
    "",
    "no",
    "sí pero cuánto cuesta",
    "si tengo una duda",
    "ya pagué",
    "sí quiero el 2",
  ])
    assert.equal(isShortConfirmation(text), false, text);
});
before(
  async () => {
    storageDir = await mkdtemp(join(tmpdir(), "nexo-receipt-safety-"));
    local = await startLocalDb(55436);
    db = new PrismaClient({ datasources: { db: { url: local.url } } });
    config = {
      jwtSecret: "receipt-safety-fixture-secret-32-characters",
      storageDir,
      publicUrl: "https://fixture.example.test",
      webOrigin: "https://fixture.example.test",
      aiProvider: "rules",
      openaiModel: "fixture",
      openwaEnabled: false,
      openwaUrl: "http://127.0.0.1:1",
      openwaKey: "",
      webhookSecret: "",
      forceSimulation: true,
    };
  },
  { timeout: 60000 },
);
after(async () => {
  await db?.$disconnect();
  await local?.close();
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
async function fixture(mode = "MANUAL", integrations?: IntegrationSettings) {
  const { workspaceId, userId } = await seed(
    db,
    `${randomUUID()}@example.test`,
    "fixture-password",
  );
  const connection = await db.connection.findFirstOrThrow({
    where: { workspaceId },
  });
  const product = await db.product.create({
    data: {
      workspaceId,
      name: "Safety fixture",
      priceCents: 10050,
      receiptMode: mode,
    },
  });
  await db.pack.create({
    data: {
      workspaceId,
      productId: product.id,
      number: 1,
      name: "Acceso",
      priceCents: 10050,
      deliveryMessage: "Entrega fixture",
    },
  });
  await db.campaign.create({
    data: {
      workspaceId,
      productId: product.id,
      name: "Fixture",
      code: "PRUEBA",
    },
  });
  const verifier: ReceiptVerifier = {
    extract: async () => ({
      isTransferReceipt: true,
      status: "completed",
      amount: 100.5,
      currency: "ARS",
      recipientAlias: "demo.nexo.ventas",
      transactionId: "OP" + randomUUID(),
      transactionDate: new Date().toISOString().slice(0, 10),
    }),
  };
  const sales = new SalesService(db, config, undefined, integrations, verifier);
  const send = (contact: string, text: string, bytes?: Buffer) =>
    sales.receive(workspaceId, {
      connectionId: connection.id,
      contact,
      eventId: randomUUID(),
      text,
      ...(bytes ? { media: { data: bytes, name: "receipt.pdf" } } : {}),
    });
  async function buy(contact: string, bytes: Buffer) {
    await send(contact, "PRUEBA");
    await send(contact, "1");
    const result = await send(contact, "", bytes);
    return db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
  }
  return {
    workspaceId,
    userId,
    product,
    connection,
    sales,
    send,
    buy,
    verifier,
  };
}

test("repeated yes preserves the selected pack and quote without approving or delivering", async () => {
  const f = await fixture();
  await db.pack.create({
    data: {
      workspaceId: f.workspaceId,
      productId: f.product.id,
      number: 3,
      name: "Completo",
      priceCents: 990000,
      deliveryMessage: "Entrega pack 3",
    },
  });
  const { conversationId } = await f.send("confirmation", "PRUEBA");
  await f.send("confirmation", "3");
  await db.pack.updateMany({
    where: { productId: f.product.id, number: 3 },
    data: { priceCents: 1200000 },
  });
  await f.send("confirmation", "Si si");
  const replies = () =>
    db.message.findMany({
      where: { conversationId, direction: "OUT" },
      orderBy: { createdAt: "asc" },
    });
  const first = await replies();
  assert.match(first.at(-1)!.text, /seguimos con el Pack 3/);
  assert.match(first.at(-1)!.text, /comprobante/);
  for (const text of ["Si si", "Sí", "dale"])
    await f.send("confirmation", text);
  assert.equal((await replies()).length, first.length);
  const chat = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  assert.equal(chat.selectedPackNumber, 3);
  assert.equal(chat.quotedPriceCents, 990000);
  assert.equal(chat.state, "AWAITING_PAYMENT");
  assert.equal(await db.payment.count({ where: { conversationId } }), 0);
  assert.equal(
    (await replies()).some((message) =>
      message.text.includes("Entrega pack 3"),
    ),
    false,
  );
  await f.send("confirmation", "cuanto cuesta");
  assert.match((await replies()).at(-1)!.text, /9\.900/);
});

test("ambiguous yes asks for a pack number once then clarifies without guessing or looping", async () => {
  const f = await fixture();
  const { conversationId } = await f.send("ambiguous-confirmation", "PRUEBA");
  for (const text of ["Si", "Si si", "Sí", "ok"])
    await f.send("ambiguous-confirmation", text);
  const messages = await db.message.findMany({
    where: { conversationId, direction: "OUT" },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(messages.length, 3);
  assert.match(messages[1].text, /Estos son los packs/);
  assert.match(messages[2].text, /Necesito el número/);
  const chat = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  assert.equal(chat.selectedPackNumber, null);
  assert.equal(chat.quotedPriceCents, null);
  await f.send("ambiguous-confirmation", "1");
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversationId } }))
      .state,
    "AWAITING_PAYMENT",
  );
});

test("yes accepts the last explicit pack offer but ignores cancelled offers", async () => {
  const f = await fixture();
  const pack = await db.pack.create({
    data: {
      workspaceId: f.workspaceId,
      productId: f.product.id,
      number: 2,
      name: "Ampliado",
      priceCents: 20000,
      deliveryMessage: "Entrega pack 2",
    },
  });
  for (const status of ["SENT", "CANCELLED"]) {
    const { conversationId } = await f.send(status, "PRUEBA");
    await f.send(status, "1");
    await db.message.create({
      data: {
        workspaceId: f.workspaceId,
        conversationId,
        direction: "OUT",
        origin: "AUTO",
        status,
        text: packOfferText(pack, "ARS"),
        externalId: randomUUID(),
      },
    });
    await f.send(status, "Sí");
    const chat = await db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    assert.equal(chat.selectedPackNumber, status === "SENT" ? 2 : 1);
    assert.equal(chat.quotedPriceCents, status === "SENT" ? 20000 : 10050);
  }
});
test("manual approvals record fingerprints and both current and historical receipts block automatic reuse", async () => {
  const f = await fixture();
  const bytes = pdfFixture("manually reviewed receipt");
  const first = await f.buy("manual", bytes);
  await f.sales.review(
    f.workspaceId,
    first.id,
    f.userId,
    "APPROVED",
    "verified",
    first.assetId,
  );
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: first.id } }))
      .receiptFingerprint,
    sha256(bytes),
  );
  await db.product.update({
    where: { id: f.product.id },
    data: { receiptMode: "AUTO_RECEIPT" },
  });
  for (const legacy of [false, true]) {
    if (legacy)
      await db.payment.update({
        where: { id: first.id },
        data: { receiptFingerprint: null },
      });
    const duplicate = await f.buy(`duplicate-${legacy}`, bytes);
    await f.sales.verifyReceipt(f.workspaceId, duplicate.id);
    const result = await db.payment.findUniqueOrThrow({
      where: { id: duplicate.id },
    });
    assert.equal(result.status, "PENDING");
    assert.equal(result.receiptCheckStatus, "NEEDS_REVIEW");
    assert.equal(
      await db.message.count({
        where: {
          conversationId: result.conversationId,
          text: "Entrega fixture",
        },
      }),
      0,
    );
  }
});
test("HTTP review requires the current receipt and stale approvals/rejections have no effect", async () => {
  const f = await fixture();
  const old = await f.buy("replace", pdfFixture("old receipt"));
  await f.send("replace", "", pdfFixture("new receipt"));
  const current = await db.payment.findUniqueOrThrow({ where: { id: old.id } });
  assert.notEqual(current.assetId, old.assetId);
  const { app } = await buildApp(db, config);
  const headers = {
    authorization: `Bearer ${app.jwt.sign({ sub: f.userId })}`,
    "x-workspace-id": f.workspaceId,
  };
  try {
    for (const decision of ["APPROVED", "REJECTED"]) {
      const result = await app.inject({
        method: "POST",
        url: `/api/payments/${old.id}/review`,
        headers,
        payload: { decision, expectedAssetId: old.assetId },
      });
      assert.equal(result.statusCode, 409, result.body);
    }
    const missing = await app.inject({
      method: "POST",
      url: `/api/payments/${old.id}/review`,
      headers,
      payload: { decision: "APPROVED" },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: old.id } })).status,
      "PENDING",
    );
    const approved = await app.inject({
      method: "POST",
      url: `/api/payments/${old.id}/review`,
      headers,
      payload: { decision: "APPROVED", expectedAssetId: current.assetId },
    });
    assert.equal(approved.statusCode, 200, approved.body);
  } finally {
    await app.close();
  }
});
test("automatic approval racing a replacement neither approves nor marks the new receipt for review", async () => {
  let wait = false,
    started!: () => void,
    release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const integrations = {
    resolve: async () => {
      if (wait) {
        wait = false;
        started();
        await gate;
      }
      return config;
    },
  } as unknown as IntegrationSettings;
  const f = await fixture("AUTO_RECEIPT", integrations);
  const old = await f.buy("race", pdfFixture("passed receipt"));
  await db.payment.update({
    where: { id: old.id },
    data: { receiptCheckStatus: "PASSED" },
  });
  wait = true;
  const approval = f.sales.verifyReceipt(f.workspaceId, old.id);
  await entered;
  try {
    await f.send("race", "", pdfFixture("replacement while approving"));
  } finally {
    release();
  }
  await approval;
  const current = await db.payment.findUniqueOrThrow({ where: { id: old.id } });
  assert.notEqual(current.assetId, old.assetId);
  assert.equal(current.status, "PENDING");
  assert.equal(current.receiptCheckStatus, "NOT_RUN");
  assert.equal(current.receiptFingerprint, null);
});
test("an extraction finishing after receipt replacement cannot consume or approve the new file", async () => {
  const f = await fixture("AUTO_RECEIPT");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const extract = f.verifier.extract;
  f.verifier.extract = async (...args) => {
    entered();
    await gate;
    return extract(...args);
  };
  const old = await f.buy("extraction", pdfFixture("old extracting receipt"));
  const pending = f.sales.verifyReceipt(f.workspaceId, old.id);
  await started;
  try {
    await f.send("extraction", "", pdfFixture("new receipt during extraction"));
  } finally {
    release();
  }
  await pending;
  const current = await db.payment.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(current.status, "PENDING");
  assert.equal(current.receiptCheckStatus, "NOT_RUN");
  assert.equal(current.receiptFingerprint, null);
});
test("human handoff cancels queued automation, records only human sends and resumes explicitly", async () => {
  const f = await fixture();
  const incoming = await f.send("handoff", "PRUEBA");
  const id = incoming.conversationId;
  assert.ok(
    await db.message.count({
      where: { conversationId: id, status: "PENDING" },
    }),
  );
  await f.sales.human(f.workspaceId, id, "Te atiendo yo");
  await f.sales.dispatchBatch(f.workspaceId, 20);
  const messages = await db.message.findMany({
    where: { conversationId: id, direction: "OUT" },
  });
  assert.ok(
    messages
      .filter((m) => m.origin === "AUTO")
      .every((m) => m.status === "CANCELLED"),
  );
  assert.equal(messages.find((m) => m.origin === "HUMAN")?.status, "SENT");
  await f.send("handoff", "1");
  assert.equal(
    await db.message.count({ where: { conversationId: id, direction: "OUT" } }),
    messages.length,
  );
  // An accidentally queued automatic message is checked again immediately before dispatch.
  await db.message.create({
    data: {
      workspaceId: f.workspaceId,
      conversationId: id,
      direction: "OUT",
      status: "PENDING",
      text: "stale",
      externalId: randomUUID(),
    },
  });
  await f.sales.dispatch(f.workspaceId);
  assert.equal(
    await db.message.count({
      where: { conversationId: id, status: "PENDING" },
    }),
    0,
  );
  await f.sales.human(f.workspaceId, id, undefined, true);
  await f.send("handoff", "1");
  assert.ok(
    await db.message.count({
      where: { conversationId: id, status: "PENDING" },
    }),
  );
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id } }))
      .humanControlled,
    false,
  );
});
test("phone sent events pause at ingress, deduplicate, ignore system echoes and cover new chats", async () => {
  const f = await fixture();
  const connection = await db.connection.findFirstOrThrow({
    where: { workspaceId: f.workspaceId },
  });
  const incoming = await f.send("5491100000000@c.us", "PRUEBA");
  await f.sales.dispatch(f.workspaceId);
  const bot = await db.message.findFirstOrThrow({
    where: { conversationId: incoming.conversationId, status: "SENT" },
  });
  await db.connection.update({
    where: { id: connection.id },
    data: { provider: "OPENWA" },
  });
  const secret = "own-message-fixture-secret";
  const integrations = {
    resolve: async () => ({
      ...config,
      openwaEnabled: true,
      webhookSecret: secret,
    }),
  } as unknown as IntegrationSettings;
  const webhook = new WebhookService(db, integrations, f.sales);
  async function event(
    id: string,
    chatId = "5491100000000@c.us",
    type = "text",
    name = "message.sent",
    fromMe = true,
  ) {
    const body = JSON.stringify({
      event: name,
      sessionId: connection.sessionId,
      data: {
        id,
        chatId,
        type,
        fromMe,
        isGroup: false,
        body: "Mensaje propio",
      },
    });
    return webhook.accept(
      f.workspaceId,
      body,
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    );
  }
  await event(bot.providerMessageId!);
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: incoming.conversationId },
      })
    ).humanControlled,
    false,
  );
  const ownId = randomUUID();
  await event(ownId);
  await event(ownId);
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: incoming.conversationId },
  });
  assert.equal(conversation.humanControlled, true);
  assert.equal(
    await db.message.count({ where: { providerMessageId: ownId } }),
    1,
  );
  assert.equal(
    await db.message.count({
      where: { conversationId: conversation.id, status: "PENDING" },
    }),
    0,
  );
  // Audio/media is still a human intervention, even without a text body.
  await event(randomUUID(), "123456789@lid", "ptt");
  assert.equal(
    (
      await db.conversation.findFirstOrThrow({
        where: { workspaceId: f.workspaceId, contact: "123456789@lid" },
      })
    ).humanControlled,
    true,
  );
  await event(
    randomUUID(),
    "5491100000001@c.us",
    "text",
    "message.received",
    true,
  );
  assert.equal(
    (
      await db.conversation.findFirstOrThrow({
        where: { workspaceId: f.workspaceId, contact: "5491100000001@c.us" },
      })
    ).humanControlled,
    true,
  );
  assert.deepEqual(
    await event(
      randomUUID(),
      "5491100000002@c.us",
      "text",
      "message.sent",
      false,
    ),
    { ignored: true },
  );
  // Redelivery after an explicit resume must not pause the chat again.
  await f.sales.human(f.workspaceId, conversation.id, undefined, true);
  await event(ownId);
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      })
    ).humanControlled,
    false,
  );
});
test("manual receipt acknowledgement is delivered during human control without auto-approval", async () => {
  const f = await fixture("MANUAL");
  const c = await f.send("silent-receipt", "PRUEBA");
  await f.send("silent-receipt", "1");
  await f.sales.human(f.workspaceId, c.conversationId, "Ya te ayudo");
  const before = await db.message.count({
    where: { conversationId: c.conversationId, direction: "OUT" },
  });
  const result = await f.send(
    "silent-receipt",
    "",
    pdfFixture("human handled receipt"),
  );
  await f.sales.verifyReceipt(f.workspaceId, result.paymentId!);
  await f.sales.dispatch(f.workspaceId);
  const acknowledgment = await db.message.findFirstOrThrow({
    where: {
      conversationId: c.conversationId,
      externalId: { startsWith: "receipt-ack:" },
    },
  });
  assert.equal(acknowledgment.status, "SENT");
  assert.equal(acknowledgment.origin, "PAYMENT");
  assert.match(acknowledgment.text, /verificar manualmente/i);
  assert.equal(
    await db.message.count({
      where: { conversationId: c.conversationId, direction: "OUT" },
    }),
    before + 1,
  );
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } }))
      .status,
    "PENDING",
  );
  await f.sales.review(
    f.workspaceId,
    result.paymentId!,
    f.userId,
    "REJECTED",
    "",
    (await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } }))
      .assetId,
  );
  const current = await db.conversation.findUniqueOrThrow({
    where: { id: c.conversationId },
  });
  assert.equal(current.humanControlled, true);
  assert.equal(current.paused, true);
  assert.equal(
    await db.message.count({
      where: { conversationId: c.conversationId, direction: "OUT" },
    }),
    before + 1,
  );
});
test("already delivered approval records payment and fingerprint without any send or delivery token", async () => {
  const f = await fixture();
  const payment = await f.buy(
    "manual-delivery",
    pdfFixture("already sent course"),
  );
  await f.sales.human(
    f.workspaceId,
    payment.conversationId,
    "Te mandé el curso",
  );
  const before = await db.message.count({
    where: { conversationId: payment.conversationId },
  });
  const { app } = await buildApp(db, config);
  const headers = {
    authorization: `Bearer ${app.jwt.sign({ sub: f.userId })}`,
    "x-workspace-id": f.workspaceId,
  };
  try {
    const url = `/api/payments/${payment.id}/review`;
    const payload = { decision: "APPROVED", expectedAssetId: payment.assetId };
    assert.equal(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
      409,
    );
    const result = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { ...payload, deliveryMode: "ALREADY_DELIVERED" },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().deliveryMode, "ALREADY_DELIVERED");
    assert.ok(result.json().receiptFingerprint);
    assert.equal(
      await db.message.count({
        where: { conversationId: payment.conversationId },
      }),
      before,
    );
    assert.equal(
      await db.delivery.count({ where: { paymentId: payment.id } }),
      0,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { ...payload, deliveryMode: "ALREADY_DELIVERED" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { ...payload, deliveryMode: "SEND" },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      await db.message.count({
        where: { conversationId: payment.conversationId },
      }),
      before,
    );
  } finally {
    await app.close();
  }
});
test("explicit approve and send works during human control and creates exactly one delivery message", async () => {
  const f = await fixture();
  const payment = await f.buy(
    "explicit-send",
    pdfFixture("explicit delivery receipt"),
  );
  await f.sales.human(f.workspaceId, payment.conversationId);
  for (let i = 0; i < 2; i++)
    await f.sales.review(
      f.workspaceId,
      payment.id,
      f.userId,
      "APPROVED",
      "",
      payment.assetId,
      undefined,
      "SEND",
    );
  await f.sales.dispatchBatch(f.workspaceId, 20);
  const delivery = await db.message.findMany({
    where: { conversationId: payment.conversationId, text: "Entrega fixture" },
  });
  assert.equal(delivery.length, 1);
  assert.equal(delivery[0].origin, "PAYMENT");
  assert.equal(delivery[0].status, "SENT");
});
test("human intervention during extraction prevents automatic delivery when the result arrives", async () => {
  const f = await fixture("AUTO_RECEIPT");
  const payment = await f.buy(
    "human-race",
    pdfFixture("human takes over during extraction"),
  );
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const extract = f.verifier.extract;
  f.verifier.extract = async (...args) => {
    entered();
    await gate;
    return extract(...args);
  };
  const pending = f.sales.verifyReceipt(f.workspaceId, payment.id);
  await started;
  try {
    await f.sales.human(
      f.workspaceId,
      payment.conversationId,
      "Yo te lo entrego",
    );
  } finally {
    release();
  }
  await pending;
  const result = await db.payment.findUniqueOrThrow({
    where: { id: payment.id },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(result.receiptCheckStatus, "NEEDS_REVIEW");
  assert.equal(
    await db.message.count({
      where: {
        conversationId: payment.conversationId,
        text: "Entrega fixture",
      },
    }),
    0,
  );
});
test("a system echo arriving before the send transaction commits is not a human handoff", async () => {
  const f = await fixture();
  const first = await f.send("early-echo", "PRUEBA");
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: first.conversationId },
  });
  const message = await db.message.findFirstOrThrow({
    where: { conversationId: conversation.id, direction: "OUT" },
  });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const providerId = randomUUID();
  const sending = f.sales.locked(f.workspaceId, async (tx) => {
    entered();
    await gate;
    await tx.message.update({
      where: { id: message.id },
      data: { status: "SENT", providerMessageId: providerId },
    });
  });
  await started;
  const echo = f.sales.observeOwnMessage(
    f.workspaceId,
    conversation.connectionId,
    {
      id: providerId,
      chatId: conversation.contact,
      body: message.text,
      type: "text",
    },
  );
  release();
  await Promise.all([sending, echo]);
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      })
    ).humanControlled,
    false,
  );
  assert.equal(
    await db.message.count({
      where: { conversationId: conversation.id, origin: "HUMAN" },
    }),
    0,
  );
});
test("manual delivery can be recorded without an uploaded delivery asset and keeps quote checks", async () => {
  const f = await fixture();
  const product = await db.product.create({
    data: {
      workspaceId: f.workspaceId,
      name: "Manual course",
      priceCents: 10050,
    },
  });
  const initial = await f.send("manual-no-asset", product.name);
  await f.sales.human(f.workspaceId, initial.conversationId);
  const incoming = await f.send(
    "manual-no-asset",
    "",
    pdfFixture("manual course without asset"),
  );
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: incoming.paymentId },
  });
  await assert.rejects(
    f.sales.review(
      f.workspaceId,
      payment.id,
      f.userId,
      "APPROVED",
      "",
      payment.assetId,
      undefined,
      "ALREADY_DELIVERED",
    ),
    /cotizaci/,
  );
  const result = await f.sales.review(
    f.workspaceId,
    payment.id,
    f.userId,
    "APPROVED",
    "",
    payment.assetId,
    { productId: product.id },
    "ALREADY_DELIVERED",
  );
  assert.equal(result.amountCents, 10050);
  assert.equal(result.deliveryMode, "ALREADY_DELIVERED");
  assert.equal(
    await db.message.count({
      where: { conversationId: initial.conversationId, status: "PENDING" },
    }),
    0,
  );
});

test("configured automatic greetings do not take human control or suppress activation", async () => {
  const greeting = "Automatic business greeting";
  const integrations = {
    resolve: async () => ({ ...config, automaticOwnMessages: [greeting] }),
  } as unknown as IntegrationSettings;
  const f = await fixture("MANUAL", integrations);
  const connection = await db.connection.findFirstOrThrow({
    where: { workspaceId: f.workspaceId },
  });
  const own = (text: string) =>
    f.sales.observeOwnMessage(f.workspaceId, connection.id, {
      id: randomUUID(),
      chatId: "greeting-chat",
      body: text,
      type: "text",
    });
  const first = await own(greeting);
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: first.conversationId },
  });
  assert.equal(conversation.humanControlled, false);
  assert.equal(conversation.paused, false);
  assert.equal(conversation.state, "DISCOVERY");
  assert.equal(
    (
      await db.message.findFirstOrThrow({
        where: { conversationId: conversation.id },
      })
    ).origin,
    "EXTERNAL_AUTO",
  );
  await f.send("greeting-chat", "PRUEBA");
  assert.ok(
    await db.message.count({
      where: {
        conversationId: conversation.id,
        origin: "AUTO",
        status: "PENDING",
      },
    }),
  );
  // Similar text is not an exception; genuine human intervention still wins.
  await own(greeting + " - I will help you personally");
  await own(greeting);
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      })
    ).humanControlled,
    true,
  );
  assert.equal(
    await db.message.count({
      where: { conversationId: conversation.id, status: "PENDING" },
    }),
    0,
  );
  // Another business has no exception, even for the same greeting.
  const other = await fixture();
  const otherConnection = await db.connection.findFirstOrThrow({
    where: { workspaceId: other.workspaceId },
  });
  const outside = await other.sales.observeOwnMessage(
    other.workspaceId,
    otherConnection.id,
    { id: randomUUID(), chatId: "greeting-chat", body: greeting, type: "text" },
  );
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: outside.conversationId },
      })
    ).humanControlled,
    true,
  );
});

test("the advent calendar activation matches punctuation, accents and a leading emoji", () => {
  const product = { id: "calendar" };
  assert.equal(
    resolveCampaignMatch(
      normalize(
        "\u{1f4c6}\u00a1Hola! Me brindas m\u00e1s informaci\u00f3n de los calendarios de adviento Navide\u00f1os?",
      ),
      undefined,
      [
        {
          code: "\u00a1Hola! Me brindas m\u00e1s informaci\u00f3n de los calendarios de adviento Navide\u00f1os?",
          adId: null,
          productId: product.id,
        },
      ],
      [product],
    ),
    product,
  );
});

test("signed unknown-type ad greetings use the exact configured exception without blocking the next activation", async () => {
  const greeting = "\u00a1Hola! \u00bfC\u00f3mo podemos ayudarte?";
  const secret = "ad-greeting-test-secret";
  const integrations = {
    resolve: async () => ({
      ...config,
      openwaEnabled: true,
      webhookSecret: secret,
      automaticOwnMessages: [greeting],
    }),
  } as unknown as IntegrationSettings;
  const f = await fixture("MANUAL", integrations);
  const connection = await db.connection.findFirstOrThrow({
    where: { workspaceId: f.workspaceId },
  });
  await db.connection.update({
    where: { id: connection.id },
    data: { provider: "OPENWA" },
  });
  const webhooks = new WebhookService(db, integrations, f.sales);
  const contact = "5491100000058@c.us";
  async function own(body: string, type = "unknown") {
    const raw = JSON.stringify({
      event: "message.sent",
      sessionId: connection.sessionId,
      data: {
        id: randomUUID(),
        chatId: contact,
        body,
        type,
        fromMe: true,
        isGroup: false,
      },
    });
    return webhooks.accept(
      f.workspaceId,
      raw,
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    );
  }
  await own(greeting);
  let chat = await db.conversation.findFirstOrThrow({
    where: { workspaceId: f.workspaceId, contact },
  });
  assert.equal(chat.humanControlled, false);
  assert.equal(chat.paused, false);
  assert.equal(
    (await db.message.findFirstOrThrow({ where: { conversationId: chat.id } }))
      .origin,
    "EXTERNAL_AUTO",
  );
  await f.send(contact, "PRUEBA");
  chat = await db.conversation.findUniqueOrThrow({ where: { id: chat.id } });
  assert.equal(chat.productId, f.product.id);
  assert.ok(
    await db.message.count({
      where: { conversationId: chat.id, origin: "AUTO", status: "PENDING" },
    }),
  );
  // Unknown isn't ignored in general: only the registered full greeting is.
  await own("Te atiendo personalmente");
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: chat.id } }))
      .humanControlled,
    true,
  );
  assert.equal(
    await db.message.count({
      where: { conversationId: chat.id, status: "PENDING" },
    }),
    0,
  );
  await own(greeting);
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: chat.id } }))
      .humanControlled,
    true,
  );
});

test("unassigned chats ignore sales words, attachments and unavailable media", async () => {
  const f = await fixture();
  const { conversationId } = await f.send("outside", "hola");
  for (const text of ["precio", "comprar", "1", "si si", "comprobante"])
    await f.send("outside", text);
  const receipt = await f.send("outside", "", pdfFixture("unrelated receipt"));
  assert.equal(receipt.paymentId, undefined);
  await f.sales.receive(f.workspaceId, {
    connectionId: f.connection.id,
    contact: "outside",
    eventId: randomUUID(),
    text: "",
    mediaUnavailable: true,
  });
  assert.equal(await db.payment.count({ where: { conversationId } }), 0);
  assert.equal(
    await db.message.count({ where: { conversationId, direction: "OUT" } }),
    0,
  );
  assert.equal(
    await db.notification.count({ where: { workspaceId: f.workspaceId } }),
    0,
  );
  assert.equal(
    await db.message.count({
      where: { conversationId, assetId: { not: null } },
    }),
    1,
  );
});

test("disabled courses stay silent and cancel queued replies and receipt analysis", async () => {
  const f = await fixture("AUTO_RECEIPT");
  const payment = await f.buy(
    "disabled",
    pdfFixture("disabled course receipt"),
  );
  await db.product.update({
    where: { id: f.product.id },
    data: { agentEnabled: false },
  });
  await f.sales.verifyReceipt(f.workspaceId, payment.id);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .receiptCheckStatus,
    "NOT_RUN",
  );
  await f.sales.dispatch(f.workspaceId);
  assert.equal(
    await db.message.count({
      where: { workspaceId: f.workspaceId, direction: "OUT", status: "SENT" },
    }),
    0,
  );
  const r = await f.send("disabled-new", "PRUEBA");
  await f.send("disabled-new", "comprar");
  await f.send("disabled-new", "", pdfFixture("disabled new receipt"));
  assert.equal(
    await db.message.count({
      where: { conversationId: r.conversationId, direction: "OUT" },
    }),
    0,
  );
  assert.equal(
    await db.payment.count({ where: { conversationId: r.conversationId } }),
    0,
  );
  await db.product.update({
    where: { id: f.product.id },
    data: { agentEnabled: true },
  });
  await f.send("disabled-new", "PRUEBA");
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      })
    ).productId,
    f.product.id,
  );
});

test("another course or unknown ad releases the previous context until a new activation", async () => {
  const f = await fixture();
  for (const kind of ["course", "ad"]) {
    const { conversationId } = await f.send(kind, "PRUEBA");
    await f.send(kind, "1");
    if (kind === "course") await f.send(kind, "precio del curso de reposteria");
    else
      await f.sales.receive(f.workspaceId, {
        connectionId: f.connection.id,
        contact: kind,
        eventId: randomUUID(),
        text: "precio",
        referral: { adId: "unassigned-ad" },
      });
    const c = await db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    assert.equal(c.state, "OUT_OF_SCOPE");
    assert.equal(c.productId, null);
    assert.equal(c.quotedPriceCents, null);
    assert.equal(
      await db.message.count({
        where: { conversationId, status: "PENDING", direction: "OUT" },
      }),
      0,
    );
    const count = await db.message.count({
      where: { conversationId, direction: "OUT" },
    });
    await f.send(kind, "precio");
    await f.send(kind, "", pdfFixture("other course"));
    assert.equal(await db.payment.count({ where: { conversationId } }), 0);
    assert.equal(
      await db.message.count({ where: { conversationId, direction: "OUT" } }),
      count,
    );
    await f.send(kind, "PRUEBA");
    assert.equal(
      (
        await db.conversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).state,
      "QUALIFIED",
    );
  }
});

test("active course changes clear quotes; human intervention prevents routing and completed sales can start again", async () => {
  const f = await fixture();
  const second = await db.product.create({
    data: { workspaceId: f.workspaceId, name: "Reposteria", priceCents: 25000 },
  });
  const { conversationId } = await f.send("switch", "PRUEBA");
  await f.send("switch", "1");
  await f.send("switch", "curso de reposteria");
  let c = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  assert.equal(c.productId, second.id);
  assert.equal(c.selectedPackNumber, null);
  assert.equal(c.quotedPriceCents, null);
  await f.sales.human(f.workspaceId, conversationId);
  await f.send("switch", "PRUEBA");
  c = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  assert.equal(c.productId, second.id);
  assert.equal(c.humanControlled, true);
  const paid = await f.buy(
    "returning",
    pdfFixture("completed previous course"),
  );
  await f.sales.review(
    f.workspaceId,
    paid.id,
    f.userId,
    "APPROVED",
    "",
    paid.assetId,
  );
  await f.sales.dispatch(f.workspaceId);
  const before = await db.message.count({
    where: { conversationId: paid.conversationId, direction: "OUT" },
  });
  await f.send("returning", "precio");
  assert.equal(
    await db.message.count({
      where: { conversationId: paid.conversationId, direction: "OUT" },
    }),
    before,
  );
  await f.send("returning", "curso de reposteria");
  c = await db.conversation.findUniqueOrThrow({
    where: { id: paid.conversationId },
  });
  assert.equal(c.state, "QUALIFIED");
  assert.equal(c.productId, second.id);
  assert.equal(c.quotedPriceCents, null);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: paid.id } })).status,
    "APPROVED",
  );
});

test("generic campaign words cannot activate a course and inactive names cannot use an old context", async () => {
  const f = await fixture();
  await db.campaign.create({
    data: {
      workspaceId: f.workspaceId,
      productId: f.product.id,
      name: "Generic",
      code: "PRECIO",
    },
  });
  const r = await f.send("generic", "precio");
  assert.equal(
    await db.message.count({
      where: { conversationId: r.conversationId, direction: "OUT" },
    }),
    0,
  );
  const other = await db.product.create({
    data: {
      workspaceId: f.workspaceId,
      name: "Reposteria",
      priceCents: 25000,
      active: false,
    },
  });
  await f.send("generic", "PRUEBA");
  await f.send("generic", other.name);
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      })
    ).state,
    "OUT_OF_SCOPE",
  );
});

test("disabling a course during extraction blocks automatic delivery at final approval", async () => {
  const f = await fixture("AUTO_RECEIPT");
  const p = await f.buy("disable-race", pdfFixture("disabled while checking"));
  const extract = f.verifier.extract;
  f.verifier.extract = async (...args) => {
    const result = await extract(...args);
    await db.product.update({
      where: { id: f.product.id },
      data: { agentEnabled: false },
    });
    return result;
  };
  await f.sales.verifyReceipt(f.workspaceId, p.id);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    "PENDING",
  );
  assert.equal(
    await db.message.count({
      where: {
        conversationId: p.conversationId,
        externalId: { startsWith: "payment:" },
      },
    }),
    0,
  );
});
