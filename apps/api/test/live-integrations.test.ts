import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { OpenAISelector } from "../src/seller.js";
import { saveAsset } from "../src/storage.js";
import { seed } from "../../../packages/database/src/seed.js";
import { startLocalDb } from "../../../scripts/local-db.js";
import { pdfFixture } from "./pdf-fixture.js";
import { imageFixture } from "./image-fixture.js";

// HTTP fixtures exercise the actual adapters/SDK; these are NOT live provider checks.
const calls: { url: string; method: string; body: any; headers: any }[] = [];
let mediaMissing = false,
  sendFailure = false,
  aiFailure = false,
  statusFailure = false,
  sessionStopped = false;
const subscriptions: any[] = [];
const managedSessions: { id: string; name: string; status: string }[] = [];
let failManagedWebhook = false;
const gateway = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString(),
    body = raw ? JSON.parse(raw) : undefined;
  calls.push({
    url: req.url!,
    method: req.method!,
    body,
    headers: req.headers,
  });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/sessions" && req.method === "GET")
    return res.end(JSON.stringify(managedSessions));
  if (req.url === "/api/sessions" && req.method === "POST") {
    const session = { id: randomUUID(), name: body.name, status: "created" };
    managedSessions.push(session);
    return res.end(JSON.stringify(session));
  }
  if (req.url === "/api/auth/api-keys" && req.method === "POST")
    return res.end(
      JSON.stringify({
        id: randomUUID(),
        apiKey: "restricted-fixture-key",
        ...body,
      }),
    );
  if (req.url === "/v1/responses") {
    if (aiFailure) {
      res.statusCode = 401;
      return res.end(
        JSON.stringify({
          error: {
            message: "fixture authentication failure",
            type: "invalid_request_error",
          },
        }),
      );
    }
    const input = JSON.parse(body.input);
    const output = input.packs
      ? input.message.includes("no quiero")
        ? { intent: "none", packNumbers: [] }
        : input.message.includes("cuánto")
          ? { intent: "price", packNumbers: [3] }
          : { intent: "choose", packNumbers: [3] }
      : {
          ids: [
            (
              input.facts.find((f: any) => f.id.startsWith("doc-")) ||
              input.facts[0]
            ).id,
          ],
        };
    return res.end(
      JSON.stringify({
        id: "resp_fixture",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                annotations: [],
                text: JSON.stringify(output),
              },
            ],
          },
        ],
      }),
    );
  }
  if (req.url?.endsWith("/media")) {
    res.statusCode = mediaMissing ? 404 : 200;
    res.setHeader("Content-Type", "application/pdf");
    return res.end(
      mediaMissing ? "" : pdfFixture(`Unique fixture ${randomUUID()}`),
    );
  }
  if (req.url?.endsWith("/send-text") || req.url?.endsWith("/send-image")) {
    res.statusCode = sendFailure ? 503 : 201;
    return res.end(
      JSON.stringify(
        sendFailure
          ? { error: "unavailable" }
          : { messageId: `wa-${req.headers["idempotency-key"]}` },
      ),
    );
  }
  if (req.url?.endsWith("/send-document"))
    return res.end(JSON.stringify({ messageId: "wa-document-fixture" }));
  if (req.url?.includes("/webhooks")) {
    if (failManagedWebhook) {
      failManagedWebhook = false;
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: "unavailable" }));
    }
    if (req.method === "GET") return res.end(JSON.stringify(subscriptions));
    const item = { id: "subscription-1", ...body };
    subscriptions.splice(0, subscriptions.length, item);
    return res.end(JSON.stringify(item));
  }
  if (req.url?.includes("/contacts/")) {
    const resolved = req.url.includes("888888888888888%40lid");
    if (req.url.endsWith("/phone"))
      return res.end(
        JSON.stringify({ phone: resolved ? "5491199998888" : null }),
      );
    if (req.url.includes("777777777777777%40lid")) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: "contact lookup unavailable" }));
    }
    return res.end(
      JSON.stringify(
        resolved
          ? { pushName: "Cliente nuevo", number: "888888888888888" }
          : {},
      ),
    );
  }
  if (req.url?.endsWith("/stop") && req.method === "POST") {
    sessionStopped = true;
    return res.end(JSON.stringify({ id: sessionId, status: "disconnected" }));
  }
  if (req.url?.endsWith("/start") && req.method === "POST") {
    sessionStopped = false;
    return res.end(JSON.stringify({ id: sessionId, status: "ready" }));
  }
  res.statusCode = statusFailure ? 503 : 200;
  return res.end(
    JSON.stringify({ status: sessionStopped ? "disconnected" : "ready" }),
  );
});
let db: PrismaClient,
  local: Awaited<ReturnType<typeof startLocalDb>> | undefined,
  ctx: Awaited<ReturnType<typeof buildApp>>,
  config: Config,
  storage: string;
let workspaceId: string,
  productId: string,
  connectionId: string,
  headers: Record<string, string>,
  selector: OpenAISelector;
const sessionId = randomUUID(),
  secret = "test-hmac-secret-with-at-least-32-characters";
