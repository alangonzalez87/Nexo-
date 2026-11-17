import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../security.js";
import { detectMime } from "../storage.js";
import { OpenAISelector } from "../seller.js";
import { OpenAIReceiptVerifier } from "../receipt-verification.js";
import { idParam } from "./context.js";


export function registerIntegrationRoutes(
  app: FastifyInstance,
  { db, integrations, scope, setupAdmin }: Pick<RouteContext, "db" | "integrations" | "scope" | "setupAdmin">,
) {
  app.get("/api/integrations/events", async (req) => {
    const workspaceId = await scope(req);
    const { after } = z
      .object({ after: z.string().optional() })
      .parse(req.query);
    if (
      after &&
      !(await db.integrationEvent.findFirst({
        where: { workspaceId, id: after },
      }))
    )
      throw new HttpError(400, "Cursor inválido.");
    return db.integrationEvent.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
  });
  app.get("/api/integrations/config", async (req, reply) => {
    await setupAdmin?.(req);
    reply.header("Cache-Control", "no-store");
    return integrations.view(await scope(req, true));
  });
  app.put("/api/integrations/config", async (req) =>
    integrations.save(await scope(req, true), req.body),
  );
  app.post("/api/integrations/test-openai", async (req) => {
    const runtime = await integrations.resolve(await scope(req, true));
    if (runtime.aiProvider !== "openai" || !runtime.openaiKey)
      throw new HttpError(409, "Guardá y habilitá OpenAI primero.");
    try {
      const ids = await new OpenAISelector(runtime).select(
        "¿Cuál es el código de prueba?",
        [{ id: "test", text: "El código de prueba es NEXO." }],
        [],
      );
      if (!ids.includes("test")) throw new Error("Invalid structured output");
      return {
        ok: true,
        detail: "Responses API respondió con el formato esperado.",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const status = Number((error as { status?: number }).status) || null;
      return {
        ok: false,
        detail: `No se pudo validar Responses API${status ? ` (HTTP ${status})` : ""}. Revisá clave, modelo, saldo y conectividad.`,
        checkedAt: new Date().toISOString(),
      };
    }
  });
  app.post("/api/integrations/test-receipt", async (req) => {
    const workspaceId = await scope(req, true);
    const runtime = await integrations.resolve(workspaceId);
    if (runtime.aiProvider !== "openai" || !runtime.openaiKey || runtime.forceSimulation)
      throw new HttpError(409, "Habilitá OpenAI en este negocio antes de probar un comprobante.");
    const file = await req.file();
    if (!file) throw new HttpError(400, "Seleccioná un PDF o imagen.");
    const bytes = await file.toBuffer();
    const mime = detectMime(bytes);
    const dir = await mkdtemp(join(tmpdir(), "nexo-receipt-probe-"));
    try {
      const path = join(dir, "comprobante");
      await writeFile(path, bytes, { mode: 0o600 });
      const fields = await new OpenAIReceiptVerifier().extract(path, mime, runtime);
      return { ok: true, fields };
    } catch (error) {
      return { ok: false, detail: `No se pudo leer el archivo con OpenAI${Number((error as { status?: number }).status) ? ` (HTTP ${(error as { status?: number }).status})` : ""}.`, fields: null };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  app.get("/api/integrations/inbox", async (req) =>
    db.webhookInbox.findMany({
      where: { workspaceId: await scope(req, true) },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        status: true,
        attempts: true,
        createdAt: true,
        lastError: true,
      },
    }),
  );
  app.post("/api/integrations/inbox/:id/retry", async (req) => {
    const result = await db.webhookInbox.updateMany({
      where: {
        workspaceId: await scope(req, true),
        id: idParam(req),
        status: "FAILED",
      },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (!result.count)
      throw new HttpError(
        409,
        "Sólo se puede reintentar un evento fallido de este negocio.",
      );
    return { ok: true };
  });
}
