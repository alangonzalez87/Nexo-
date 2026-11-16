import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { sendAssetAttachment } from "../http/send-asset.js";
import { HttpError, sha256 } from "../security.js";
import { idParam } from "./context.js";
import { detectMime, saveAsset } from "../storage.js";

export function registerAssetRoutes(
  app: FastifyInstance,
  { db, scope, config }: Pick<RouteContext, "db" | "scope" | "config">,
) {
  app.post("/api/images", async (req) => {
    const workspaceId = await scope(req, true);
    const file = await req.file();
    if (!file) throw new HttpError(400, "Seleccioná una imagen.");
    const data = await file.toBuffer();
    if (!["image/png", "image/jpeg"].includes(detectMime(data)))
      throw new HttpError(
        400,
        "La respuesta admite imágenes PNG o JPG, hasta 8 MB.",
      );
    const asset = await saveAsset(
      db,
      config.storageDir,
      workspaceId,
      data,
      file.filename,
      "RESPONSE_IMAGE",
    );
    return { id: asset.id, name: asset.originalName, mime: asset.mime };
  });
  app.get("/api/assets/:id", async (req, reply) => {
    const workspaceId = await scope(req);
    const asset = await db.asset.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: idParam(req) } },
    });
    return sendAssetAttachment(reply, asset);
  });
  app.get("/api/deliveries/:token", async (req, reply) => {
    const { token } = z
      .object({ token: z.string().min(40).max(100) })
      .parse(req.params);
    const delivery = await db.delivery.findUnique({
      where: { tokenHash: sha256(token) },
      include: { payment: true },
    });
    if (
      !delivery ||
      delivery.expiresAt < new Date() ||
      delivery.payment.status !== "APPROVED"
    )
      throw new HttpError(404, "Enlace inválido o vencido.");
    const asset = await db.asset.findUniqueOrThrow({
      where: {
        workspaceId_id: {
          workspaceId: delivery.workspaceId,
          id: delivery.assetId,
        },
      },
    });
    return sendAssetAttachment(reply, asset, { noReferrer: true });
  });
}
