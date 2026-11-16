import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";


export function registerWorkspaceRoutes(
  app: FastifyInstance,
  { db, integrations, scope }: Pick<RouteContext, "db" | "integrations" | "scope">,
) {
  app.get("/api/overview", async (req) => {
    const workspaceId = await scope(req);
    const runtime = await integrations.resolve(workspaceId);
    const [
      conversations,
      approved,
      pending,
      products,
      notifications,
      connections,
    ] = await Promise.all([
      db.conversation.count({
        where: { workspaceId, connection: { provider: "OPENWA" } },
      }),
      db.payment.findMany({
        where: {
          workspaceId,
          status: "APPROVED",
          conversation: { connection: { provider: "OPENWA" } },
        },
        select: { amountCents: true, currency: true },
      }),
      db.payment.count({
        where: {
          workspaceId,
          status: "PENDING",
          conversation: { connection: { provider: "OPENWA" } },
        },
      }),
      db.product.count({ where: { workspaceId, active: true } }),
      db.notification.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.connection.findMany({ where: { workspaceId } }),
    ]);
    const revenue = approved.reduce<Record<string, number>>((out, p) => {
      if (p.currency)
        out[p.currency] = (out[p.currency] || 0) + (p.amountCents || 0);
      return out;
    }, {});
    return {
      conversations,
      sales: approved.length,
      pending,
      products,
      revenue,
      notifications,
      connections,
      ai:
        runtime.aiProvider === "openai" && runtime.openaiKey
          ? "OpenAI · selección de hechos"
          : "Motor de reglas · sin IA externa",
    };
  });
  app.get("/api/settings", async (req) =>
    db.workspace.findUniqueOrThrow({ where: { id: await scope(req) } }),
  );
  app.put("/api/settings", async (req) => {
    const id = await scope(req, true);
    const data = z
      .object({
        name: z.string().min(2).max(80),
        paymentAlias: z.string().max(100),
        paymentInstructions: z.string().max(1000),
        approvalPhone: z
          .string()
          .max(24)
          .transform((value) => value.replace(/\D/g, ""))
          .refine((value) => !value || /^[1-9]\d{6,14}$/.test(value), {
            message: "Ingresá el WhatsApp con código de país.",
          })
          .default(""),
      })
      .parse(req.body);
    return db.workspace.update({ where: { id }, data });
  });
}
