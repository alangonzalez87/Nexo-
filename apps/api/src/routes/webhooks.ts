import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { HttpError } from "../security.js";
import { OpenWAAdapter } from "../messaging.js";
import { idParam } from "./context.js";
import type { Config } from "../config.js";


export function registerWebhookRoutes(
  app: FastifyInstance,
  { db, integrations, webhooks, scope, setupAdmin }: Pick<RouteContext, "db" | "integrations" | "webhooks" | "scope" | "setupAdmin">,
) {
  app.post("/api/connections/:id/webhook", async (req) => {
    await setupAdmin?.(req);
    const workspaceId = await scope(req, true),
      runtime = await integrations.resolve(workspaceId);
    const connection = await db.connection.findFirst({
      where: { workspaceId, id: idParam(req), provider: "OPENWA" },
    });
    if (!connection) throw new HttpError(404, "Conexión OpenWA no encontrada.");
    const managed = runtime as Config & {
      managed?: boolean;
      managedSessionId?: string;
    };
    if (managed.managed && managed.managedSessionId !== connection.sessionId)
      throw new HttpError(
        409,
        "Esta es una conexión histórica. Usá la sesión WhatsApp del negocio vinculada a Railway.",
      );
    return new OpenWAAdapter(runtime).registerWebhook(
      connection,
      `${(runtime.openwaWebhookBaseUrl || runtime.publicUrl).replace(/\/$/, "")}/api/webhooks/openwa/${workspaceId}`,
    );
  });
  app.post(
    "/api/webhooks/openwa/:workspaceId",
    { config: { rawBody: true } },
    async (req, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(req.params);
      const result = await webhooks.accept(
        workspaceId,
        req.rawBody || "",
        req.headers["x-openwa-signature"],
      );
      return reply.code("ignored" in result ? 200 : 202).send(result);
    },
  );
}
