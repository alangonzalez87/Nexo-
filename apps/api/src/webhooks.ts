import type { PrismaClient, Prisma } from "@nexo/database";
import { HttpError, sha256, verifyWebhook } from "./security.js";
import type { IntegrationSettings } from "./integrations.js";
import {
  OpenWAAdapter,
  contactName,
  phoneFromContact,
  validPhone,
} from "./messaging.js";
import type { SalesService } from "./sales.js";
import { envelope, messageSchema } from "./webhooks/schemas.js";
import { readReceiptMedia, notifyPendingReceipt } from "./webhooks/receipts.js";
export class WebhookService {
  constructor(
    private db: PrismaClient,
    private integrations: IntegrationSettings,
    private sales: SalesService,
  ) {}
  async accept(workspaceId: string, body: Buffer | string, signature: unknown) {
    const config = await this.integrations.resolve(workspaceId);
    if (!verifyWebhook(body, signature, config.webhookSecret))
      throw new HttpError(401, "Firma inválida.");
    if (!config.openwaEnabled)
      throw new HttpError(409, "OpenWA no está habilitado en este negocio.");
    const event = envelope.parse(JSON.parse(body.toString()));
    const connection = await this.db.connection.findFirst({
      where: { workspaceId, sessionId: event.sessionId, provider: "OPENWA" },
    });
    if (!connection)
      throw new HttpError(403, "La sesión no pertenece a este negocio.");
    if (config.openwaSetupMode) return { ignored: true, reason: "setup_mode" };
    if (
      ![
        "message.sent",
        "message.received",
        "session.status",
        "session.disconnected",
      ].includes(event.event)
    )
      return { ignored: true };
    let data: Record<string, unknown>, identity: string;
    if (event.event === "message.received" || event.event === "message.sent") {
      const m = messageSchema.parse(event.data);
      if (
        m.isGroup ||
        m.isStatusBroadcast ||
        !/@(c\.us|s\.whatsapp\.net|lid)$/.test(m.chatId)
      )
        return { ignored: true };
      if (event.event === "message.sent" && !m.fromMe) return { ignored: true };
      if (!m.fromMe && !["text", "chat", "image", "document"].includes(m.type))
        return { ignored: true, reason: "unsupported_message_type" };
      data = m;
      identity = m.id; // Message identity, not delivery ID: retries and multiple subscriptions deduplicate.
    } else {
      data = {};
      identity = event.idempotencyKey || sha256(body.toString());
    }
    const id = sha256(
      `${workspaceId}:${connection.id}:${event.event}:${identity}`,
    );
    await this.db.webhookInbox.upsert({
      where: { id },
      create: {
        id,
        workspaceId,
        connectionId: connection.id,
        payload: { event: event.event, data } as Prisma.InputJsonValue,
      },
      update: {},
    });
    // Apply the human handoff at ingress, before the worker can dispatch a
    // queued reply. This also processes an early API echo under the send lock.
    if (
      (event.event === "message.sent" || event.event === "message.received") &&
      data.fromMe
    ) {
      await this.handleOwnMessage(
        workspaceId,
        connection.id,
        messageSchema.parse(data),
      );
      await this.db.webhookInbox.update({
        where: { id },
        data: {
          status: "DONE",
          processedAt: new Date(),
          lastError: null,
          payload: { event: event.event },
        },
      });
    }
    return { accepted: true, id };
  }
  private async handleOwnMessage(
    workspaceId: string,
    connectionId: string,
    m: ReturnType<typeof messageSchema.parse>,
  ) {
    const workspace = await this.db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { approvalPhone: true },
    });
    // Notices to the configured operator aren't customer conversations.
    if (
      workspace.approvalPhone &&
      phoneFromContact(m.chatId) === workspace.approvalPhone
    )
      return;
    await this.sales.observeOwnMessage(workspaceId, connectionId, m);
  }
  async process(workspaceId: string) {
    const runtime = await this.integrations.resolve(workspaceId);
    if (!runtime.openwaEnabled) return;
    // Oldest unresolved event blocks later events for this workspace, preserving ingress order.
    const item = await this.db.webhookInbox.findFirst({
      where: { workspaceId, status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!item || item.nextAttemptAt > new Date()) return;
    const lease = new Date(Date.now() + 120000);
    const claimed = await this.db.webhookInbox.updateMany({
      where: {
        id: item.id,
        status: item.status,
        nextAttemptAt: { lte: new Date() },
      },
      data: {
        status: "PROCESSING",
        nextAttemptAt: lease,
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    try {
      const connection = await this.db.connection.findFirstOrThrow({
        where: { id: item.connectionId, workspaceId, provider: "OPENWA" },
      });
      const adapter = new OpenWAAdapter(runtime);
      const payload = item.payload as { event: string; data: unknown };
      if (
        payload.event === "message.sent" ||
        (payload.event === "message.received" &&
          messageSchema.parse(payload.data).fromMe)
      ) {
        await this.handleOwnMessage(
          workspaceId,
          connection.id,
          messageSchema.parse(payload.data),
        );
      } else if (payload.event === "message.received") {
        const m = messageSchema.parse(payload.data);
        const workspace = await this.db.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          select: { approvalPhone: true },
        });
        const senderPhone =
          phoneFromContact(m.chatId) || validPhone(m.senderPhone);
        if (
          workspace.approvalPhone &&
          senderPhone === workspace.approvalPhone
        ) {
          const command = (m.body || "").match(
            /^\s*(APROBAR|ENTREGADO|RECHAZAR)\s+([a-z0-9_-]{5,80})\.([a-z0-9_-]{5,80})(?:\s+([\s\S]+))?\s*$/i,
          );
          if (!command) {
            await adapter.sendText(
              connection,
              m.chatId,
              "Copiá el código completo del último aviso: APROBAR <pago.archivo> para enviar, ENTREGADO <pago.archivo> si ya lo entregaste, o RECHAZAR <pago.archivo> y, si querés, agregá el motivo.",
              `approval-help:${m.id}`,
            );
          } else {
            const decision = command[1].toUpperCase() as
              "APROBAR" | "ENTREGADO" | "RECHAZAR";
            const paymentId = command[2];
            try {
              await this.sales.review(
                workspaceId,
                paymentId,
                "whatsapp-operator",
                decision === "RECHAZAR" ? "REJECTED" : "APPROVED",
                decision === "RECHAZAR"
                  ? command[4]?.trim() || "No pudimos validar el comprobante."
                  : "",
                command[3],
                undefined,
                decision === "ENTREGADO" ? "ALREADY_DELIVERED" : "SEND",
              );
            } catch (error) {
              const explanation =
                error instanceof Error
                  ? error.message
                  : "No se pudo revisar el pago.";
              await adapter.sendText(
                connection,
                m.chatId,
                `No pude procesar ${decision} ${paymentId}: ${explanation}`,
                `approval-error:${m.id}`,
              );
              await this.db.webhookInbox.update({
                where: { id: item.id },
                data: {
                  status: "DONE",
                  processedAt: new Date(),
                  lastError: null,
                  payload: { event: payload.event },
                },
              });
              return;
            }
            await this.sales.dispatch(workspaceId);
            await adapter.sendText(
              connection,
              m.chatId,
              decision === "ENTREGADO"
                ? `Pago ${paymentId} aprobado. Entrega manual registrada; no se envió el curso.`
                : decision === "APROBAR"
                  ? `Pago ${paymentId} aprobado. Se inició la entrega al cliente.`
                  : `Pago ${paymentId} rechazado. Si la conversación está atendida por vos, el agente permanece en silencio.`,
              `approval-result:${m.id}`,
            );
          }
          await this.db.webhookInbox.update({
            where: { id: item.id },
            data: {
              status: "DONE",
              processedAt: new Date(),
              lastError: null,
              payload: { event: payload.event },
            },
          });
          return;
        }
        const known = await this.db.conversation.findUnique({
          where: {
            workspaceId_connectionId_contact: {
              workspaceId,
              connectionId: connection.id,
              contact: m.chatId,
            },
          },
          select: { id: true },
        });
        const identity = {
          contactName:
            contactName(m.contact?.name) || contactName(m.contact?.pushName),
          contactPhone: phoneFromContact(m.chatId) || validPhone(m.senderPhone),
        };
        // Optional enrichment must never prevent receiving a new customer's message.
        if (!known && (!identity.contactName || !identity.contactPhone)) {
          const details = await adapter.contactDetails(connection, m.chatId);
          identity.contactName ||= details.contactName;
          identity.contactPhone ||= details.contactPhone;
        }
        const { media, mediaUnavailable } = await readReceiptMedia(
          m,
          adapter,
          connection,
        );
        // A signed inbound message proves this registered session received a message.
        await this.db.connection.update({
          where: { id: connection.id },
          data: { status: "CONNECTED" },
        });
        const received = await this.sales.receive(workspaceId, {
          connectionId: connection.id,
          eventId: m.id,
          contact: m.chatId,
          ...identity,
          text: (m.body || "").slice(0, 4000),
          media,
          mediaUnavailable,
        });
        if (received.paymentId)
          await this.sales.verifyReceipt(workspaceId, received.paymentId);
        if (media && (m.type === "image" || m.type === "document")) {
          await notifyPendingReceipt(
            this.db,
            adapter,
            connection,
            workspaceId,
            received.conversationId,
            workspace.approvalPhone,
          );
        }
      } else {
        // Query current status instead of replaying a potentially stale status event.
        const status = await adapter.status(connection);
        await this.db.connection.update({
          where: { id: connection.id },
          data: { status: status.status },
        });
      }
      await this.db.webhookInbox.update({
        where: { id: item.id },
        data: {
          status: "DONE",
          processedAt: new Date(),
          lastError: null,
          payload: { event: payload.event },
        },
      });
    } catch {
      const terminal = item.attempts >= 4;
      await this.db.webhookInbox.update({
        where: { id: item.id },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(
            Date.now() + Math.min(60000, 5000 * 2 ** item.attempts),
          ),
          lastError:
            "No se pudo procesar. Revisá sesión, credenciales y disponibilidad; el evento se conserva.",
        },
      });
      if (terminal)
        await this.db.notification.create({
          data: {
            workspaceId,
            text: `Webhook ${item.id} requiere atención. Podés reintentarlo desde Integraciones.`,
          },
        });
    }
  }
}
