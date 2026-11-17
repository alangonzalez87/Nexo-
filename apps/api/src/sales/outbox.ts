import type { Prisma } from "@nexo/database";
import type { SalesContext } from "./context.js";
import { adapterFor } from "../messaging.js";
import { readFile } from "node:fs/promises";
import { detectMime } from "../storage.js";
type Tx = Prisma.TransactionClient;

export class OutboxService {
  private lastRemarketingScan = new Map<string, number>();
  constructor(private context: SalesContext) {}
  private async reminderEligible(
    tx: Tx,
    conversationId: string,
    now: Date,
    requireDelay: boolean,
  ) {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: { product: true, connection: true },
    });
    if (
      !conversation ||
      conversation.state !== "AWAITING_PAYMENT" ||
      conversation.humanControlled ||
      conversation.paused ||
      conversation.marketingOptOutAt ||
      conversation.connection.status !== "CONNECTED" ||
      !conversation.product?.active ||
      !conversation.product.agentEnabled ||
      !conversation.product.remarketingEnabled ||
      !conversation.product.remarketingMessage.trim()
    )
      return false;
    if (
      await tx.payment.findFirst({
        where: { conversationId },
        select: { id: true },
      })
    )
      return false;
    const quote = await tx.message.findFirst({
      where: {
        conversationId,
        direction: "OUT",
        status: "SENT",
        externalId: { startsWith: "payment-details:" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const inbound = await tx.message.findFirst({
      where: { conversationId, direction: "IN" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (
      !quote ||
      !inbound ||
      inbound.createdAt > quote.createdAt ||
      now.getTime() - inbound.createdAt.getTime() >= 23 * 3600000
    )
      return false;
    return (
      !requireDelay ||
      now.getTime() - quote.createdAt.getTime() >=
        conversation.product.remarketingDelayHours * 3600000
    );
  }
  async queueDueRemarketing(workspaceId: string) {
    const runtime =
      (await this.context.integrations?.resolve(workspaceId)) ||
      this.context.config;
    if (runtime.paymentAutomationEnabled === false) return false;
    if (Date.now() - (this.lastRemarketingScan.get(workspaceId) || 0) < 30000)
      return false;
    this.lastRemarketingScan.set(workspaceId, Date.now());
    return this.context.locked(workspaceId, async (tx) => {
      const now = new Date();
      const recent = await tx.message.findFirst({
        where: {
          workspaceId,
          externalId: { startsWith: "remarketing:" },
          createdAt: { gte: new Date(now.getTime() - 60000) },
        },
        select: { id: true },
      });
      if (recent) return false;
      const candidates = await tx.conversation.findMany({
        where: {
          workspaceId,
          state: "AWAITING_PAYMENT",
          paused: false,
          marketingOptOutAt: null,
          updatedAt: { gte: new Date(now.getTime() - 23 * 3600000) },
          product: {
            is: { active: true, agentEnabled: true, remarketingEnabled: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
        include: { product: true },
      });
      for (const conversation of candidates) {
        if (
          await tx.message.findUnique({
            where: { externalId: `remarketing:${conversation.id}` },
            select: { id: true },
          })
        )
          continue;
        if (!(await this.reminderEligible(tx, conversation.id, now, true)))
          continue;
        await this.context.outgoing(
          tx,
          workspaceId,
          conversation.id,
          conversation.product!.remarketingMessage,
          `remarketing:${conversation.id}`,
        );
        return true;
      }
      return false;
    });
  }
  async dispatch(workspaceId: string) {
    const runtime =
      (await this.context.integrations?.resolve(workspaceId)) ||
      this.context.config;
    if (runtime.preview === false && !runtime.automationCutoffAt)
      return false;
    return this.context.locked(workspaceId, async (tx) => {
      let sent = false;
      const pending = await tx.message.findMany({
        where: {
          workspaceId,
          status: "PENDING",
          direction: "OUT",
          ...(runtime.automationCutoffAt
            ? { createdAt: { gte: runtime.automationCutoffAt } }
            : {}),
          ...(runtime.paymentAutomationEnabled === false
            ? { origin: { not: "PAYMENT" } }
            : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 25,
        include: {
          conversation: { include: { connection: true, product: true } },
        },
      });
      for (const message of pending) {
        if (
          message.origin === "AUTO" &&
          (message.conversation.humanControlled ||
            !message.conversation.product?.active ||
            !message.conversation.product.agentEnabled)
        ) {
          await tx.message.update({
            where: { id: message.id },
            data: { status: "CANCELLED" },
          });
          continue;
        }
        if (
          message.externalId.startsWith("remarketing:") &&
          !(await this.reminderEligible(
            tx,
            message.conversationId,
            new Date(),
            false,
          ))
        ) {
          await tx.message.update({
            where: { id: message.id },
            data: { status: "CANCELLED" },
          });
          continue;
        }
        const earlierFailed = await tx.message.findFirst({
          where: {
            workspaceId,
            conversationId: message.conversationId,
            direction: "OUT",
            status: "NEEDS_REVIEW",
            createdAt: { lt: message.createdAt },
          },
          select: { id: true },
        });
        if (earlierFailed && message.origin !== "HUMAN") continue;
        const connection = message.conversation.connection;
        if (connection.status !== "CONNECTED") continue;
        if (connection.provider === "OPENWA" && !runtime.openwaEnabled)
          continue;
        try {
          // Never retry outside OpenWA's documented 24-hour deduplication window.
          if (
            connection.provider !== "MOCK" &&
            Date.now() - message.createdAt.getTime() > 23 * 3600000
          )
            throw new Error("Expired send");
          const adapter = adapterFor(connection.provider, runtime);
          let providerMessageId: string;
          if (message.assetId) {
            const asset = await tx.asset.findFirstOrThrow({
              where: {
                workspaceId,
                id: message.assetId,
                purpose: "RESPONSE_IMAGE",
                mime: { in: ["image/png", "image/jpeg"] },
              },
            });
            const data = await readFile(asset.path);
            if (
              data.length > 8 * 1024 * 1024 ||
              detectMime(data) !== asset.mime
            )
              throw new Error("Invalid response image");
            providerMessageId = await adapter.sendImage(
              connection,
              message.conversation.contact,
              data,
              asset.mime,
              message.text,
              message.id,
            );
          } else {
            providerMessageId = await adapter.sendText(
              connection,
              message.conversation.contact,
              message.text,
              message.id,
            );
          }
          await tx.message.update({
            where: { id: message.id },
            data: { status: "SENT", providerMessageId },
          });
          sent = true;
        } catch {
          // Ambiguous gateway failures require manual reconciliation, never blind resend.
          await tx.message.update({
            where: { id: message.id },
            data: { status: "NEEDS_REVIEW" },
          });
          await tx.notification.create({
            data: {
              workspaceId,
              text: `El envío ${message.id} necesita revisión en el gateway antes de reintentar.`,
            },
          });
        }
        // A real HTTP send can take 12 seconds; keep each database transaction bounded.
        if (connection.provider === "OPENWA") break;
      }
      return sent;
    });
  }
  async dispatchBatch(workspaceId: string, limit = 3) {
    for (let index = 0; index < limit; index++)
      if (!(await this.dispatch(workspaceId))) break;
  }
}