const chatId = "5491112345678@c.us";
let savedConfig: any;
before(
  async () => {
    await new Promise<void>((resolve) =>
      gateway.listen(0, "127.0.0.1", resolve),
    );
    storage = await mkdtemp(join(tmpdir(), "nexo-live-tests-"));
    if (!process.env.TEST_DATABASE_URL) local = await startLocalDb(55434);
    db = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL || local!.url } },
    });
    const user = await seed(
      db,
      `live-${randomUUID()}@nexo.local`,
      "live-test-password",
    );
    workspaceId = user.workspaceId;
    productId = (await db.product.findFirstOrThrow({ where: { workspaceId } }))
      .id;
    const url = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    config = {
      jwtSecret: "local-test-jwt-at-least-thirty-two-characters",
      storageDir: storage,
      publicUrl: "https://api.example.test",
      webOrigin: "http://localhost:5173",
      aiProvider: "rules",
      openaiModel: "gpt-4.1-mini",
      openwaUrl: url,
      openwaKey: "",
      openwaEnabled: false,
      webhookSecret: "",
    };
    selector = new OpenAISelector(
      { ...config, openaiKey: "test-openai" },
      new OpenAI({
        apiKey: "test-openai",
        baseURL: `${url}/v1`,
        maxRetries: 0,
      }),
    );
    ctx = await buildApp(db, config, selector);
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: (await db.user.findUniqueOrThrow({ where: { id: user.userId } }))
          .email,
        password: "live-test-password",
      },
    });
    headers = {
      authorization: `Bearer ${login.json().token}`,
      "x-workspace-id": workspaceId,
    };
    savedConfig = {
      openwaEnabled: true,
      openwaUrl: url,
      openwaKey: "test-gateway",
      webhookSecret: secret,
      aiProvider: "openai",
      openaiKey: "test-openai",
      openaiModel: "gpt-4.1-mini",
      publicUrl: "https://api.example.test",
    };
  },
  { timeout: 60000 },
);
after(async () => {
  await ctx?.app.close();
  await db?.$disconnect();
  await local?.close();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  if (storage) await rm(storage, { recursive: true, force: true });
});
const request = (method: "GET" | "POST" | "PUT", url: string, payload?: any) =>
  ctx.app.inject({ method, url, payload, headers });
