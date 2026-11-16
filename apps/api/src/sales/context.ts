import type { PrismaClient, Prisma, Message } from "@nexo/database";
import type { Config } from "../config.js";
import type { IntegrationSettings } from "../integrations.js";
import type { Selector } from "../seller.js";
import type { ReceiptVerifier } from "../receipt-verification.js";

export interface SalesContext {
  db: PrismaClient;
  config: Config;
  integrations?: IntegrationSettings;
  selector?: Selector;
  receiptVerifier: ReceiptVerifier;
  locked<T>(
    workspaceId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  outgoing(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    conversationId: string,
    text: string,
    key: string,
    createdAt?: Date,
    origin?: "AUTO" | "HUMAN" | "PAYMENT",
    imageId?: string | null,
  ): Promise<Message>;
}
