import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { seed } from "../../../packages/database/src/seed.js";
import { startLocalDb } from "../../../scripts/local-db.js";

const sessions: any[] = [];
const subscriptions: any[] = [];
const gateway = createServer(async (req, res) => {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  const body = Buffer.concat(parts).length
    ? JSON.parse(Buffer.concat(parts).toString())
    : undefined;
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/sessions" && req.method === "GET")
    return res.end(JSON.stringify(sessions));
  if (req.url === "/api/sessions" && req.method === "POST") {
    const session = { id: randomUUID(), name: body.name, status: "created" };
    sessions.push(session);
    return res.end(JSON.stringify(session));
  }
  if (req.url === "/api/auth/api-keys" && req.method === "POST")
    return res.end(JSON.stringify({ id: randomUUID(), apiKey: "scoped-fixture-key" }));
  if (req.url?.endsWith("/webhooks") && req.method === "GET")
    return res.end(JSON.stringify(subscriptions));
  if (req.url?.endsWith("/webhooks") && req.method === "POST") {
    const item = { id: "setup-hook", ...body };
    subscriptions.push(item);
    return res.end(JSON.stringify(item));
  }
  if (req.url?.endsWith("/start") && req.method === "POST") {
    sessions[0].status = "qr_ready";
    return res.end(JSON.stringify({ id: sessions[0].id, status: "qr_ready" }));
  }
  if (req.url?.endsWith("/qr"))
    return res.end(JSON.stringify({ qrCode: "data:image/png;base64,fixture" }));
  if (req.url?.startsWith("/api/sessions/") && req.method === "GET")
    return res.end(JSON.stringify({ id: sessions[0].id, status: sessions[0].status }));
  res.statusCode = 404;
  return res.end(JSON.stringify({ error: "not found" }));
});

let db: PrismaClient;
let local: Awaited<ReturnType<typeof startLocalDb>>;
let ctx: Awaited<ReturnType<typeof buildApp>>;
let workspaceId: string;
let adminHeaders: Record<string, string>;
let memberHeaders: Record<string, string>;
let gatewayUrl: string;

before(async () => {
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  local = await startLocalDb(55438);
  db = new PrismaClient({ datasources: { db: { url: local.url } } });
  const admin = await seed(db, "admin@nexo.local", "setup-test-password");
  workspaceId = admin.workspaceId;
  const member = await seed(db, "member@nexo.local", "member-test-password");
  await db.membership.create({
    data: { userId: member.userId, workspaceId, role: "ADMIN" },
  });
  const config: Config = {
    jwtSecret: "setup-test-jwt-secret-with-at-least-32-characters",
    storageDir: ".data/private",
    publicUrl: "https://nexo.example.test",
    openwaWebhookBaseUrl: "http://nexo.railway.internal:8080",
    webOrigin: "http://localhost:5173",
    aiProvider: "rules",
    openaiModel: "gpt-4.1-mini",
    openwaEnabled: false,
    openwaUrl: gatewayUrl,
    openwaKey: "",
    webhookSecret: "",
    preview: true,
    openwaSetupMode: true,
    forceSimulation: true,
    platformAdminEmail: "admin@nexo.local",
    managedOpenwaAdminKey: "fixture-master-key",
  };
  ctx = await buildApp(db, config);
  for (const [email, password, target] of [
    ["admin@nexo.local", "setup-test-password", "admin"],
    ["member@nexo.local", "member-test-password", "member"],
  ] as const) {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = {
      authorization: `Bearer ${login.json().token}`,
      "x-workspace-id": workspaceId,
    };
    if (target === "admin") adminHeaders = headers;
    else memberHeaders = headers;
  }
});