function event(
  body: string,
  id = randomUUID(),
  extra: Record<string, unknown> = {},
) {
  return {
    event: "message.received",
    timestamp: new Date().toISOString(),
    sessionId,
    idempotencyKey: randomUUID(),
    deliveryId: randomUUID(),
    data: {
      id,
      chatId,
      from: chatId,
      to: "5491198765432@c.us",
      body,
      type: "chat",
      timestamp: Date.now(),
      fromMe: false,
      isGroup: false,
      ...extra,
    },
  };
}
async function webhook(payload: any, signature?: string) {
  const raw = JSON.stringify(payload);
  return ctx.app.inject({
    method: "POST",
    url: `/api/webhooks/openwa/${workspaceId}`,
    payload: raw,
    headers: {
      "content-type": "application/json",
      "x-openwa-signature":
        signature ||
        `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    },
  });
}
async function receive(body: string, extra: Record<string, unknown> = {}) {
  const r = await webhook(event(body, randomUUID(), extra));
  assert.equal(r.statusCode, 202, r.body);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatch(workspaceId);
  return r.json().id;
}
const aiCalls = () => calls.filter((c) => c.url === "/v1/responses");
const sends = () => calls.filter((c) => c.url.endsWith("/send-text"));
const conversation = () =>
  db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: chatId },
    include: { messages: true, payments: true },
  });

test("workspace credentials are encrypted, masked, isolated and gateway origins constrained", async () => {
  const result = await request("PUT", "/api/integrations/config", savedConfig);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().hasOpenaiKey, true);
  assert.equal(result.json().openaiKey, undefined);
  assert.equal(result.json().webhookSecret, undefined);
  const row = await db.integrationConfig.findUniqueOrThrow({
    where: { workspaceId },
  });
  assert.ok(!row.encrypted.includes("test-openai"));
  const other = await db.workspace.create({
    data: { name: "Other live workspace" },
  });
  assert.equal((await ctx.integrations.resolve(other.id)).openwaKey, "");
  const foreign = await ctx.app.inject({
    method: "GET",
    url: "/api/integrations/config",
    headers: { ...headers, "x-workspace-id": other.id },
  });
  assert.equal(foreign.statusCode, 403);
  assert.equal(
    (
      await request("PUT", "/api/integrations/config", {
        ...savedConfig,
        openwaUrl: "http://169.254.169.254",
      })
    ).statusCode,
    400,
  );
  const preserve = { ...savedConfig };
  delete preserve.openwaKey;
  delete preserve.openaiKey;
  delete preserve.webhookSecret;
  assert.equal(
    (await request("PUT", "/api/integrations/config", preserve)).statusCode,
    200,
  );
  assert.equal(
    (await ctx.integrations.resolve(workspaceId)).openaiKey,
    "test-openai",
  );
});

test("register existing session, query real HTTP status and create/update signed webhook", async () => {
  const c = await request("POST", "/api/connections", {
    name: "HTTP contract phone",
    provider: "OPENWA",
    sessionId,
  });
  assert.equal(c.statusCode, 200, c.body);
  connectionId = c.json().id;
  const status = await request(
    "POST",
    `/api/connections/${connectionId}/connect`,
  );
  assert.equal(status.json().status, "CONNECTED");
  const live = await request("GET", "/api/connections/live-status");
  assert.equal(live.statusCode, 200, live.body);
  assert.deepEqual(
    live.json().find((item: any) => item.id === connectionId).status,
    "CONNECTED",
  );
  statusFailure = true;
  const unavailable = await request("GET", "/api/connections/live-status");
  assert.equal(
    unavailable.json().find((item: any) => item.id === connectionId).status,
    "UNAVAILABLE",
  );
  statusFailure = false;
  for (const updated of [false, true]) {
    const r = await request("POST", `/api/connections/${connectionId}/webhook`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().updated, updated);
  }
  assert.equal(subscriptions[0].secret, secret);
  assert.equal(
    subscriptions[0].url,
    `https://api.example.test/api/webhooks/openwa/${workspaceId}`,
  );
  assert.deepEqual(subscriptions[0].events, [
    "message.sent",
    "message.received",
    "session.status",
    "session.disconnected",
  ]);
  assert.ok(
    calls.some(
      (c) => c.method === "PUT" && c.url.endsWith("/webhooks/subscription-1"),
    ),
  );
  const stopped = await request(
    "POST",
    `/api/connections/${connectionId}/stop`,
  );
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal(stopped.json().status, "DISCONNECTED");
  assert.equal(
    (await request("GET", "/api/connections/live-status"))
      .json()
      .find((item: any) => item.id === connectionId).status,
    "DISCONNECTED",
  );
  const restarted = await request(
    "POST",
    `/api/connections/${connectionId}/prepare-qr`,
  );
  assert.equal(restarted.json().status, "CONNECTED");
});

test("signed inbox survives app restart, deduplicates deliveries, ignores groups and unsupported inbound types and rejects foreign sessions", async () => {
  assert.equal((await webhook(event("CURSOIA"), "sha256=bad")).statusCode, 401);
  assert.equal(
    (await webhook({ ...event("CURSOIA"), sessionId: randomUUID() }))
      .statusCode,
    403,
  );
  for (const extra of [
    { isGroup: true },
    { chatId: "status@broadcast" },
    { type: "audio" },
  ])
    assert.equal(
      (await webhook(event("ignored", randomUUID(), extra))).json().ignored,
      true,
    );
  const message = event("CURSOIA");
  const first = await webhook(message);
  assert.equal(first.statusCode, 202, first.body);
  const repeat = await webhook({
    ...message,
    deliveryId: randomUUID(),
    idempotencyKey: randomUUID(),
  });
  assert.equal(repeat.json().id, first.json().id);
  assert.equal(
    await db.message.count({
      where: { workspaceId, conversation: { connectionId } },
    }),
    0,
  );
  await ctx.app.close();
  ctx = await buildApp(db, config, selector);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatch(workspaceId);
  await webhook(message);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatch(workspaceId);
  const c = await conversation();
  assert.equal(c.messages.filter((m) => m.direction === "IN").length, 1);
  assert.equal(sends().length, 1);
  assert.equal(sends()[0].headers["x-api-key"], "test-gateway");
  assert.equal(sends()[0].body.chatId, chatId);
  assert.equal(
    (
      await db.webhookInbox.findUniqueOrThrow({
        where: { id: first.json().id },
      })
    ).status,
    "DONE",
  );
});

test("strict mode bypasses model; automatic mode calls Responses SDK using approved PDF chunks and hooks/CTA", async () => {
  await db.product.update({
    where: { id: productId },
    data: { mode: "STRICT" },
  });
  await receive("¿Qué incluye el material del certificado?");
  assert.equal(aiCalls().length, 0);
  const asset = await saveAsset(
    db,
    storage,
    workspaceId,
    pdfFixture(`Unique fixture ${randomUUID()}`),
    "knowledge.pdf",
    "KNOWLEDGE",
  );
  await db.knowledgeDocument.create({
    data: {
      workspaceId,
      productId,
      assetId: asset.id,
      name: "knowledge.pdf",
      text: "El certificado del curso incluye ejercicios y una evaluación final.",
    },
  });
  await db.product.update({ where: { id: productId }, data: { mode: "AUTO" } });
  await receive("¿Qué incluye el certificado?");
  assert.equal(aiCalls().length, 1);
  const call = aiCalls()[0];
  assert.equal(call.headers.authorization, "Bearer test-openai");
  assert.equal(call.body.store, false);
  assert.equal(call.body.text.format.type, "json_schema");
  const facts = JSON.parse(call.body.input).facts;
  assert.ok(facts.some((f: any) => f.id === "hook"));
  assert.ok(facts.some((f: any) => f.id === "cta"));
  assert.equal(
    sends().at(-1)!.body.text,
    "El certificado del curso incluye ejercicios y una evaluación final.",
  );
  await db.product.update({
    where: { id: productId },
    data: { mode: "FLEXIBLE" },
  });
  await receive("Explicame los requisitos para comenzar");
  const flexible = JSON.parse(aiCalls().at(-1)!.body.input).facts;
  assert.ok(flexible.every((f: any) => !f.id.startsWith("doc-")));
  assert.ok(flexible.some((f: any) => f.question));
  aiFailure = true;
  await receive("Necesito orientación adicional");
  aiFailure = false;
  assert.ok(
    !sends().at(-1)!.body.text.includes("fixture authentication failure"),
  );
});

test("real media endpoint feeds existing receipt pause and manual approval delivers public link through OpenWA", async () => {
  await receive("quiero comprar");
  const delivery = await saveAsset(
    db,
    storage,
    workspaceId,
    pdfFixture(`Unique fixture ${randomUUID()}`),
    "delivery.pdf",
    "DELIVERY",
  );
  await db.product.update({
    where: { id: productId },
    data: { deliveryAssetId: delivery.id },
  });
  await receive("", {
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "receipt.pdf",
      omitted: true,
    },
  });
  let c = await conversation();
  assert.equal(c.paused, true);
  assert.equal(c.state, "REVIEW");
  assert.equal(c.payments.length, 1);
  assert.equal(c.payments[0].status, "PENDING");
  assert.ok(
    calls.some(
      (c) =>
        c.url.includes(encodeURIComponent(chatId)) && c.url.endsWith("/media"),
    ),
  );
  const count = aiCalls().length,
    sendCount = sends().length;
  await receive("¿Ya me entregan?");
  assert.equal(aiCalls().length, count);
  assert.equal(sends().length, sendCount);
  const approved = await request(
    "POST",
    `/api/payments/${c.payments[0].id}/review`,
    {
      expectedAssetId: c.payments[0].assetId,
      decision: "APPROVED",
      reason: "Validación manual de prueba",
    },
  );
  assert.equal(approved.statusCode, 200, approved.body);
  c = await conversation();
  assert.equal(c.state, "WON");
  assert.equal(c.payments[0].status, "APPROVED");
  assert.match(
    sends().at(-1)!.body.text,
    /https:\/\/api\.example\.test\/api\/deliveries\//,
  );
  const token = sends().at(-1)!.body.text.split("/api/deliveries/")[1];
  assert.equal(
    (await ctx.app.inject({ url: `/api/deliveries/${token}` })).statusCode,
    200,
  );
});

