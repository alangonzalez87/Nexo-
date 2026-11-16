import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { z, ZodError } from "zod";
import { Prisma, type PrismaClient } from "@nexo/database";
import type { Config } from "./config.js";
import { hashPassword, verifyPassword, HttpError, sha256 } from "./security.js";
import { SalesService } from "./sales.js";
import { IntegrationSettings } from "./integrations.js";
import { WebhookService } from "./webhooks.js";
import { ManagedOpenWA } from "./managed-openwa.js";
import type { Selector } from "./seller.js";
import type { RouteContext } from "./routes/context.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerCampaignRoutes } from "./routes/campaigns.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerSimulatorRoutes } from "./routes/simulator.js";
import { registerSalesRoutes } from "./routes/sales.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export async function buildApp(
  db: PrismaClient,
  config: Config,
  selector?: Selector,
) {
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, { origin: config.webOrigin });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 3 },
  });
  await app.register(rateLimit, {
    max: 240, timeWindow: "1 minute",
    keyGenerator: async (req) => {
      try {
        await req.jwtVerify();
        return `user:${(req.user as { sub: string }).sub}`;
      } catch {
        return `ip:${req.ip}`;
      }
    },
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });
  const integrations = new IntegrationSettings(db, config);
  const managedOpenwa = new ManagedOpenWA(db, config, integrations);
  const sales = new SalesService(db, config, selector, integrations);
  const webhooks = new WebhookService(db, integrations, sales);
  const auth = async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, "Iniciá sesión para continuar.");
    }
  };
  const identity = (req: FastifyRequest) => (req.user as { sub: string }).sub;
  const platformAdmin = async (req: FastifyRequest) => {
    await auth(req);
    const user = await db.user.findUnique({ where: { id: identity(req) } });
    if (
      !user ||
      !config.platformAdminEmail ||
      user.email.toLowerCase() !== config.platformAdminEmail
    )
      throw new HttpError(
        403,
        "Solo el administrador de Nexo puede gestionar cuentas.",
      );
    return user;
  };
  const scope = async (req: FastifyRequest, write = false) => {
    await auth(req);
    const workspaceId = z.string().min(1).parse(req.headers["x-workspace-id"]);
    const membership = await db.membership.findUnique({
      where: { userId_workspaceId: { userId: identity(req), workspaceId } },
    });
    if (!membership || (write && membership.role !== "ADMIN"))
      throw new HttpError(403, "No tenés permiso en este negocio.");
    return workspaceId;
  };
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      return reply.code(error.code === "P2002" ? 409 : 400).send({
        error:
          error.code === "P2002"
            ? "Ya existe un recurso con esos datos."
            : "La operación no pudo completarse.",
      });
    const status = (error as { statusCode?: number }).statusCode || 500;
    return reply.code(status).send({
      error:
        status >= 500 && !(error instanceof HttpError)
          ? "Error interno. Revisá la disponibilidad del servicio."
          : (error as Error).message,
    });
  });
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      messagingDefault: "MOCK",
      ai: "configured-per-workspace",
    };
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: {
      max: 10, timeWindow: "1 minute", hook: "preHandler",
      keyGenerator: (req: FastifyRequest) => {
        const email = (req.body as { email?: unknown } | null)?.email;
        return typeof email === "string" && email.length <= 254
          ? `login:${sha256(email.trim().toLowerCase())}`
          : `login-invalid:${req.ip}`;
      },
    } } },
    async (req) => {
      const body = z
        .object({
          email: z.string().trim().email().max(254),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const user = await db.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      if (!user || !verifyPassword(body.password, user.passwordHash))
        throw new HttpError(401, "Correo o contraseña incorrectos.");
      return {
        token: app.jwt.sign({ sub: user.id }, { expiresIn: "8h" }),
        email: user.email,
      };
    },
  );
  app.get("/api/workspaces", async (req) => {
    await auth(req);
    return db.membership.findMany({
      where: { userId: identity(req) },
      include: { workspace: true },
    });
  });
  app.get("/api/auth/me", async (req) => {
    await auth(req);
    const user = await db.user.findUnique({ where: { id: identity(req) } });
    if (!user) throw new HttpError(401, "Iniciá sesión para continuar.");
    return {
      email: user.email,
      platformAdmin:
        !!config.platformAdminEmail &&
        user.email.toLowerCase() === config.platformAdminEmail,
    };
  });
  app.get("/api/admin/accounts", async (req) => {
    const admin = await platformAdmin(req);
    return db.user.findMany({
      where: { id: { not: admin.id } },
      select: {
        id: true,
        email: true,
        memberships: {
          select: { workspace: { select: { id: true, name: true } } },
        },
      },
      orderBy: { email: "asc" },
    });
  });
  app.post("/api/admin/accounts", async (req) => {
    const admin = await platformAdmin(req);
    const data = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        password: z.string().min(12).max(200),
      })
      .parse(req.body);
    const account = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: data.email, passwordHash: hashPassword(data.password) },
      });
      const workspace = await tx.workspace.create({
        data: {
          name: data.name,
          memberships: {
            create: [
              { userId: admin.id, role: "ADMIN" },
              { userId: user.id, role: "ADMIN" },
            ],
          },
        },
      });
      return {
        email: user.email,
        workspace: { id: workspace.id, name: workspace.name },
      };
    });
    let whatsappPrepared = false;
    if (managedOpenwa.available()) {
      try {
        await managedOpenwa.prepare(account.workspace.id);
        whatsappPrepared = true;
      } catch {
        // The account is usable; provisioning can be retried from its panel.
      }
    }
    return { ...account, whatsappPrepared };
  });
  app.post("/api/workspaces", async (req) => {
    const admin = await platformAdmin(req);
    const { name } = z
      .object({ name: z.string().min(2).max(80) })
      .parse(req.body);
    return db.workspace.create({
      data: {
        name,
        memberships: { create: { userId: admin.id, role: "ADMIN" } },
      },
    });
  });
  const routes: RouteContext = {
    db, config, sales, integrations, managedOpenwa, webhooks, scope, identity,
  };
  registerWorkspaceRoutes(app, routes);
  registerProductRoutes(app, routes);
  registerCampaignRoutes(app, routes);
  registerConnectionRoutes(app, routes);
  registerSimulatorRoutes(app, routes);
  registerSalesRoutes(app, routes);
  registerAssetRoutes(app, routes);
  registerIntegrationRoutes(app, routes);
  registerWebhookRoutes(app, routes);
  return { app, sales, webhooks, integrations };
}
