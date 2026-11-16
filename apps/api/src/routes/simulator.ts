import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { HttpError } from "../security.js";
import { saveAsset } from "../storage.js";

const incomingSchema = z
  .object({
    eventId: z.string().min(1).max(255),
    connectionId: z.string(),
    contact: z.string().trim().min(2).max(100),
    text: z.string().trim().max(4000).default(""),
    assetId: z.string().optional(),
    referral: z
      .object({
        adId: z.string().max(200).optional(),
        sourceUrl: z.string().max(1000).optional(),
        campaignId: z.string().max(200).optional(),
      })
      .optional(),
  })
  .refine(
    (v) => Boolean(v.text || v.assetId),
    "Enviá un mensaje o un comprobante.",
  );

export function registerSimulatorRoutes(
  app: FastifyInstance,
  { db, config, sales, scope }: Pick<RouteContext, "db" | "config" | "sales" | "scope">,
) {
  app.post("/api/simulator/messages", async (req) => {
    const workspaceId = await scope(req, true),
      data = incomingSchema.parse(req.body);
    const connection = await db.connection.findFirst({
      where: { workspaceId, id: data.connectionId, provider: "MOCK" },
    });
    if (!connection)
      throw new HttpError(
        400,
        "El simulador requiere una conexión MOCK del negocio.",
      );
    const result = await sales.receive(workspaceId, data);
    if (result.paymentId) await sales.verifyReceipt(workspaceId, result.paymentId);
    await sales.dispatch(workspaceId);
    return result;
  });
  app.post("/api/simulator/receipts", async (req) => {
    const workspaceId = await scope(req, true);
    const file = await req.file();
    if (!file) throw new HttpError(400, "Seleccioná un archivo.");
    const asset = await saveAsset(
      db,
      config.storageDir,
      workspaceId,
      await file.toBuffer(),
      file.filename,
      "RECEIPT",
    );
    return { id: asset.id };
  });
}