test("configured approval WhatsApp receives new receipt alerts and can approve by reply", async () => {
  const saved = await request("PUT", "/api/settings", {
    name: "Negocio de prueba",
    paymentAlias: "prueba.alias",
    paymentInstructions: "",
    approvalPhone: "+54 9 11 9998-7766",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().approvalPhone, "5491199987766");
  await receive("CURSOIA", { chatId: "5491100000091@c.us" });
  await receive("quiero comprar", { chatId: "5491100000091@c.us" });
  await receive("", {
    chatId: "5491100000091@c.us",
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "receipt.pdf",
      data: pdfFixture(`Unique fixture ${randomUUID()}`).toString("base64"),
    },
  });
  let payment = await db.payment.findFirstOrThrow({
    where: { workspaceId, conversation: { contact: "5491100000091@c.us" } },
  });
  const notice = sends().find(
    (send) =>
      send.body.chatId === "5491199987766@c.us" &&
      send.body.text.includes(`APROBAR ${payment.id}.${payment.assetId}`),
  );
  assert.ok(notice, "approval contact should receive the payment code");
  assert.ok(
    calls.some(
      (call) =>
        call.url.endsWith("/send-document") &&
        call.body.chatId === "5491199987766@c.us" &&
        call.body.filename === "receipt.pdf" &&
        call.body.base64.length > 0,
    ),
    "the original receipt should be forwarded to the approval contact",
  );

  const previous = payment;
  await receive("", {
    chatId: "5491100000091@c.us",
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "replacement.pdf",
      data: pdfFixture("replacement receipt").toString("base64"),
    },
  });
  payment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.notEqual(payment.assetId, previous.assetId);
  for (const assetId of [previous.assetId, payment.assetId]) {
    assert.ok(
      calls.some(
        (call) =>
          call.headers["idempotency-key"] ===
          `approval-notice:${payment.id}:${assetId}`,
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.headers["idempotency-key"] ===
          `approval-receipt:${payment.id}:${assetId}`,
      ),
    );
  }
  const stale = event(
    `APROBAR ${previous.id}.${previous.assetId}`,
    randomUUID(),
    {
      chatId: "5491199987766@c.us",
      from: "5491199987766@c.us",
    },
  );
  assert.equal((await webhook(stale)).statusCode, 202);
  await ctx.webhooks.process(workspaceId);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "PENDING",
  );
  const reply = event(
    `APROBAR ${payment.id}.${payment.assetId}`,
    randomUUID(),
    {
      chatId: "5491199987766@c.us",
      from: "5491199987766@c.us",
    },
  );
  const accepted = await webhook(reply);
  assert.equal(accepted.statusCode, 202, accepted.body);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatch(workspaceId);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "APPROVED",
  );
  assert.ok(
    sends().some(
      (send) =>
        send.body.chatId === "5491199987766@c.us" &&
        send.body.text.includes(`Pago ${payment.id} aprobado`),
    ),
  );

  await receive("CURSOIA", { chatId: "5491100000092@c.us" });
  await receive("quiero comprar", { chatId: "5491100000092@c.us" });
  await receive("", {
    chatId: "5491100000092@c.us",
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "receipt.pdf",
      data: pdfFixture(`Unique fixture ${randomUUID()}`).toString("base64"),
    },
  });
  const rejectedPayment = await db.payment.findFirstOrThrow({
    where: {
      workspaceId,
      conversation: { contact: "5491100000092@c.us" },
    },
  });
  const rejectReply = event(
    `RECHAZAR ${rejectedPayment.id}.${rejectedPayment.assetId} Comprobante ilegible`,
    randomUUID(),
    {
      chatId: "5491199987766@c.us",
      from: "5491199987766@c.us",
    },
  );
  assert.equal((await webhook(rejectReply)).statusCode, 202);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatch(workspaceId);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: rejectedPayment.id } }))
      .status,
    "REJECTED",
  );
  assert.ok(
    sends().some(
      (send) =>
        send.body.chatId === "5491100000092@c.us" &&
        send.body.text.includes("Comprobante ilegible"),
    ),
  );
});
test("ENTREGADO command records manual delivery without sending a second course to the customer", async () => {
  const customer = "5491100000057@c.us";
  await receive("CURSOIA", { chatId: customer });
  await receive("quiero comprar", { chatId: customer });
  await receive("", {
    chatId: customer,
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "receipt.pdf",
      data: pdfFixture("operator already delivered via WhatsApp").toString(
        "base64",
      ),
    },
  });
  const payment = await db.payment.findFirstOrThrow({
    where: { workspaceId, conversation: { contact: customer } },
  });
  // Process a real signed own-send envelope through the HTTP route.
  const own = event("Curso enviado por el operador", randomUUID(), {
    chatId: customer,
    fromMe: true,
  });
  own.event = "message.sent";
  assert.equal((await webhook(own)).statusCode, 202);
  const before = sends().filter((s) => s.body.chatId === customer).length;
  const command = event(
    `ENTREGADO ${payment.id}.${payment.assetId}`,
    randomUUID(),
    { chatId: "5491199987766@c.us", from: "5491199987766@c.us" },
  );
  assert.equal((await webhook(command)).statusCode, 202);
  await ctx.webhooks.process(workspaceId);
  await ctx.sales.dispatchBatch(workspaceId, 20);
  const approved = await db.payment.findUniqueOrThrow({
    where: { id: payment.id },
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.deliveryMode, "ALREADY_DELIVERED");
  assert.equal(
    sends().filter((s) => s.body.chatId === customer).length,
    before,
  );
  assert.equal(
    await db.delivery.count({ where: { paymentId: payment.id } }),
    0,
  );
});

