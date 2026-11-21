import { Prisma, type Connection, type Product } from "@nexo/database";
import type {
  CourseReplyRequest,
  CourseReplyResult,
} from "../../../../packages/shared/src/course-replies.js";
import type { Config } from "../config.js";
import { HttpError, sha256 } from "../security.js";
import { productIntroduction } from "../seller.js";
import type { SalesContext } from "./context.js";
import { assertResponseImages } from "./outgoing.js";

type Tx = Prisma.TransactionClient;
type Runtime = Config & { managed?: boolean; managedSessionId?: string };
const latestFirst = [
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.MessageOrderByWithRelationInput[];

export const emptyCourseQuote = {
  quotedPriceCents: null,
  quotedCurrency: null,
  selectedPackNumber: null,
  selectedPackName: null,
  selectedPackDeliveryMessage: null,
};

export async function queueCourseWelcome(
  context: SalesContext,
  tx: Tx,
  workspaceId: string,
  conversationId: string,
  product: Product,
  key: string,
) {
  const first = await context.outgoing(
    tx,
    workspaceId,
    conversationId,
    productIntroduction(product),
    key,
    undefined,
    "AUTO",
    product.firstImageId,
  );
  for (const [index, message] of product.followUpMessages.entries()) {
    await context.outgoing(
      tx,
      workspaceId,
      conversationId,
      message,
      `${key}:followup:${index}`,
      new Date(first.createdAt.getTime() + index + 1),
      "AUTO",
      product.followUpImageIds[index] || null,
    );
  }
}

async function workspaceRuntime(
  context: SalesContext,
  workspaceId: string,
): Promise<Runtime> {
  return (await context.integrations?.resolve(workspaceId)) || context.config;
}

function channelCanSend(
  connection: Pick<Connection, "status" | "provider" | "sessionId">,
  runtime: Runtime,
) {
  if (connection.status !== "CONNECTED") return false;
  if (connection.provider === "MOCK") return true;
  return (
    connection.provider === "OPENWA" &&
    runtime.openwaEnabled &&
    !!runtime.openwaKey &&
    !runtime.forceSimulation &&
    (!runtime.managed || connection.sessionId === runtime.managedSessionId)
  );
}

type UnansweredAnchor = { conversationId: string; messageId: string };

async function unansweredAnchors(
  db: Pick<Tx, "connection" | "$queryRaw">,
  workspaceId: string,
  runtime: Runtime,
  { targetIds, provider }: { targetIds?: string[]; provider?: "OPENWA" } = {},
) {
  const connections = await db.connection.findMany({
    where: { workspaceId, status: "CONNECTED", provider },
    select: { id: true, status: true, provider: true, sessionId: true },
  });
  const connectionIds = connections
    .filter((c) => channelCanSend(c, runtime))
    .map((c) => c.id);
  if (!connectionIds.length || (targetIds && !targetIds.length)) return [];
  const cutoff = runtime.automationCutoffAt;
  const greetings = (runtime.automaticOwnMessages ?? []).map((text) =>
    text.trim().normalize("NFC"),
  );
  // Find the last meaningful message per chat before limiting the result. An
  // external greeting, including one recorded before it was configured, is not a reply.
  return db.$queryRaw<UnansweredAnchor[]>(Prisma.sql`
    WITH eligible AS (
      SELECT c."id"
      FROM "Conversation" c
      WHERE c."workspaceId" = ${workspaceId}
        AND c."connectionId" IN (${Prisma.join(connectionIds)})
        ${targetIds ? Prisma.sql`AND c."id" IN (${Prisma.join(targetIds)})` : Prisma.empty}
        AND c."state" NOT IN ('REVIEW', 'WON', 'AWAITING_PAYMENT')
        AND c."quotedPriceCents" IS NULL
        AND c."marketingOptOutAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Payment" p
          WHERE p."workspaceId" = ${workspaceId} AND p."conversationId" = c."id" AND p."status" = 'PENDING'
        )
    ), last_message AS (
      SELECT DISTINCT ON (m."conversationId")
        m."conversationId", m."id" AS "messageId", m."createdAt", m."direction", m."assetId", m."text"
      FROM "Message" m
      JOIN eligible c ON c."id" = m."conversationId"
      WHERE m."workspaceId" = ${workspaceId}
        ${cutoff ? Prisma.sql`AND m."createdAt" >= ${cutoff}` : Prisma.empty}
        AND (m."direction" = 'IN' OR (
          m."direction" = 'OUT' AND m."status" = 'SENT' AND m."origin" <> 'EXTERNAL_AUTO'
          ${
            greetings.length
              ? Prisma.sql`AND NOT (
            m."externalId" LIKE 'own:%' AND normalize(btrim(m."text"), NFC) IN (${Prisma.join(greetings)})
          )`
              : Prisma.empty
          }
        ))
      ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
    )
    SELECT l."conversationId", l."messageId"
    FROM last_message l
    WHERE l."direction" = 'IN' AND l."assetId" IS NULL AND btrim(l."text") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "Message" o
        WHERE o."workspaceId" = ${workspaceId} AND o."conversationId" = l."conversationId"
          AND o."direction" = 'OUT' AND (o."status" = 'NEEDS_REVIEW' OR (
            o."status" = 'PENDING' ${cutoff ? Prisma.sql`AND o."createdAt" >= ${cutoff}` : Prisma.empty}
          ))
      )
    ORDER BY l."createdAt" DESC, l."messageId" DESC
    LIMIT 200
  `);
}

export async function listUnanswered(
  context: SalesContext,
  workspaceId: string,
  provider?: "OPENWA",
) {
  const runtime = await workspaceRuntime(context, workspaceId);
  const anchors = await unansweredAnchors(context.db, workspaceId, runtime, {
    provider,
  });
  if (!anchors.length) return [];
  const [chats, messages] = await Promise.all([
    context.db.conversation.findMany({
      where: { workspaceId, id: { in: anchors.map((a) => a.conversationId) } },
      include: { product: { select: { name: true } } },
    }),
    context.db.message.findMany({
      where: { workspaceId, id: { in: anchors.map((a) => a.messageId) } },
      select: {
        id: true,
        text: true,
        direction: true,
        status: true,
        assetId: true,
        createdAt: true,
      },
    }),
  ]);
  const chatsById = new Map(chats.map((c) => [c.id, c]));
  const messagesById = new Map(messages.map((m) => [m.id, m]));
  return anchors.flatMap((anchor) => {
    const chat = chatsById.get(anchor.conversationId);
    const message = messagesById.get(anchor.messageId);
    return chat && message ? [{ ...chat, messages: [message] }] : [];
  });
}

export async function startCourseReplies(
  context: SalesContext,
  workspaceId: string,
  { productId, unansweredOnly, targets }: CourseReplyRequest,
): Promise<CourseReplyResult[]> {
  const runtime = await workspaceRuntime(context, workspaceId);
  if (runtime.preview === false && !runtime.automationCutoffAt)
    throw new HttpError(
      409,
      "El envío automático no está habilitado en este servidor.",
    );
  return context.locked(workspaceId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { workspaceId, id: productId, active: true, agentEnabled: true },
    });
    if (!product)
      throw new HttpError(
        404,
        "Elegí un curso activo con el agente habilitado.",
      );
    await assertResponseImages(tx, workspaceId, [
      product.firstImageId,
      ...product.followUpImageIds,
    ]);
    const ids = targets.map((target) => target.conversationId);
    const chats = await tx.conversation.findMany({
      where: { workspaceId, id: { in: ids } },
      include: {
        connection: true,
        messages: { orderBy: latestFirst, take: 1, select: { id: true } },
        payments: {
          where: { status: "PENDING" },
          take: 1,
          select: { id: true },
        },
      },
    });
    const byId = new Map(chats.map((c) => [c.id, c]));
    const unanswered = unansweredOnly
      ? new Map(
          (
            await unansweredAnchors(tx, workspaceId, runtime, {
              targetIds: ids,
            })
          ).map((a) => [a.conversationId, a.messageId]),
        )
      : null;
    const blocked = new Set(
      (
        await tx.message.findMany({
          where: {
            workspaceId,
            conversationId: { in: ids },
            direction: "OUT",
            OR: [
              { status: "NEEDS_REVIEW" },
              {
                status: "PENDING",
                ...(runtime.automationCutoffAt
                  ? { createdAt: { gte: runtime.automationCutoffAt } }
                  : {}),
              },
            ],
          },
          select: { conversationId: true },
          distinct: ["conversationId"],
        })
      ).map((m) => m.conversationId),
    );
    const results: CourseReplyResult[] = [];
    for (const { conversationId, expectedMessageId } of targets) {
      const skip = (reason: string) =>
        results.push({ conversationId, status: "SKIPPED", reason });
      const chat = byId.get(conversationId);
      if (!chat) {
        skip("La conversación no está disponible.");
        continue;
      }
      const key = `course-start:${sha256(JSON.stringify([workspaceId, conversationId, productId, expectedMessageId]))}`;
      if (
        await tx.message.findUnique({
          where: { externalId: key },
          select: { id: true },
        })
      ) {
        results.push({ conversationId, status: "ALREADY_QUEUED" });
        continue;
      }
      if (!channelCanSend(chat.connection, runtime)) {
        skip(
          "El WhatsApp de esta conversación no está disponible para enviar.",
        );
        continue;
      }
      if (
        chat.marketingOptOutAt ||
        chat.state === "REVIEW" ||
        chat.payments.length
      ) {
        skip(
          chat.marketingOptOutAt
            ? "El contacto pidió dejar de recibir mensajes."
            : "Hay un pago pendiente de revisión.",
        );
        continue;
      }
      if (blocked.has(chat.id)) {
        skip(
          "Hay un envío pendiente o sin confirmar. Revisá el historial del chat.",
        );
        continue;
      }
      const currentAnchor = unanswered
        ? unanswered.get(chat.id)
        : (chat.messages[0]?.id ?? null);
      if (currentAnchor !== expectedMessageId) {
        skip("El chat cambió. Revisá los mensajes antes de volver a enviar.");
        continue;
      }
      if (
        (unansweredOnly && chat.productId && chat.productId !== productId) ||
        (chat.state === "WON" && chat.productId === productId)
      ) {
        skip(
          chat.state === "WON"
            ? "Este curso ya figura aprobado en el chat."
            : "El chat tiene otro curso asignado. Abrilo para revisarlo.",
        );
        continue;
      }
      const keepQuote =
        chat.state !== "WON" &&
        chat.productId === productId &&
        chat.quotedPriceCents !== null;
      if (
        chat.state !== "WON" &&
        chat.quotedPriceCents !== null &&
        !keepQuote
      ) {
        skip("Hay una cotización vigente para otro curso.");
        continue;
      }
      await tx.conversation.update({
        where: { workspaceId_id: { workspaceId, id: chat.id } },
        data: {
          ...(keepQuote ? {} : emptyCourseQuote),
          productId,
          state: keepQuote ? "AWAITING_PAYMENT" : "QUALIFIED",
          paused: false,
          humanControlled: false,
        },
      });
      await queueCourseWelcome(context, tx, workspaceId, chat.id, product, key);
      if (
        chat.productId !== productId ||
        chat.state === "WON" ||
        chat.state === "DISCOVERY"
      ) {
        await tx.integrationEvent.create({
          data: {
            workspaceId,
            type: "lead.qualified.v1",
            payload: { conversationId, productId, referral: {} },
          },
        });
      }
      results.push({ conversationId, status: "QUEUED" });
    }
    return results;
  });
}
