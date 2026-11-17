import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import { HttpError } from "../security.js";
import { adapterFor, OpenWAAdapter } from "../messaging.js";
import { idParam } from "./context.js";


export function registerConnectionRoutes(
  app: FastifyInstance,
  { db, integrations, managedOpenwa, scope, setupAdmin, config }: Pick<RouteContext, "db" | "integrations" | "managedOpenwa" | "scope" | "setupAdmin" | "config">,
) {
  app.get("/api/connections", async (req) =>
    db.connection.findMany({
      where: { workspaceId: await scope(req) },
      orderBy: { createdAt: "asc" },
    }),
  );
  app.get("/api/connections/live-status", async (req) => {
    await setupAdmin(req);
    const workspaceId = await scope(req);
    const connections = await db.connection.findMany({
      where: { workspaceId, provider: "OPENWA" },
      orderBy: { createdAt: "asc" },
    });
    if (!connections.length) return [];
    const runtime = await integrations.resolve(workspaceId);
    const adapter = new OpenWAAdapter(runtime);
    return Promise.all(
      connections.map(async (connection) => {
        const checkedAt = new Date().toISOString();
        try {
          const { status, phone } = await adapter.status(connection);
          if (status !== connection.status)
            await db.connection.update({
              where: { id: connection.id },
              data: { status },
            });
          return { id: connection.id, status, phone: phone || null, checkedAt };
        } catch {
          // The last saved status is historical, never proof of a live connection.
          return { id: connection.id, status: "UNAVAILABLE", phone: null, checkedAt };
        }
      }),
    );
  });
  app.post("/api/connections/managed", async (req) => {
    await setupAdmin(req);
    const workspaceId = await scope(req, true);
    await managedOpenwa.prepare(workspaceId);
    return { ok: true };
  });
  app.post("/api/connections", async (req) => {
    const workspaceId = await scope(req, true);
    const runtime = await integrations.resolve(workspaceId);
    const data = z
      .object({
        name: z.string().min(2).max(80),
        provider: z.enum(["MOCK", "OPENWA"]).default("MOCK"),
        sessionId: z.string().uuid().optional(),
      })
      .parse(req.body);
    if (
      data.provider === "OPENWA" &&
      (!runtime.openwaEnabled || !data.sessionId)
    )
      throw new HttpError(
        409,
        "Habilitá OpenWA en el servidor y registrá el ID de una sesión existente.",
      );
    return db.connection.create({
      data: {
        workspaceId,
        name: data.name,
        provider: data.provider,
        sessionId: data.sessionId || randomUUID(),
      },
    });
  });
  app.post("/api/connections/openwa", async (req) => {
    const workspaceId = await scope(req, true);
    const runtime = await integrations.resolve(workspaceId);
    if ((runtime as Config & { managed?: boolean }).managed)
      throw new HttpError(
        409,
        "Este negocio ya tiene una sesión preparada. Usá Mostrar QR para vincularla.",
      );
    const { name } = z
      .object({ name: z.string().trim().min(2).max(80) })
      .parse(req.body);
    if (!runtime.openwaEnabled || !runtime.openwaKey)
      throw new HttpError(
        409,
        "OpenWA está deshabilitado o no tiene una API key configurada.",
      );
    const adapter = new OpenWAAdapter(runtime);
    const provisioned = await adapter.createSession(
      `nexo-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    );
    const connection = await db.connection.create({
      data: {
        workspaceId,
        name,
        provider: "OPENWA",
        sessionId: provisioned.sessionId,
        status: provisioned.status,
      },
    });
    let webhookRegistered = false;
    try {
      await adapter.registerWebhook(
        connection,
        `${(runtime.openwaWebhookBaseUrl || runtime.publicUrl).replace(/\/$/, "")}/api/webhooks/openwa/${workspaceId}`,
      );
      webhookRegistered = true;
    } catch {
      // The session remains usable. The administrator can repair reception later.
    }
    return { ...connection, webhookRegistered };
  });
  app.post("/api/connections/:id/connect", async (req) => {
    await setupAdmin(req);
    const workspaceId = await scope(req, true);
    const connection = await db.connection.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: idParam(req) } },
    });
    if (config.openwaSetupMode && connection.provider !== "OPENWA")
      throw new HttpError(409, "En preparación sólo se habilitan sesiones OpenWA.");
    const result = await adapterFor(
      connection.provider,
      await integrations.resolve(workspaceId),
    ).connect(connection);
    await db.connection.update({
      where: { id: connection.id },
      data: { status: result.status },
    });
    return result;
  });
  app.post("/api/connections/:id/stop", async (req) => {
    const workspaceId = await scope(req, true);
    const connection = await db.connection.findFirst({
      where: { workspaceId, id: idParam(req), provider: "OPENWA" },
    });
    if (!connection) throw new HttpError(404, "WhatsApp no encontrado.");
    const result = await new OpenWAAdapter(
      await integrations.resolve(workspaceId),
    ).stop(connection);
    await db.connection.update({
      where: { id: connection.id },
      data: { status: result.status },
    });
    return result;
  });
  app.post("/api/connections/:id/prepare-qr", async (req) => {
    await setupAdmin(req);
    const workspaceId = await scope(req, true);
    const connection = await db.connection.findFirst({
      where: { workspaceId, id: idParam(req), provider: "OPENWA" },
    });
    if (!connection) throw new HttpError(404, "Conexión OpenWA no encontrada.");
    const result = await new OpenWAAdapter(
      await integrations.resolve(workspaceId),
    ).prepareQr(connection);
    await db.connection.update({
      where: { id: connection.id },
      data: { status: result.status },
    });
    return result;
  });
}
