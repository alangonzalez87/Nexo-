import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { PrismaClient } from "@nexo/database";
import type { Config } from "../src/config.js";
import { IntegrationSettings } from "../src/integrations.js";
import { registerIntegrationRoutes } from "../src/routes/integrations.js";
import { registerAssetRoutes } from "../src/routes/assets.js";
import { HttpError, sha256 } from "../src/security.js";

const config: Config = {
  jwtSecret: "cleanup-test-only-secret-with-at-least-32-characters",
  storageDir: "unused",
  publicUrl: "https://app.example.test",
  webOrigin: "https://web.example.test",
  aiProvider: "rules",
  openaiModel: "fixture-model",
  openwaEnabled: false,
  openwaUrl: "https://gateway.example.test",
  openwaKey: "",
  webhookSecret: "",
};

test("legacy encrypted settings retain active credentials and drop retired fields on save", async () => {
  const workspaceId = "fixture-workspace";
  const key = createHash("sha256").update(config.jwtSecret).digest();
  const iv = Buffer.alloc(12, 1);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(workspaceId));
  const input = {
    openwaEnabled: false,
    openwaUrl: config.openwaUrl,
    publicUrl: config.publicUrl,
    aiProvider: "rules",
    openaiKey: "fixture-private-key",
    retiredProviderToken: "retired-fixture-key",
    automaticOwnMessages: ["Automatic greeting"],
  };
  const data = Buffer.concat([
    cipher.update(JSON.stringify(input)),
    cipher.final(),
  ]);
  let encrypted = [iv, cipher.getAuthTag(), data]
    .map((value) => value.toString("base64"))
    .join(".");
  const db = {
    integrationConfig: {
      findUnique: async () => ({ encrypted }),
      upsert: async (args: { update: { encrypted: string } }) => {
        encrypted = args.update.encrypted;
      },
    },
    webhookInbox: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const settings = new IntegrationSettings(db, config);
  const resolved = await settings.resolve(workspaceId);
  assert.equal(resolved.openaiKey, "fixture-private-key");
  assert.equal(
    resolved.openaiModel,
    config.openaiModel,
    "missing legacy fields retain defaults",
  );
  assert.equal("retiredProviderToken" in resolved, false);
  const view = await settings.save(workspaceId, {
    ...input,
    openaiKey: undefined,
    openaiModel: config.openaiModel,
  });
  assert.equal(view.hasOpenaiKey, true);
  assert.deepEqual(view.automaticOwnMessages, ["Automatic greeting"]);
  assert.equal("openaiKey" in view, false);
  assert.ok(!encrypted.includes("fixture-private-key"));
  const [savedIv, tag, payload] = encrypted
    .split(".")
    .map((value) => Buffer.from(value, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, savedIv);
  decipher.setAAD(Buffer.from(workspaceId));
  decipher.setAuthTag(tag);
  const saved = JSON.parse(
    Buffer.concat([decipher.update(payload), decipher.final()]).toString(),
  );
  assert.equal(saved.openaiKey, "fixture-private-key");
  assert.deepEqual(saved.automaticOwnMessages, ["Automatic greeting"]);
  const unchanged = await settings.save(workspaceId, {
    ...input,
    automaticOwnMessages: undefined,
    openaiModel: config.openaiModel,
  });
  assert.deepEqual(unchanged.automaticOwnMessages, ["Automatic greeting"]);
  await settings.saveManaged(workspaceId, "managed-fixture-key");
  assert.deepEqual((await settings.view(workspaceId)).automaticOwnMessages, [
    "Automatic greeting",
  ]);
  const cleared = await settings.save(workspaceId, {
    ...input,
    automaticOwnMessages: [],
    openaiModel: config.openaiModel,
  });
  assert.deepEqual(cleared.automaticOwnMessages, []);
  assert.equal("retiredProviderToken" in saved, false);
});

test("integration module registers only its seven active endpoints", async () => {
  const app = Fastify();
  const routes: string[] = [];
  app.addHook("onRoute", (route) => {
    if (route.method !== "HEAD") routes.push(`${route.method} ${route.url}`);
  });
  const db = {} as PrismaClient;
  registerIntegrationRoutes(app, {
    db,
    integrations: new IntegrationSettings(db, config),
    scope: async () => "fixture",
  });
  try {
    await app.ready();
    assert.deepEqual(
      routes.sort(),
      [
        "GET /api/integrations/events",
        "GET /api/integrations/config",
        "PUT /api/integrations/config",
        "POST /api/integrations/test-openai",
        "POST /api/integrations/test-receipt",
        "GET /api/integrations/inbox",
        "POST /api/integrations/inbox/:id/retry",
      ].sort(),
    );
  } finally {
    await app.close();
  }
});

test("download helper retains authorization, token checks and attachment headers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cleanup-fixture-"));
  const path = join(dir, "attachment.txt");
  await writeFile(path, "fixture bytes");
  const app = Fastify();
  const token = "a".repeat(48);
  let status = "APPROVED";
  let expiresAt = new Date(Date.now() + 60000);
  let assetReads = 0;
  const db = {
    asset: {
      findUniqueOrThrow: async (query: {
        where: { workspaceId_id: { workspaceId: string; id: string } };
      }) => {
        assetReads++;
        assert.deepEqual(query.where.workspaceId_id, {
          workspaceId: "fixture",
          id: "asset",
        });
        return { path, mime: "text/plain", originalName: "archivo ñ.txt" };
      },
    },
    delivery: {
      findUnique: async (query: { where: { tokenHash: string } }) => {
        if (query.where.tokenHash !== sha256(token)) return null;
        return {
          workspaceId: "fixture",
          assetId: "asset",
          expiresAt,
          payment: { status },
        };
      },
    },
  } as unknown as PrismaClient;
  registerAssetRoutes(app, {
    db,
    config,
    scope: async (req) => {
      if (req.headers["x-workspace-id"] !== "fixture")
        throw new HttpError(403, "Denied");
      return "fixture";
    },
  });
  try {
    assert.equal((await app.inject("/api/assets/asset")).statusCode, 403);
    assert.equal(assetReads, 0);
    const internal = await app.inject({
      url: "/api/assets/asset",
      headers: { "x-workspace-id": "fixture" },
    });
    assert.equal(internal.statusCode, 200);
    assert.equal(internal.body, "fixture bytes");
    assert.equal(internal.headers["cache-control"], "no-store");
    assert.equal(internal.headers["x-content-type-options"], "nosniff");
    assert.equal(
      internal.headers["content-disposition"],
      "attachment; filename*=UTF-8''archivo%20%C3%B1.txt",
    );
    assert.equal(internal.headers["referrer-policy"], undefined);
    const publicDownload = await app.inject(`/api/deliveries/${token}`);
    assert.equal(publicDownload.statusCode, 200);
    assert.equal(publicDownload.headers["referrer-policy"], "no-referrer");
    assert.equal(publicDownload.body, "fixture bytes");
    status = "REJECTED";
    assert.equal(
      (await app.inject(`/api/deliveries/${token}`)).statusCode,
      404,
    );
    status = "APPROVED";
    expiresAt = new Date(0);
    assert.equal(
      (await app.inject(`/api/deliveries/${token}`)).statusCode,
      404,
    );
    assert.equal(
      (await app.inject(`/api/deliveries/${"b".repeat(48)}`)).statusCode,
      404,
    );
    assert.equal(assetReads, 2, "invalid deliveries must not access assets");
  } finally {
    await app.close();
    await unlink(path);
    await rmdir(dir);
  }
});
