import { test } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "../src/worker.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const intervalMs of [3000, 5000]) {
  test(`worker preserves order and continues with the next workspace (${intervalMs}ms)`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const calls: string[] = [];
    const stop = startWorker({
      listWorkspaces: async () => [{ id: "a" }, { id: "b" }],
      webhooks: { process: async (id) => { calls.push(`webhook:${id}`); if (id === "a") throw new Error("fixture"); } },
      sales: {
        verifyPendingReceipts: async (id) => { calls.push(`receipts:${id}`); },
        queueDueRemarketing: async (id) => { calls.push(`remarketing:${id}`); return false; },
        dispatchBatch: async (id) => { calls.push(`dispatch:${id}`); },
      },
    }, { intervalMs, onError: (id) => { calls.push(`error:${id}`); } });
    try {
      t.mock.timers.tick(intervalMs - 1);
      assert.deepEqual(calls, []);
      t.mock.timers.tick(1);
      await flush();
      assert.deepEqual(calls, ["webhook:a", "error:a", "webhook:b", "receipts:b", "remarketing:b", "dispatch:b"]);
      await stop();
      t.mock.timers.tick(intervalMs * 2);
      assert.equal(calls.length, 6);
    } finally { await stop(); }
  });
}

test("worker never overlaps and stop drains the active cycle", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scans = 0;
  let dispatched = false;
  const stop = startWorker({
    listWorkspaces: async () => { scans++; return [{ id: "a" }]; },
    webhooks: { process: () => gate },
    sales: {
      verifyPendingReceipts: async () => {},
      queueDueRemarketing: async () => false,
      dispatchBatch: async () => { dispatched = true; },
    },
  }, { intervalMs: 3000, onError: () => assert.fail("unexpected failure") });
  try {
    t.mock.timers.tick(3000);
    await flush();
    t.mock.timers.tick(12000);
    assert.equal(scans, 1);
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await flush();
    assert.equal(stopped, false);
    release();
    await stopping;
    assert.equal(dispatched, true);
    t.mock.timers.tick(9000);
    assert.equal(scans, 1);
  } finally { release(); await stop(); }
});

test("worker recovers after workspace enumeration fails", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let scans = 0;
  const errors: (string | undefined)[] = [];
  const stop = startWorker({
    listWorkspaces: async () => { if (++scans === 1) throw new Error("offline"); return []; },
    webhooks: { process: async () => {} },
    sales: { verifyPendingReceipts: async () => {}, queueDueRemarketing: async () => false, dispatchBatch: async () => {} },
  }, { intervalMs: 5000, onError: (id) => errors.push(id) });
  try {
    t.mock.timers.tick(5000);
    await flush();
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(scans, 2);
    assert.deepEqual(errors, [undefined]);
  } finally { await stop(); }
});
