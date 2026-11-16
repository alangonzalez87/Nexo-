// Refresh local webhook subscriptions after the additive migration is applied
// by scripts/local-db.ts on database startup. Uses the normal authenticated API.
import { readFile } from "node:fs/promises";
const base = "http://127.0.0.1:3001/api";
let token = "";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  workspace?: string,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(workspace ? { "x-workspace-id": workspace } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const upstream =
      typeof detail.error === "string"
        ? detail.error.match(/HTTP (\d{3})/)?.[1]
        : undefined;
    throw new Error(
      `Local API HTTP ${response.status}${upstream ? `; gateway HTTP ${upstream}` : ""}`,
    );
  }
  return response.json();
}
try {
  const secrets = JSON.parse(await readFile(".data/demo-secrets.json", "utf8"));
  token = (
    await request("/auth/login", "POST", {
      email: "admin@nexo.local",
      password: secrets.password,
    })
  ).token;
  const memberships = await request("/workspaces");
  let updated = 0,
    skipped = 0,
    missingInactive = 0,
    failed = 0;
  for (const membership of memberships) {
    const workspace = membership.workspaceId;
    const config = await request(
      "/integrations/config",
      "GET",
      undefined,
      workspace,
    );
    const connections = await request(
      "/connections",
      "GET",
      undefined,
      workspace,
    );
    for (const connection of connections.filter(
      (c: any) => c.provider === "OPENWA",
    )) {
      if (!config.openwaEnabled) {
        skipped++;
        continue;
      }
      try {
        await request(
          `/connections/${connection.id}/webhook`,
          "POST",
          {},
          workspace,
        );
        updated++;
      } catch (error) {
        if (
          connection.status === "FAILED" &&
          error instanceof Error &&
          error.message.includes("gateway HTTP 404")
        ) {
          missingInactive++;
          continue;
        }
        failed++;
        console.error(
          `Webhook ${connection.status}: ${error instanceof Error ? error.message : "update failed"}`,
        );
      }
    }
    // These reads exercise the migrated models without printing customer data.
    await request("/conversations", "GET", undefined, workspace);
    await request("/payments", "GET", undefined, workspace);
  }
  console.log(
    JSON.stringify({
      authenticatedApi: "ok",
      webhooksUpdated: updated,
      skipped,
      missingInactive,
      failed,
    }),
  );
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local update failed");
  process.exitCode = 1;
}
