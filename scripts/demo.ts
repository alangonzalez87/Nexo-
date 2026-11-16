import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createServer } from "vite";
import { seed } from "../packages/database/src/seed.js";
import { configFromEnv } from "../apps/api/src/config.js";
import { buildApp } from "../apps/api/src/app.js";
import { startWorker } from "../apps/api/src/worker.js";
await mkdir(".data", { recursive: true });
let secrets: { password: string; jwt: string };
try {
  secrets = JSON.parse(await readFile(".data/demo-secrets.json", "utf8"));
} catch {
  secrets = {
    password: randomBytes(12).toString("base64url"),
    jwt: randomBytes(32).toString("base64url"),
  };
  await writeFile(".data/demo-secrets.json", JSON.stringify(secrets), {
    mode: 0o600,
  });
}
process.env.JWT_SECRET = secrets.jwt;
process.env.ADMIN_EMAIL = "admin@nexo.local";
process.env.STORAGE_DIR = resolve(".data/private");
const live = process.argv.includes("--integrations");
if (live && !process.env.OPENWA_MANAGED_ADMIN_KEY) {
  try {
    process.env.OPENWA_MANAGED_ADMIN_KEY = (
      await readFile(".data/openwa/data/.api-key", "utf8")
    ).trim();
  } catch {
    // OpenWA can be installed later; account creation remains available.
  }
}
const lan = process.argv.includes("--lan");
process.env.FORCE_SIMULATION = live ? "false" : "true";
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=1&sslmode=disable";
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
for (let attempt = 0; ; attempt += 1) {
  try {
    await seed(db, "admin@nexo.local", secrets.password);
    break;
  } catch (error) {
    if (
      attempt >= 20 ||
      !/Can't reach database server|P1001/.test(String(error))
    )
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const { app, sales, webhooks } = await buildApp(db, configFromEnv());
await app.listen({ host: process.env.HOST || "127.0.0.1", port: 3001 });
const web = await createServer({
  configFile: resolve("apps/web/vite.config.ts"),
  root: resolve("apps/web"),
  server: { port: 5173, host: lan ? "0.0.0.0" : "127.0.0.1", strictPort: true },
});
await web.listen();
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === "IPv4" && !address.internal)?.address;
console.log(
  `\nNexo: http://localhost:5173${lan && lanAddress ? `\nNexo en la red: http://${lanAddress}:5173` : ""}\nEmail: admin@nexo.local\nContraseña local: ${secrets.password}\nBase persistente PGlite (sólo desarrollo). ${live ? "Integraciones disponibles: configurá las claves en el panel." : "Simulación forzada: ningún envío real."}\n`,
);
const stopWorker = startWorker({
  listWorkspaces: () => db.workspace.findMany({ select: { id: true } }),
  sales,
  webhooks,
}, {
  intervalMs: 5000,
  onError: (workspaceId) => console.error(workspaceId
    ? `No se pudo procesar el negocio ${workspaceId}. Se reintentará.`
    : "Bandeja de salida no disponible."),
});
async function close() {
  await stopWorker();
  await web.close();
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
