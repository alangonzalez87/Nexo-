import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@nexo/database";
import { z } from "zod";
import type { Config } from "../config.js";
import type { SalesService } from "../sales.js";
import type { IntegrationSettings } from "../integrations.js";
import type { ManagedOpenWA } from "../managed-openwa.js";
import type { WebhookService } from "../webhooks.js";

/** Shared services and access checks created once by buildApp. */
export interface RouteContext {
  db: PrismaClient;
  config: Config;
  sales: SalesService;
  integrations: IntegrationSettings;
  managedOpenwa: ManagedOpenWA;
  webhooks: WebhookService;
  scope: (req: FastifyRequest, write?: boolean) => Promise<string>;
  identity: (req: FastifyRequest) => string;
  setupAdmin?: (req: FastifyRequest) => Promise<void>;
}

export const idParam = (req: FastifyRequest) =>
  z.object({ id: z.string().min(1) }).parse(req.params).id;
