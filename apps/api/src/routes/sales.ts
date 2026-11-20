import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { idParam } from "./context.js";

export function registerSalesRoutes(
  app: FastifyInstance,
  {
    db,
    integrations,
    sales,
    scope,
    identity,
  }: Pick<RouteContext, "db" | "integrations" | "sales" | "scope" | "identity">,
) {
  app.get("/api/conversations", async (req) =>
    db.conversation.findMany({
      where: { workspaceId: await scope(req) },
      include: {
        product: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
  app.get("/api/conversations/:id", async (req) => {
    const workspaceId = await scope(req);
    return db.conversation.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: idParam(req) } },
      include: {
        product: true,
        messages: { orderBy: { createdAt: "asc" }, take: 500 },
        payments: true,
      },
    });
  });
  app.post("/api/conversations/:id/human", async (req) => {
    const workspaceId = await scope(req, true);
    const { text, resume, imageId } = z
      .object({
        text: z.string().min(1).max(4000).optional(),
        imageId: z.string().min(1).optional(),
        resume: z.boolean().default(false),
      })
      .parse(req.body);
    const result = await sales.human(
      workspaceId,
      idParam(req),
      text,
      resume,
      imageId,
    );
    if (text || imageId) await sales.dispatch(workspaceId);
    return result;
  });
  app.get("/api/payments", async (req) => {
    const workspaceId = await scope(req);
    const { provider } = z
      .object({ provider: z.literal("OPENWA").optional() })
      .parse(req.query);
    const conversation = {
      id: true,
      connectionId: true,
      contact: true,
      contactName: true,
      contactPhone: true,
      humanControlled: true,
      product: { select: { id: true, name: true } },
    } as const;
    const orderBy = { createdAt: "desc" } as const;
    if (!provider) {
      return db.payment.findMany({
        where: { workspaceId },
        include: { conversation: { select: conversation } },
        orderBy,
        take: 200,
      });
    }
    const runtime = (await integrations.resolve(workspaceId)) as Config & {
      managed?: boolean;
      managedSessionId?: string;
    };
    const where = { workspaceId, conversation: { connection: { provider } } };
    const args = {
      include: {
        conversation: {
          select: {
            ...conversation,
            connection: { select: { name: true, sessionId: true } },
          },
        },
      },
      orderBy,
    } as const;
    // Cap reviewed history only. Both lists must see the same review status.
    const [pending, reviewed] = await db.$transaction(
      [
        db.payment.findMany({
          ...args,
          where: { ...where, status: "PENDING" },
        }),
        db.payment.findMany({
          ...args,
          where: { ...where, status: { not: "PENDING" } },
          take: 200,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return [...pending, ...reviewed].map(
      ({ conversation: { connection, ...contact }, ...payment }) => ({
        ...payment,
        conversation: contact,
        connectionName: connection.name,
        historicalConnection:
          !!runtime.managed &&
          connection.sessionId !== runtime.managedSessionId,
      }),
    );
  });
  app.post("/api/payments/:id/review", async (req) => {
    const workspaceId = await scope(req, true);
    const { decision, reason, expectedAssetId, selection, deliveryMode } = z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        reason: z.string().max(500).default(""),
        deliveryMode: z.enum(["SEND", "ALREADY_DELIVERED"]).optional(),
        expectedAssetId: z.string().min(1).max(100),
        selection: z
          .object({
            productId: z.string().min(1),
            packNumber: z.number().int().min(1).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const result = await sales.review(
      workspaceId,
      idParam(req),
      identity(req),
      decision,
      reason,
      expectedAssetId,
      selection,
      deliveryMode,
    );
    await sales.dispatch(workspaceId);
    return result;
  });
}
