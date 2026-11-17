import { PrismaClient } from "@nexo/database";
import { buildApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { startWorker } from "./worker.js";
const db = new PrismaClient();
const config = configFromEnv();
const { app, sales, webhooks } = await buildApp(db, config);
await app.listen({
  host: process.env.HOST || (config.preview ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.PORT || 3001),
});
console.log(
  `Nexo API lista en ${(app.server.address() && process.env.PORT) || 3001}`,
);
const stopWorker = config.preview || !config.automationCutoffAt
  ? async () => {}
  : startWorker(
      {
        listWorkspaces: () => db.workspace.findMany({ select: { id: true } }),
        sales,
        webhooks,
      },
      {
        intervalMs: 3000,
        paymentAutomationEnabled:
          config.paymentAutomationEnabled === true,
        onError: (workspaceId) =>
          console.error(
            workspaceId
              ? `No se pudo procesar el negocio ${workspaceId}. Se reintentará.`
              : "No se pudo procesar la bandeja de salida. Se reintentará.",
          ),
      },
    );
async function shutdown() {
  await stopWorker();
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