test("disabling the WhatsApp approval notice keeps payments available for manual review", async () => {
  await db.product.update({
    where: { id: productId },
    data: { notifyApprovalByWhatsApp: false },
  });
  const before = calls.length;
  const customer = "5491100000093@c.us";
  await receive("CURSOIA", { chatId: customer });
  await receive("quiero comprar", { chatId: customer });
  await receive("", {
    chatId: customer,
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "receipt.pdf",
      data: pdfFixture(`Unique fixture ${randomUUID()}`).toString("base64"),
    },
  });
  const payment = await db.payment.findFirstOrThrow({
    where: { workspaceId, conversation: { contact: customer } },
  });
  assert.equal(payment.status, "PENDING");
  assert.ok(
    !calls
      .slice(before)
      .some(
        (call) =>
          ["/send-text", "/send-document"].some((path) =>
            call.url.endsWith(path),
          ) && call.body.chatId === "5491199987766@c.us",
      ),
  );
  const listed = (await request("GET", "/api/payments")).json();
  assert.ok(listed.some((item: any) => item.id === payment.id));
  const reviewed = await request("POST", `/api/payments/${payment.id}/review`, {
    expectedAssetId: payment.assetId,
    decision: "REJECTED",
    reason: "Comprobante de prueba ilegible",
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    "REJECTED",
  );
  await db.product.update({
    where: { id: productId },
    data: { notifyApprovalByWhatsApp: true },
  });
});

test("missing media pauses for humans, ambiguous send is not retried automatically", async () => {
  await receive("CURSOIA", { chatId: "5491100000001@lid" });
  mediaMissing = true;
  await receive("", {
    chatId: "5491100000001@lid",
    type: "image",
    media: { mimetype: "image/jpeg", omitted: true },
  });
  mediaMissing = false;
  const c = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: "5491100000001@lid" },
  });
  assert.equal(c.paused, true);
  assert.equal(c.state, "HUMAN");
  assert.equal(await db.payment.count({ where: { conversationId: c.id } }), 0);
  sendFailure = true;
  await receive("CURSOIA", { chatId: "5491100000002@c.us" });
  sendFailure = false;
  const out = await db.message.findFirstOrThrow({
    where: { workspaceId, status: "NEEDS_REVIEW" },
  });
  assert.equal(out.direction, "OUT");
  const count = sends().length;
  await ctx.sales.dispatch(workspaceId);
  assert.equal(sends().length, count);
});

test("simulation override never enables real integration even with saved credentials", async () => {
  const demo = await buildApp(db, { ...config, forceSimulation: true });
  try {
    const runtime = await demo.integrations.resolve(workspaceId);
    assert.equal(runtime.openwaEnabled, false);
    assert.equal(runtime.aiProvider, "rules");
  } finally {
    await demo.app.close();
  }
});

test("inline media and concurrent webhook deliveries/workers create one receipt and response", async () => {
  await receive("CURSOIA", { chatId: "5491100000003@c.us" });
  const mediaCalls = calls.filter((c) => c.url.endsWith("/media")).length;
  const payload = event("", randomUUID(), {
    chatId: "5491100000003@c.us",
    type: "document",
    media: {
      mimetype: "application/pdf",
      filename: "inline.pdf",
      data: pdfFixture(`Unique fixture ${randomUUID()}`).toString("base64"),
    },
  });
  const results = await Promise.all([
    webhook(payload),
    webhook(payload),
    webhook(payload),
  ]);
  for (const r of results) assert.equal(r.statusCode, 202, r.body);
  await Promise.all([
    ctx.webhooks.process(workspaceId),
    ctx.webhooks.process(workspaceId),
  ]);
  await ctx.sales.dispatch(workspaceId);
  const c = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: "5491100000003@c.us" },
    include: { payments: true, messages: true },
  });
  assert.equal(c.payments.length, 1);
  assert.equal(c.messages.length, 4);
  assert.equal(c.paused, true);
  assert.equal(
    calls.filter((c) => c.url.endsWith("/media")).length,
    mediaCalls,
  );
});

test("failed inbox retries are bounded and administrators can redrive after recovery", async () => {
  statusFailure = true;
  const response = await webhook({
    event: "session.status",
    sessionId,
    idempotencyKey: randomUUID(),
    data: { status: "disconnected" },
  });
  assert.equal(response.statusCode, 202, response.body);
  const id = response.json().id;
  for (let i = 0; i < 5; i++) {
    await db.webhookInbox.update({
      where: { id },
      data: { nextAttemptAt: new Date(0) },
    });
    await ctx.webhooks.process(workspaceId);
  }
  const failed = await db.webhookInbox.findUniqueOrThrow({ where: { id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.attempts, 5);
  assert.equal(
    (await request("POST", `/api/integrations/inbox/${id}/retry`)).statusCode,
    200,
  );
  statusFailure = false;
  await ctx.webhooks.process(workspaceId);
  assert.equal(
    (await db.webhookInbox.findUniqueOrThrow({ where: { id } })).status,
    "DONE",
  );
  // Current gateway state wins over an older event payload.
  assert.equal(
    (await db.connection.findUniqueOrThrow({ where: { id: connectionId } }))
      .status,
    "CONNECTED",
  );
});

test("new LID contacts resolve identity and keep their original routing id", async () => {
  const lid = "888888888888888@lid";
  await receive("CURSOIA", { chatId: lid });
  const c = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: lid },
  });
  assert.equal(c.contactName, "Cliente nuevo");
  assert.equal(c.contactPhone, "5491199998888");
  assert.equal(sends().at(-1)!.body.chatId, lid);
  const lookups = calls.filter((c) => c.url.includes("/contacts/")).length;
  await receive("Hola", { chatId: lid });
  const updated = await db.conversation.findUniqueOrThrow({
    where: { id: c.id },
  });
  assert.equal(updated.contactName, c.contactName);
  assert.equal(updated.contactPhone, c.contactPhone);
  assert.equal(
    calls.filter((c) => c.url.includes("/contacts/")).length,
    lookups,
  );
  assert.equal(
    await db.conversation.count({ where: { workspaceId, contact: lid } }),
    1,
  );
  assert.ok(
    calls.some(
      (c) =>
        c.url ===
          `/api/sessions/${sessionId}/contacts/${encodeURIComponent(lid)}/phone` &&
        c.method === "GET",
    ),
  );
});

