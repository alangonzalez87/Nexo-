import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnectionStatusMonitor } from "../../web/src/connectionStatusMonitor.js";
import type { LiveConnectionStatus } from "../../web/src/connectionStatus.js";

type Row = LiveConnectionStatus & { id: string };
const row: Row = { id: "phone", status: "CONNECTED", checkedAt: "2026-11-12T00:00:00Z" };

test("shared status consumers use one request and one polling timer", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  let resolve!: (rows: Row[]) => void;
  const monitor = createConnectionStatusMonitor(async () => {
    calls++;
    return new Promise<Row[]>((done) => { resolve = done; });
  });
  let first = 0, second = 0;
  const unsubscribeFirst = monitor.subscribe(() => { first++; });
  const unsubscribeSecond = monitor.subscribe(() => { second++; });
  try {
    monitor.start();
    monitor.start();
    const a = monitor.refresh(), b = monitor.refresh();
    assert.equal(a, b);
    t.mock.timers.tick(60000);
    assert.equal(calls, 1);
    resolve([row]);
    await a;
    assert.equal(monitor.getSnapshot().liveStatuses.phone.status, "CONNECTED");
    assert.equal(first, second);
    assert.equal(first, 2);
    t.mock.timers.tick(20000);
    assert.equal(calls, 2);
    resolve([]);
    await monitor.refresh();
  } finally { unsubscribeFirst(); unsubscribeSecond(); monitor.stop(); }
});

test("stopped status requests are aborted and cannot overwrite a restarted session", async () => {
  const requests: { signal: AbortSignal; resolve: (rows: Row[]) => void }[] = [];
  const monitor = createConnectionStatusMonitor((signal) => new Promise((resolve) => requests.push({ signal, resolve })));
  try {
    monitor.start();
    const old = monitor.refresh();
    monitor.stop();
    assert.equal(requests[0].signal.aborted, true);
    monitor.start();
    const current = monitor.refresh();
    requests[1].resolve([{ ...row, status: "DISCONNECTED" }]);
    await current;
    requests[0].resolve([row]);
    await old;
    assert.equal(monitor.getSnapshot().liveStatuses.phone.status, "DISCONNECTED");
  } finally { monitor.stop(); }
});

test("failed status refresh clears stale connected indicators and allows recovery", async () => {
  let fail = false;
  const monitor = createConnectionStatusMonitor(async () => { if (fail) throw new Error("offline"); return [row]; });
  try {
    monitor.start();
    await monitor.refresh();
    fail = true;
    await assert.rejects(monitor.refresh(), /offline/);
    assert.deepEqual(monitor.getSnapshot(), { liveStatuses: {}, statusLoaded: true });
    fail = false;
    await monitor.refresh();
    assert.equal(monitor.getSnapshot().liveStatuses.phone.status, "CONNECTED");
  } finally { monitor.stop(); }
});

test("a pending poll cannot overwrite the result of a newer stop or QR action", async () => {
  let resolve!: (rows: Row[]) => void;
  const monitor = createConnectionStatusMonitor(() => new Promise((done) => { resolve = done; }));
  try {
    monitor.start();
    const pending = monitor.refresh();
    monitor.setLiveStatuses({ phone: { ...row, status: "DISCONNECTED" } });
    resolve([row]);
    await pending;
    assert.equal(monitor.getSnapshot().liveStatuses.phone.status, "DISCONNECTED");
    monitor.stop();
    monitor.setLiveStatuses({ phone: row });
    assert.equal(monitor.getSnapshot().liveStatuses.phone.status, "DISCONNECTED");
  } finally { monitor.stop(); }
});
