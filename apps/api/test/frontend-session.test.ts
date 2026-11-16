import { test } from "node:test";
import assert from "node:assert/strict";

test("session changes discard old responses and 401 clears identity and workspace", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const originalFetch = globalThis.fetch;
  const { api, credentials } = await import("../../web/src/api.js");
  try {
    credentials.setToken("account-a");
    credentials.setWorkspace("business-a");
    let finish!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => { finish = resolve; })) as typeof fetch;
    const pending = api("/conversations");
    credentials.setToken("account-b");
    assert.equal(credentials.workspace, "");
    finish(new Response(JSON.stringify([{ text: "private account A" }])));
    await assert.rejects(pending, /sesión o el negocio cambió/);
    credentials.setWorkspace("business-b");
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(api("/auth/login"));
    assert.equal(credentials.token, "account-b", "wrong login must not expire another session");
    await assert.rejects(api("/products"));
    assert.equal(credentials.token, "");
    assert.equal(credentials.workspace, "");
    assert.match(credentials.notice, /sesión venció/);
    assert.equal(values.has("nexo-token"), false);
    credentials.setToken("account-c");
    credentials.setWorkspace("business-c");
    const revision = credentials.getSnapshot();
    credentials.setWorkspace("business-c");
    assert.equal(credentials.getSnapshot(), revision, "same workspace must not remount in a loop");
    credentials.setWorkspace("business-d");
    assert.ok(credentials.getSnapshot() > revision);
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    })) as typeof fetch;
    const screen = new AbortController();
    const cancelled = api("/connections/live-status", "GET", undefined, screen.signal);
    screen.abort();
    await assert.rejects(cancelled, /request aborted/);
    assert.equal(credentials.token, "account-c", "leaving a screen must not expire the session");
    const nextScreen = new AbortController();
    const changingSession = api("/connections/live-status", "GET", undefined, nextScreen.signal);
    credentials.setWorkspace("business-e");
    await assert.rejects(changingSession, /request aborted/);
    assert.equal(nextScreen.signal.aborted, false, "session cancellation must still reach combined requests");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
