import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { startLocalDb } from "../../../scripts/local-db.js";
import { seed } from "../../../packages/database/src/seed.js";

// This test uses a new in-memory database and dummy files, never the local demo.
test(
  "Railway preview starts on one origin and cannot process queued or direct writes",
  { timeout: 60000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexo-preview-"));
    const local = await startLocalDb(55437);
    const db = new PrismaClient({ datasources: { db: { url: local.url } } });
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await mkdir(join(dir, "assets"));
      await writeFile(
        join(dir, "index.html"),
        '<html><script type="module" src="/assets/app-fixture.js"></script></html>',
      );
      await writeFile(
        join(dir, "assets", "app-fixture.js"),
        "console.log('fixture')",
      );
      const builtWeb = resolve("apps/web/dist");
      const webDir = existsSync(join(builtWeb, "index.html")) ? builtWeb : dir;
      const { workspaceId } = await seed(
        db,
        "preview@example.test",
        "fixture-password",
      );
      const connection = await db.connection.findFirstOrThrow({
        where: { workspaceId },
      });
      const product = await db.product.findFirstOrThrow({
        where: { workspaceId },
      });
      const conversation = await db.conversation.create({
        data: {
          workspaceId,
          connectionId: connection.id,
          contact: "fixture@c.us",
          productId: product.id,
        },
      });
      await db.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          externalId: "preview-pending",
          direction: "OUT",
          status: "PENDING",
          text: "No enviar",
        },
      });
      const asset = await db.asset.create({
        data: {
          workspaceId,
          path: join(dir, "fixture.pdf"),
          purpose: "RECEIPT",
          originalName: "fixture.pdf",
          mime: "application/pdf",
          size: 1,
        },
      });
      const payment = await db.payment.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          assetId: asset.id,
          receiptMode: "AUTO_RECEIPT",
          receiptCheckStatus: "NOT_RUN",
        },
      });
      await db.$disconnect();
      const probe = createServer();
      await new Promise<void>((resolve) =>
        probe.listen(0, "127.0.0.1", resolve),
      );
      const port = (probe.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        NEXO_PREVIEW: "false",
        NEXO_REQUIRE_PREVIEW: "true",
        FORCE_SIMULATION: "false",
        OPENWA_ENABLED: "true",
        DATABASE_URL: local.url,
        JWT_SECRET: "preview-test-only-secret-at-least-32-characters",
        STORAGE_DIR: dir,
        NEXO_WEB_DIST: webDir,
        PORT: String(port),
      };
      for (const key of [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "ComSpec",
        "TEMP",
        "TMP",
      ])
        if (process.env[key]) env[key] = process.env[key];
      child = spawn(
        process.execPath,
        ["--import", "tsx", "apps/api/src/preview-server.ts"],
        { env, cwd: process.cwd(), windowsHide: true, stdio: "ignore" },
      );
      const root = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null)
          throw new Error(`Preview exited ${child.exitCode}`);
        try {
          if ((await fetch(`${root}/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, "Preview did not start");
      assert.deepEqual(await (await fetch(`${root}/health`)).json(), {
        status: "ok",
      });
      const html = await (await fetch(root)).text();
      const assetPath = html.match(/src="(\/assets\/[^"?]+\.js)"/)?.[1];
      assert.ok(
        assetPath,
        "El panel debe cargar JavaScript desde el mismo origen",
      );
      assert.equal((await fetch(`${root}${assetPath}`)).status, 200);
      assert.equal((await fetch(`${root}/assets/missing.js`)).status, 404);
      const login = await fetch(`${root}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "preview@example.test",
          password: "fixture-password",
        }),
      });
      assert.equal(login.status, 200);
      const token = ((await login.json()) as { token: string }).token;
      const headers = {
        authorization: `Bearer ${token}`,
        "x-workspace-id": workspaceId,
        "content-type": "application/json",
      };
      for (const [method, path] of [
        ["POST", `/api/payments/${payment.id}/review`],
        ["POST", `/api/conversations/${conversation.id}/human`],
        ["POST", "/api/simulator/messages"],
        ["POST", `/api/webhooks/openwa/${workspaceId}`],
        ["PUT", "/api/integrations/config"],
        ["GET", "/api/connections/live-status"],
      ]) {
        const response = await fetch(root + path, {
          method,
          headers,
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        assert.equal(response.status, 403, `${method} ${path}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3600));
      const conversationResponse = await fetch(
        `${root}/api/conversations/${conversation.id}`,
        { headers },
      );
      const chat = (await conversationResponse.json()) as {
        messages: { status: string }[];
        payments: { status: string; receiptCheckStatus: string }[];
      };
      assert.equal(chat.messages[0].status, "PENDING");
      assert.equal(chat.payments[0].status, "PENDING");
      assert.equal(chat.payments[0].receiptCheckStatus, "NOT_RUN");
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await new Promise<void>((resolve) =>
          child!.once("exit", () => resolve()),
        );
      }
      await db.$disconnect();
      await local.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
