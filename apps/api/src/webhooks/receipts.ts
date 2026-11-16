import { money } from "../seller/text.js";
import { readFile } from "node:fs/promises";
import type { Connection, PrismaClient } from "@nexo/database";
import type { OpenWAAdapter } from "../messaging.js";
import { detectMime } from "../storage.js";
import type { WebhookMessage } from "./schemas.js";

export async function readReceiptMedia(
  m: WebhookMessage,
  adapter: Pick<OpenWAAdapter, "downloadMedia">,
  connection: Connection,
) {
  let media: { data: Buffer; name: string } | undefined,
    mediaUnavailable = false;
  if (m.type === "image" || m.type === "document") {
    try {
      if (m.media?.sizeBytes && m.media.sizeBytes > 8 * 1024 * 1024)
        throw new Error("Large media");
      const bytes = m.media?.data
        ? Buffer.from(m.media.data, "base64")
        : await adapter.downloadMedia(connection, m.chatId, m.id);
      detectMime(bytes);
      if (bytes.length > 8 * 1024 * 1024) throw new Error("Large media");
      media = {
        data: bytes,
        name: m.media?.filename || `comprobante-${m.id.slice(0, 40)}`,
      };
    } catch {
      mediaUnavailable = true;
    }
  }
  return { media, mediaUnavailable };
}

export async function notifyPendingReceipt(
  db: PrismaClient,
  adapter: Pick<OpenWAAdapter, "sendText" | "sendDocument">,
  connection: Connection,
  workspaceId: string,
  conversationId: string,
  approvalPhone: string,
) {
  const payment = await db.payment.findFirst({
    where: {
      workspaceId,
      conversationId: conversationId,
      status: "PENDING",
    },
    include: { conversation: { include: { product: true } } },
  });
  if (
    payment &&
    approvalPhone &&
    payment.conversation.product?.notifyApprovalByWhatsApp !== false
  ) {
    const recipient = `${approvalPhone}@c.us`;
    const customer =
      payment.conversation.contactName ||
      payment.conversation.contactPhone ||
      payment.conversation.contact;
    const course = payment.conversation.product?.name || "Producto";
    const reviewCode = `${payment.id}.${payment.assetId}`;
    await adapter.sendText(
      connection,
      recipient,
      `Nuevo comprobante para revisar\nCliente: ${customer}\nProducto: ${course}${payment.packName ? `\nPack ${payment.packNumber}: ${payment.packName}` : ""}${payment.amountCents !== null ? `\nImporte: ${money(payment.amountCents, payment.currency || "ARS")}` : ""}\nCódigo: ${reviewCode}\n\nRespondé APROBAR ${reviewCode} para aprobar y enviar, ENTREGADO ${reviewCode} si ya entregaste el curso, o RECHAZAR ${reviewCode} y agregá el motivo si hace falta.`,
      `approval-notice:${payment.id}:${payment.assetId}`,
    );
    const receipt = await db.asset.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id: payment.assetId,
        },
      },
    });
    if (receipt && receipt.size <= 8 * 1024 * 1024) {
      try {
        await adapter.sendDocument(
          connection,
          recipient,
          await readFile(receipt.path),
          receipt.mime,
          receipt.originalName,
          `approval-receipt:${payment.id}:${payment.assetId}`,
        );
      } catch {
        // The review notice still contains the code if attachment delivery fails.
      }
    }
  }
}
