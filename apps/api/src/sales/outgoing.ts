import type { Prisma } from "@nexo/database";
import { HttpError } from "../security.js";

export async function assertResponseImages(
  tx: Pick<Prisma.TransactionClient, "asset">,
  workspaceId: string,
  values: (string | null | undefined)[],
) {
  const ids = [...new Set(values.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const count = await tx.asset.count({
    where: {
      workspaceId,
      id: { in: ids },
      purpose: "RESPONSE_IMAGE",
      mime: { in: ["image/png", "image/jpeg"] },
    },
  });
  if (count !== ids.length)
    throw new HttpError(
      400,
      "Imagen no disponible para este negocio. Subí un PNG o JPG para respuestas.",
    );
}

export async function queueOutgoing(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  conversationId: string,
  text: string,
  key: string,
  createdAt?: Date,
  origin: "AUTO" | "HUMAN" | "PAYMENT" = "AUTO",
  imageId?: string | null,
) {
  await assertResponseImages(tx, workspaceId, [imageId]);
  const last = await tx.message.findFirst({
    where: { workspaceId, conversationId, direction: "OUT" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  let timestamp = Math.max(
    (createdAt || new Date()).getTime(),
    (last?.createdAt.getTime() || 0) + 1,
  );
  const create = (body: string, externalId: string, assetId?: string | null) =>
    tx.message.create({
      data: {
        workspaceId,
        conversationId,
        text: body.slice(0, 4096),
        externalId,
        direction: "OUT",
        origin,
        status: "PENDING",
        assetId,
        createdAt: new Date(timestamp++),
      },
    });
  // OpenWA captions have a 1024 character limit. Each split send keeps its own identity.
  if (imageId && text.length > 1024) {
    await create(text, key);
    return create("", `${key}:image`, imageId);
  }
  return create(text, key, imageId);
}