test("unknown LID and failed contact lookup still register the new conversation without inventing a phone", async () => {
  const lid = "777777777777777@lid";
  await receive("CURSOIA", {
    chatId: lid,
    contact: { number: "777777777777777" },
  });
  const c = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: lid },
    include: { messages: true },
  });
  assert.equal(c.contactPhone, null);
  assert.equal(c.contactName, null);
  assert.equal(c.messages.length, 2);
  assert.equal(sends().at(-1)!.body.chatId, lid);
});

test("webhook identity and new phone contacts are stored separately and searchable through the inbox API", async () => {
  const before = calls.filter((c) => c.url.includes("/contacts/")).length;
  const entries = [
    {
      chatId: "666666666666666@lid",
      senderPhone: "5491188887777",
      contact: { pushName: "Contacto LID" },
    },
    { chatId: "5491177776666@c.us", contact: { name: "Contacto teléfono" } },
  ];
  for (const entry of entries) await receive("CURSOIA", entry);
  const response = await request("GET", "/api/conversations");
  assert.equal(response.statusCode, 200);
  const results = response
    .json()
    .filter((c: any) => entries.some((e) => e.chatId === c.contact));
  assert.equal(results.length, 2);
  assert.equal(
    results.find((c: any) => c.contact.endsWith("@lid")).contactPhone,
    "5491188887777",
  );
  assert.equal(
    results.find((c: any) => c.contact.endsWith("@c.us")).contactName,
    "Contacto teléfono",
  );
  assert.equal(
    calls.filter((c) => c.url.includes("/contacts/")).length,
    before,
  );
});

test("new accounts provision a scoped WhatsApp and retry failed webhooks without duplicate sessions", async () => {
  const admin = await db.membership.findFirstOrThrow({
    where: { workspaceId },
    include: { user: true },
  });
  const managed = await buildApp(
    db,
    {
      ...config,
      platformAdminEmail: admin.user.email,
      managedOpenwaAdminKey: "gateway-admin-test",
    },
    selector,
  );
  try {
    failManagedWebhook = true;
    const email = `managed-${randomUUID()}@example.com`;
    const created = await managed.app.inject({
      method: "POST",
      url: "/api/admin/accounts",
      headers,
      payload: {
        name: "Nuevo negocio",
        email,
        password: "clave-de-prueba-123",
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().whatsappPrepared, false);
    const newWorkspace = created.json().workspace.id;
    const provisionHeaders = { ...headers, "x-workspace-id": newWorkspace };
    const retries = await Promise.all(
      [1, 2].map(() =>
        managed.app.inject({
          method: "POST",
          url: "/api/connections/managed",
          headers: provisionHeaders,
          payload: {},
        }),
      ),
    );
    assert.ok(retries.every((r) => r.statusCode === 200));
    const session = managedSessions.filter(
      (s) => s.name === `nexo-managed-${newWorkspace}`,
    );
    assert.equal(session.length, 1);
    const keys = calls.filter(
      (c) =>
        c.url === "/api/auth/api-keys" &&
        c.body?.name === `Nexo ${newWorkspace}`,
    );
    assert.equal(keys.length, 1);
    assert.deepEqual(keys[0].body.allowedSessions, [session[0].id]);
    assert.equal(keys[0].body.role, "operator");
    const configured = await managed.app.inject({
      method: "GET",
      url: "/api/integrations/config",
      headers: provisionHeaders,
    });
    assert.equal(configured.json().managed, true);
    assert.equal(configured.body.includes("restricted-fixture-key"), false);
    const login = await managed.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "clave-de-prueba-123" },
    });
    const customer = {
      authorization: `Bearer ${login.json().token}`,
      "x-workspace-id": workspaceId,
    };
    assert.equal(
      (
        await managed.app.inject({
          method: "GET",
          url: "/api/connections",
          headers: customer,
        })
      ).statusCode,
      403,
    );
    const another = await managed.app.inject({
      method: "POST",
      url: "/api/admin/accounts",
      headers,
      payload: {
        name: "Otro negocio",
        email: `managed-${randomUUID()}@example.com`,
        password: "clave-de-prueba-123",
      },
    });
    assert.equal(another.statusCode, 200, another.body);
    assert.equal(another.json().whatsappPrepared, true);
    const otherSession = managedSessions.find(
      (s) => s.name === `nexo-managed-${another.json().workspace.id}`,
    );
    assert.ok(otherSession);
    assert.notEqual(otherSession.id, session[0].id);
  } finally {
    await managed.app.close();
  }
});

