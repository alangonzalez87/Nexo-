import { queueOutgoing } from "./sales/outgoing.js";
import { takeHumanControl } from "./sales/human-control.js";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@nexo/database";
import type { Config } from "./config.js";
import type { IncomingMessage } from "./messaging.js";
import type { Selector } from "./seller.js";
import type { IntegrationSettings } from "./integrations.js";
import { HttpError } from "./security.js";
import {
  OpenAIReceiptVerifier,
  type ReceiptVerifier,
} from "./receipt-verification.js";
import type { SalesContext } from "./sales/context.js";
import { receiveMessage } from "./sales/receiving.js";
import { ReceiptService } from "./sales/receipts.js";
import { OutboxService } from "./sales/outbox.js";
import { listUnanswered, startCourseReplies } from "./sales/course-replies.js";
import type { CourseReplyRequest } from "../../../packages/shared/src/course-replies.js";
type Tx = Prisma.TransactionClient;

export class SalesService {
  private context: SalesContext;
  private receipts: ReceiptService;
  private outbox: OutboxService;
  constructor(
    public db: PrismaClient,
    config: Config,
    selector?: Selector,
    integrations?: IntegrationSettings,
    receiptVerifier: ReceiptVerifier = new OpenAIReceiptVerifier(),
  ) {
    this.context = {
      db,
      config,
      selector,
      integrations,
      receiptVerifier,
      locked: this.locked.bind(this),
      outgoing: this.outgoing.bind(this),
    };
    this.receipts = new ReceiptService(this.context);
    this.outbox = new OutboxService(this.context);
  }
  async locked<T>(
    workspaceId: string,
    run: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        // An UPDATE obtains a PostgreSQL row lock until commit, across processes.
        // Serialize within a workspace for this MVP; distinct workspaces run concurrently.
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { version: { increment: 1 } },
        });
        return run(tx);
      },
      { maxWait: 30000, timeout: 30000 },
    );
  }
  private outgoing = queueOutgoing;
  receive(workspaceId: string, input: IncomingMessage) {
    return receiveMessage(this.context, workspaceId, input);
  }
  listUnanswered(workspaceId: string, provider?: "OPENWA") {
    return listUnanswered(this.context, workspaceId, provider);
  }
  startCourseReplies(workspaceId: string, request: CourseReplyRequest) {
    return startCourseReplies(this.context, workspaceId, request);
  }
  review(...args: Parameters<ReceiptService["review"]>) {
    return this.receipts.review(...args);
  }
  verifyReceipt(workspaceId: string, paymentId: string) {
    return this.receipts.verifyReceipt(workspaceId, paymentId);
  }
  verifyPendingReceipts(workspaceId: string) {
    return this.receipts.verifyPendingReceipts(workspaceId);
  }
  queueDueRemarketing(workspaceId: string) {
    return this.outbox.queueDueRemarketing(workspaceId);
  }
  dispatch(workspaceId: string) {
    return this.outbox.dispatch(workspaceId);
  }
  dispatchBatch(workspaceId: string, limit = 3) {
    return this.outbox.dispatchBatch(workspaceId, limit);
  }
  async observeOwnMessage(
    workspaceId: string,
    connectionId: string,
    message: { id: string; chatId: string; body?: string | null; type: string },
  ) {
    const runtime =
      (await this.context.integrations?.resolve(workspaceId)) ||
      this.context.config;
    // Explicit workspace allowlist, exact text only. Do not infer automation
    // from a greeting or from a short time interval: operators also greet people.
    const automaticGreeting =
      // OpenWA maps ad/template greetings to "unknown" (e.g. wwebjs hsm).
      // They still must match an explicitly configured complete text.
      ["text", "chat", "unknown"].includes(message.type) &&
      !!message.body?.trim() &&
      (runtime.automaticOwnMessages || []).some(
        (text) =>
          text.trim().normalize("NFC") ===
          message.body!.trim().normalize("NFC"),
      );
    return this.locked(workspaceId, async (tx) => {
      // The send and its provider ID commit under this same lock. An early echo
      // waits for that commit, so an API send never masquerades as the operator.
      const known = await tx.message.findFirst({
        where: {
          workspaceId,
          providerMessageId: message.id,
          conversation: { connectionId },
        },
      });
      if (known) return { ignored: true };
      const externalId = `own:${workspaceId}:${connectionId}:${message.id}`;
      if (await tx.message.findUnique({ where: { externalId } }))
        return { ignored: true };
      const conversation = await tx.conversation.upsert({
        where: {
          workspaceId_connectionId_contact: {
            workspaceId,
            connectionId,
            contact: message.chatId,
          },
        },
        create: {
          workspaceId,
          connectionId,
          contact: message.chatId,
          humanControlled: !automaticGreeting,
          paused: !automaticGreeting,
          state: automaticGreeting ? "DISCOVERY" : "HUMAN",
        },
        update: {},
      });
      await tx.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          externalId,
          providerMessageId: message.id,
          direction: "OUT",
          status: "SENT",
          origin: automaticGreeting ? "EXTERNAL_AUTO" : "HUMAN",
          text: (
            message.body || `[Mensaje enviado desde WhatsApp: ${message.type}]`
          ).slice(0, 4096),
        },
      });
      if (!automaticGreeting)
        await takeHumanControl(tx, workspaceId, conversation);
      return { conversationId: conversation.id };
    });
  }
  async human(
    workspaceId: string,
    conversationId: string,
    text?: string,
    resume = false,
    imageId?: string,
  ) {
    if (resume && (text || imageId))
      throw new HttpError(
        400,
        "No se puede enviar como humano y reactivar a la vez.",
      );
    return this.locked(workspaceId, async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { workspaceId, id: conversationId },
      });
      if (!conversation)
        throw new HttpError(404, "Conversación no encontrada.");
      if (resume && conversation.state === "REVIEW")
        throw new HttpError(
          409,
          "No se puede reactivar durante la revisión del pago.",
        );
      if (!resume) await takeHumanControl(tx, workspaceId, conversation);
      if (text || imageId)
        await this.outgoing(
          tx,
          workspaceId,
          conversationId,
          text || "",
          `human:${randomUUID()}`,
          undefined,
          "HUMAN",
          imageId,
        );
      return tx.conversation.update({
        where: { id: conversationId },
        data: {
          paused: !resume,
          humanControlled: !resume,
          state: resume
            ? conversation.state === "WON"
              ? "WON"
              : conversation.quotedPriceCents !== null
                ? "AWAITING_PAYMENT"
                : conversation.productId
                  ? "QUALIFIED"
                  : "DISCOVERY"
            : conversation.state === "REVIEW" || conversation.state === "WON"
              ? conversation.state
              : "HUMAN",
        },
      });
    });
  }
}