after(async () => {
  await ctx?.app.close();
  await db?.$disconnect();
  await local?.close();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

test("OpenWA setup replaces disabled legacy credentials, preserves old rows and provisions QR", async () => {
  const unauthenticated = await ctx.app.inject({
    method: "POST",
    url: "/api/connections/managed",
    headers: { "x-workspace-id": workspaceId },
  });
  assert.equal(unauthenticated.statusCode, 401);
  const nonPlatformAdmin = await ctx.app.inject({
    method: "GET",
    url: "/api/connections/live-status",
    headers: memberHeaders,
  });
  assert.equal(nonPlatformAdmin.statusCode, 403);
  const deniedProvision = await ctx.app.inject({
    method: "POST",
    url: "/api/connections/managed",
    headers: memberHeaders,
  });
  assert.equal(deniedProvision.statusCode, 403);

  await ctx.integrations.save(workspaceId, {
    openwaEnabled: false,
    openwaUrl: gatewayUrl,
    aiProvider: "rules",
    openaiModel: "gpt-4.1-mini",
    publicUrl: "https://nexo.example.test",
    openwaKey: "legacy-local-key",
  });
  const legacyRows = await db.connection.createMany({
    data: ["legacy-session-one", "legacy-session-two"].map((sessionId) => ({
      workspaceId,
      name: `Imported ${sessionId}`,
      provider: "OPENWA",
      sessionId,
      status: "DISCONNECTED",
    })),
  });
  assert.equal(legacyRows.count, 2);

  const created = await ctx.app.inject({
    method: "POST",
    url: "/api/connections/managed",
    headers: adminHeaders,
  });
  assert.equal(created.statusCode, 200, created.body);
  const repaired = await ctx.integrations.view(workspaceId);
  assert.equal(repaired.openwaEnabled, true);
  assert.equal(repaired.hasOpenwaKey, true);
  assert.equal(repaired.managed, true);
  assert.equal(typeof repaired.managedSessionId, "string");
  const remainingLegacy = await db.connection.findMany({
    where: { workspaceId, sessionId: { startsWith: "legacy-session-" } },
    orderBy: { sessionId: "asc" },
  });
  assert.equal(remainingLegacy.length, 2);
  assert.deepEqual(
    remainingLegacy.map((row) => row.status),
    ["DISCONNECTED", "DISCONNECTED"],
  );
  assert.deepEqual(subscriptions[0].events, ["session.status", "session.disconnected"]);
  assert.equal(subscriptions[0].url, `http://nexo.railway.internal:8080/api/webhooks/openwa/${workspaceId}`);
  const connection = await db.connection.findFirstOrThrow({
    where: { workspaceId, name: "WhatsApp del negocio" },
  });

  const qr = await ctx.app.inject({
    method: "POST",
    url: `/api/connections/${connection.id}/prepare-qr`,
    headers: adminHeaders,
  });
  assert.equal(qr.statusCode, 200, qr.body);
  assert.equal(qr.json().status, "QR_READY");
  assert.equal(qr.json().qr, "data:image/png;base64,fixture");
  const live = await ctx.app.inject({
    method: "GET",
    url: "/api/connections/live-status",
    headers: adminHeaders,
  });
  assert.equal(live.statusCode, 200, live.body);

  const settings = await ctx.integrations.resolve(workspaceId);
  const event = {
    event: "message.received",
    timestamp: new Date().toISOString(),
    sessionId: connection.sessionId,
    idempotencyKey: randomUUID(),
    deliveryId: randomUUID(),
    data: { id: randomUUID(), chatId: "5491112345678@c.us", body: "hola", type: "chat", fromMe: false },
  };
  const raw = JSON.stringify(event);
  const ignored = await ctx.app.inject({
    method: "POST",
    url: `/api/webhooks/openwa/${workspaceId}`,
    payload: raw,
    headers: {
      "content-type": "application/json",
      "x-openwa-signature": `sha256=${createHmac("sha256", settings.webhookSecret).update(raw).digest("hex")}`,
    },
  });
  assert.equal(ignored.statusCode, 200, ignored.body);
  assert.equal(ignored.json().reason, "setup_mode");
  assert.equal(await db.webhookInbox.count({ where: { workspaceId } }), 0);
  assert.equal(await db.message.count({ where: { workspaceId } }), 0);

  const deniedPayment = await ctx.app.inject({
    method: "POST",
    url: "/api/payments/not-a-real-payment/review",
    headers: adminHeaders,
    payload: {},
  });
  assert.equal(deniedPayment.statusCode, 403);
});