test("OpenAI understands an informal pack choice in strict mode without writing the quote", async () => {
  const created = await request("POST", "/api/products", {
    name: "Curso Flores semánticas",
    priceCents: 490000,
    mode: "STRICT",
    activationKeyword: "FLORESSEM",
    firstMessage: "Elegí el pack 1, 2 o 3.",
  });
  assert.equal(created.statusCode, 200, created.body);
  const productId = created.json().id;
  const packs = await request("PUT", `/api/products/${productId}/packs`, [
    {
      number: 1,
      name: "Flores",
      priceCents: 490000,
      summary: "Flores",
      deliveryMessage: "Entrega pack 1",
    },
    {
      number: 2,
      name: "Flores y llaveros",
      priceCents: 690000,
      summary: "Todo el Pack 1 y llaveros",
      deliveryMessage: "Entrega pack 2",
    },
    {
      number: 3,
      name: "Pack Navidad",
      priceCents: 990000,
      summary: "Todo el Pack 1 y Pack 2 más Navidad",
      deliveryMessage: "Entrega pack 3",
    },
  ]);
  assert.equal(packs.statusCode, 200, packs.body);
  const contact = `semantic-${randomUUID()}@c.us`;
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact,
    eventId: randomUUID(),
    text: "FLORESSEM",
  });
  const before = aiCalls().length;
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact,
    eventId: randomUUID(),
    text: "hola el 3 quiero",
  });
  const selected = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  assert.equal(selected.selectedPackNumber, 3);
  assert.equal(selected.quotedPriceCents, 990000);
  assert.match(selected.messages.at(-1)!.text, /9\.900/);
  assert.match(selected.messages.at(-1)!.text, /Alias:/);
  assert.equal(aiCalls().length, before + 1);
  const call = aiCalls().at(-1)!;
  assert.equal(call.body.store, false);
  assert.equal(call.body.text.format.name, "pack_intent");
  assert.equal(JSON.parse(call.body.input).message, "hola el 3 quiero");

  const other = `semantic-negated-${randomUUID()}@c.us`;
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact: other,
    eventId: randomUUID(),
    text: "FLORESSEM",
  });
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact: other,
    eventId: randomUUID(),
    text: "no quiero el 3",
  });
  const negated = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: other },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  assert.equal(negated.selectedPackNumber, null);
  assert.doesNotMatch(negated.messages.at(-1)!.text, /Alias:/);
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact: other,
    eventId: randomUUID(),
    text: "¿cuánto sale el de Navidad?",
  });
  const askedPrice = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact: other },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  assert.equal(askedPrice.selectedPackNumber, null);
  assert.match(askedPrice.messages.at(-1)!.text, /9\.900/);
  assert.doesNotMatch(askedPrice.messages.at(-1)!.text, /Alias:/);
});

test("a new WhatsApp lead receives three separate campaign messages in order without replying", async () => {
  const workspace = await db.workspace.create({
    data: { name: "Campaña de mensajes seguidos" },
  });
  await ctx.integrations.save(workspace.id, savedConfig);
  const session = randomUUID();
  const connection = await db.connection.create({
    data: {
      workspaceId: workspace.id,
      name: "Prueba de envío",
      provider: "OPENWA",
      sessionId: session,
      status: "CONNECTED",
    },
  });
  const product = await db.product.create({
    data: {
      workspaceId: workspace.id,
      name: "Curso de prueba",
      priceCents: 10000,
      firstMessage: "Bienvenida",
      followUpMessages: ["Mensaje corto 1", "Mensaje corto 2"],
    },
  });
  await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      productId: product.id,
      name: "Campaña",
      code: "TRIPLE",
    },
  });
  const contact = `campaign-${randomUUID()}@c.us`;
  await ctx.sales.receive(workspace.id, {
    connectionId: connection.id,
    contact,
    eventId: randomUUID(),
    text: "TRIPLE",
  });
  await ctx.sales.dispatchBatch(workspace.id);
  const sent = calls.filter(
    (call) => call.url.includes(session) && call.url.endsWith("/send-text"),
  );
  assert.deepEqual(
    sent.map((call) => call.body.text),
    ["Bienvenida", "Mensaje corto 1", "Mensaje corto 2"],
  );
  const messages = await db.message.findMany({
    where: { workspaceId: workspace.id, direction: "OUT" },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    messages.map((message) => message.status),
    ["SENT", "SENT", "SENT"],
  );

  const failedContact = `campaign-failed-${randomUUID()}@c.us`;
  await ctx.sales.receive(workspace.id, {
    connectionId: connection.id,
    contact: failedContact,
    eventId: randomUUID(),
    text: "TRIPLE",
  });
  sendFailure = true;
  try {
    await ctx.sales.dispatchBatch(workspace.id);
  } finally {
    sendFailure = false;
  }
  const failed = await db.conversation.findFirstOrThrow({
    where: { workspaceId: workspace.id, contact: failedContact },
    include: {
      messages: { where: { direction: "OUT" }, orderBy: { createdAt: "asc" } },
    },
  });
  assert.deepEqual(
    failed.messages.map((message) => message.status),
    ["NEEDS_REVIEW", "PENDING", "PENDING"],
  );
  const attempts = calls.filter(
    (call) => call.url.includes(session) && call.url.endsWith("/send-text"),
  ).length;
  await ctx.sales.dispatchBatch(workspace.id);
  assert.equal(
    calls.filter(
      (call) => call.url.includes(session) && call.url.endsWith("/send-text"),
    ).length,
    attempts,
  );
});

