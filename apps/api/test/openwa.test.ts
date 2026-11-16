import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenWAAdapter } from "../src/messaging.js";
import type { Config } from "../src/config.js";
import type { Connection } from "@nexo/database";
import { imageFixture } from "./image-fixture.js";
test("OpenWA HTTP contract uses verified paths, API key, QR response and stable send key", async () => {
  const calls: { url: string; method: string; body: any; headers: any }[] = [];
  let ready = false,
    created = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    calls.push({
      url: req.url!,
      method: req.method!,
      body,
      headers: req.headers,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/qr"))
      res.end(
        JSON.stringify({
          qrCode: "data:image/png;base64,cXI=",
          status: "qr_ready",
        }),
      );
    else if (req.url === "/api/sessions" && req.method === "POST") {
      res.statusCode = 201;
      res.end(
        JSON.stringify({
          id: "12345678-1234-1234-1234-123456789abc",
          name: body?.name,
          status: "created",
        }),
      );
    } else if (
      req.url?.endsWith("/send-text") ||
      req.url?.endsWith("/send-image")
    ) {
      res.statusCode = 201;
      res.end(
        JSON.stringify({ messageId: "wa-confirmed-id", timestamp: 12345 }),
      );
    } else {
      if (req.url?.endsWith("/start")) created = false;
      res.end(
        JSON.stringify({
          status: created ? "created" : ready ? "ready" : "qr_ready",
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    openwaEnabled: true,
    openwaKey: "test-gateway-key",
    openwaUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  } as Config;
  const connection = { sessionId: "session-123" } as Connection;
  const adapter = new OpenWAAdapter(config);
  try {
    assert.deepEqual(await adapter.createSession("nexo-new-number"), {
      sessionId: "12345678-1234-1234-1234-123456789abc",
      status: "CREATED",
    });
    const initial = await adapter.connect(connection);
    assert.equal(initial.status, "QR_READY");
    assert.match(initial.qr!, /^data:image/);
    ready = true;
    assert.deepEqual(await adapter.status(connection), {
      status: "CONNECTED",
      qr: null,
    });
    assert.equal(
      await adapter.sendText(connection, "54911@c.us", "Hola", "outbox-1"),
      "wa-confirmed-id",
    );
    const send = calls.at(-1)!;
    assert.equal(send.url, "/api/sessions/session-123/messages/send-text");
    assert.equal(send.method, "POST");
    assert.equal(send.headers["x-api-key"], "test-gateway-key");
    assert.equal(send.headers["idempotency-key"], "outbox-1");
    assert.deepEqual(send.body, {
      chatId: "54911@c.us",
      text: "Hola",
      linkPreview: false,
    });
    await adapter.sendImage(
      connection,
      "54911@c.us",
      imageFixture(),
      "image/png",
      "Ejemplo del curso",
      "image-1",
    );
    const photo = calls.at(-1)!;
    assert.equal(photo.url, "/api/sessions/session-123/messages/send-image");
    assert.equal(photo.headers["idempotency-key"], "image-1");
    assert.equal(photo.headers["x-api-key"], "test-gateway-key");
    assert.deepEqual(photo.body, {
      chatId: "54911@c.us",
      base64: imageFixture().toString("base64"),
      mimetype: "image/png",
      caption: "Ejemplo del curso",
    });
    created = true;
    ready = false;
    assert.equal((await adapter.prepareQr(connection)).status, "QR_READY");
    assert.equal((await adapter.prepareQr(connection)).status, "QR_READY");
    ready = true;
    assert.equal((await adapter.prepareQr(connection)).status, "CONNECTED");
    const starts = calls.filter((c) => c.url.endsWith("/start"));
    assert.equal(
      starts.length,
      1,
      "Preparing QR must not restart pending or authenticated sessions",
    );
    assert.equal(starts[0].method, "POST");
    await assert.rejects(
      () =>
        new OpenWAAdapter({ ...config, openwaEnabled: false }).status(
          connection,
        ),
      /deshabilitado/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
