import type { Prisma } from "@nexo/database";

// Keep manually composed messages, but cancel every older queued bot/payment send.
// A subsequent explicit "approve and send" is a new, authorized PAYMENT message.
export async function cancelPendingAutomation(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  conversationId: string,
) {
  await tx.message.updateMany({
    where: {
      workspaceId,
      conversationId,
      direction: "OUT",
      status: "PENDING",
      origin: { not: "HUMAN" },
    },
    data: { status: "CANCELLED" },
  });
}

export async function takeHumanControl(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  conversation: { id: string; state: string },
) {
  await cancelPendingAutomation(tx, workspaceId, conversation.id);
  return tx.conversation.update({
    where: { id: conversation.id },
    data: {
      humanControlled: true,
      paused: true,
      state: ["REVIEW", "WON"].includes(conversation.state)
        ? conversation.state
        : "HUMAN",
    },
  });
}