test("photo outbox uses send-image once and ambiguous failures require review", async () => {
  const workspace = await db.workspace.create({
    data: { name: "Isolated image outbox" },
  });
  const workspaceId = workspace.id;
  await ctx.integrations.save(workspaceId, savedConfig);
  const connection = await db.connection.create({
    data: {
      workspaceId,
      name: "Photo connection",
      provider: "OPENWA",
      sessionId: randomUUID(),
      status: "CONNECTED",
    },
  });
  const connectionId = connection.id;
  const asset = await saveAsset(
    db,
    storage,
    workspaceId,
    imageFixture(),
    "photo.png",
    "RESPONSE_IMAGE",
  );
  const product = await db.product.create({
    data: {
      workspaceId,
      name: "Gateway photo fixture",
      priceCents: 100,
      firstMessage: "Course photo",
      firstImageId: asset.id,
    },
  });
  await db.campaign.create({
    data: {
      workspaceId,
      productId: product.id,
      name: "Photo test",
      code: "GATEWAYPHOTO",
    },
  });
  const contact = "5491100000099@c.us";
  await ctx.sales.receive(workspaceId, {
    connectionId,
    contact,
    eventId: randomUUID(),
    text: "GATEWAYPHOTO",
  });
  await ctx.sales.dispatch(workspaceId);
  const images = () =>
    calls.filter(
      (call) =>
        call.url.endsWith("/send-image") && call.body.chatId === contact,
    );
  assert.equal(images().length, 1);
  assert.equal(images()[0].body.base64, imageFixture().toString("base64"));
  assert.equal(images()[0].body.caption, "Course photo");
  const c = await db.conversation.findFirstOrThrow({
    where: { workspaceId, contact },
  });
  const message = await db.message.findFirstOrThrow({
    where: { conversationId: c.id, direction: "OUT" },
  });
  await ctx.sales.observeOwnMessage(workspaceId, connectionId, {
    id: message.providerMessageId!,
    chatId: contact,
    type: "image",
    body: "Course photo",
  });
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: c.id } }))
      .humanControlled,
    false,
  );
  await ctx.sales.dispatch(workspaceId);
  assert.equal(images().length, 1);
  await ctx.sales.human(workspaceId, c.id, "Another photo", false, asset.id);
  sendFailure = true;
  try {
    await ctx.sales.dispatch(workspaceId);
  } finally {
    sendFailure = false;
  }
  const failed = await db.message.findFirstOrThrow({
    where: { conversationId: c.id, origin: "HUMAN" },
  });
  assert.equal(failed.status, "NEEDS_REVIEW");
  await ctx.sales.dispatch(workspaceId);
  assert.equal(images().length, 2);
});

test("live cutoff preserves old queues and disables payment automation while new WhatsApp replies work", async () => {
  const user = await seed(
    db,
    `go-live-${randomUUID()}@nexo.local`,
    "go-live-fixture-password",
  );
  const workspaceId = user.workspaceId;
  const cutoff = new Date(Date.now() - 1000);
  config.preview = false;
  config.automationCutoffAt = cutoff;
  config.paymentAutomationEnabled = false;
  await ctx.integrations.save(workspaceId, {
    ...savedConfig,
    aiProvider: "rules",
    openaiKey: undefined,
  });
  const product = await db.product.findFirstOrThrow({
    where: { workspaceId },
  });
  const connection = await db.connection.create({
    data: {
      workspaceId,
      name: "Go-live fixture",
      provider: "OPENWA",
      sessionId: randomUUID(),
      status: "CONNECTED",
    },
  });
  const contact = "5491100000101@c.us";
  const oldContact = "5491100000102@c.us";
  await db.conversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      productId: product.id,
      contact,
      state: "QUALIFIED",
    },
  });
  const oldConversation = await db.conversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      productId: product.id,
      contact: oldContact,
      state: "QUALIFIED",
    },
  });
  const oldMessage = await db.message.create({
    data: {
      workspaceId,
      conversationId: oldConversation.id,
      externalId: `old-pending-${randomUUID()}`,
      direction: "OUT",
      origin: "HUMAN",
      status: "PENDING",
      text: "Mensaje histórico pendiente",
      createdAt: new Date(cutoff.getTime() - 60_000),
    },
  });
  const oldWebhook = await db.webhookInbox.create({
    data: {
      id: randomUUID(),
      workspaceId,
      connectionId: connection.id,
      payload: {
        event: "message.received",
        data: { id: "old-webhook", body: "mensaje antiguo" },
      },
      status: "PENDING",
      createdAt: new Date(cutoff.getTime() - 60_000),
    },
  });
  const asset = await db.asset.create({
    data: {
      workspaceId,
      originalName: "old-receipt.pdf",
      mime: "application/pdf",
      path: join(storage, "old-receipt.pdf"),
      size: 1,
      purpose: "RECEIPT",
    },
  });
  const oldPayment = await db.payment.create({
    data: {
      workspaceId,
      conversationId: oldConversation.id,
      assetId: asset.id,
      receiptMode: "AUTO_RECEIPT",
      receiptCheckStatus: "NOT_RUN",
    },
  });

  await ctx.webhooks.process(workspaceId);
  await ctx.sales.verifyPendingReceipts(workspaceId);
  assert.equal(
    (await db.webhookInbox.findUniqueOrThrow({ where: { id: oldWebhook.id } }))
      .status,
    "PENDING",
  );
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: oldMessage.id } }))
      .status,
    "PENDING",
  );
  assert.equal(
    (
      await db.payment.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: oldPayment.id } },
      })
    ).receiptCheckStatus,
    "NOT_RUN",
  );

  await ctx.sales.receive(workspaceId, {
    connectionId: connection.id,
    eventId: randomUUID(),
    contact,
    text: "quiero comprar",
  });
  await ctx.sales.dispatch(workspaceId);

  const updatedConversation = await db.conversation.findUniqueOrThrow({
    where: {
      workspaceId_connectionId_contact: {
        workspaceId,
        connectionId: connection.id,
        contact,
      },
    },
  });
  assert.ok(updatedConversation);
  assert.equal(updatedConversation.humanControlled, true);
  assert.equal(updatedConversation.state, "HUMAN");
  assert.equal(
    await db.payment.count({ where: { workspaceId, status: "PENDING" } }),
    1,
  );
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: oldMessage.id } }))
      .status,
    "PENDING",
  );
  const customerReplies = calls
    .filter(
      (call) =>
        call.url.endsWith("/send-text") && call.body.chatId === contact,
    )
    .map((call) => call.body.text);
  assert.ok(customerReplies.length >= 1);
  assert.ok(customerReplies.some((text) => text.includes("desactivados")));
  assert.ok(
    customerReplies.every(
      (text) => !text.includes("demo.nexo.ventas") && !text.includes("alias"),
    ),
  );
});
