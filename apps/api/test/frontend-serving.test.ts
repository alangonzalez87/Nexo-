import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@nexo/database";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

test("frontend is served in preview and production without weakening API auth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-web-serving-"));
  const previousWebDist = process.env.NEXO_WEB_DIST;
  try {
    await mkdir(join(dir, "assets"));
    await writeFile(
      join(dir, "index.html"),
      '<!doctype html><html><body>login fixture</body><script type="module" src="/assets/app-fixture.js"></script></html>',
    );
    await writeFile(join(dir, "assets", "app-fixture.js"), "fixture asset");
    process.env.NEXO_WEB_DIST = dir;

    const db = {
      user: { findUnique: async () => null },
    } as unknown as PrismaClient;
    const config: Config = {
      jwtSecret: "web-serving-test-secret-at-least-thirty-two-characters",
      storageDir: dir,
      publicUrl: "https://nexo.example.test",
      webOrigin: "https://nexo.example.test",
      aiProvider: "rules",
      openaiModel: "gpt-4.1-mini",
      openwaEnabled: false,
      openwaUrl: "http://127.0.0.1:2785",
      openwaKey: "",
      webhookSecret: "",
    };

    for (const preview of [true, false]) {
      const { app } = await buildApp(db, { ...config, preview });
      try {
        const page = await app.inject({ method: "GET", url: "/" });
        assert.equal(page.statusCode, 200);
        assert.match(page.headers["content-type"] || "", /text\/html/);
        assert.match(page.body, /login fixture/);
        assert.equal(
          (
            await app.inject({ method: "GET", url: "/assets/app-fixture.js" })
          ).statusCode,
          200,
        );
        assert.equal(
          (await app.inject({ method: "GET", url: "/assets/missing.js" }))
            .statusCode,
          404,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/auth/login",
              payload: { email: "missing@example.test", password: "wrong" },
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (await app.inject({ method: "GET", url: "/api/overview" }))
            .statusCode,
          401,
        );
      } finally {
        await app.close();
      }
    }
  } finally {
    if (previousWebDist === undefined) delete process.env.NEXO_WEB_DIST;
    else process.env.NEXO_WEB_DIST = previousWebDist;
    await rm(dir, { recursive: true, force: true });
  }
});
