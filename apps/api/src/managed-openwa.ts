import type { PrismaClient } from "@nexo/database";
import type { Config } from "./config.js";
import { IntegrationSettings } from "./integrations.js";
import { OpenWAAdapter } from "./messaging.js";
import { HttpError } from "./security.js";

// One provisioning operation per business in this server process. Run one API
// instance until cross-process coordination is added.
export class ManagedOpenWA {
  private pending = new Map<string, Promise<void>>();
  constructor(
    private db: PrismaClient,
    private config: Config,
    private settings: IntegrationSettings,
  ) {}
  available() {
    return !!this.config.managedOpenwaAdminKey &&
      (!this.config.forceSimulation || !!this.config.openwaSetupMode);
  }
  async prepare(workspaceId: string) {
    const existing = this.pending.get(workspaceId);
    if (existing) return existing;
    const task = this.run(workspaceId).finally(() =>
      this.pending.delete(workspaceId),
    );
    this.pending.set(workspaceId, task);
    return task;
  }
  private async run(workspaceId: string) {
    if (!this.available())
      throw new HttpError(
        503,
        "El administrador todavía no habilitó la preparación automática de WhatsApp.",
      );
    const runtime = await this.settings.resolve(workspaceId);
    const connections = await this.db.connection.findMany({
      where: { workspaceId, provider: "OPENWA" },
    });
    if (runtime.openwaEnabled && runtime.openwaKey) {
      if (connections.length) {
        if ((runtime as Config & { managed?: boolean }).managed)
          await new OpenWAAdapter(runtime).registerWebhook(
            connections[0],
            `${runtime.publicUrl}/api/webhooks/openwa/${workspaceId}`,
          );
        return;
      }
      if (!(runtime as Config & { managed?: boolean }).managed)
        throw new HttpError(
          409,
          "Ya hay una configuración de WhatsApp: revisala antes de continuar.",
        );
    }
    if (
      (runtime.openwaKey &&
        !(runtime as Config & { managed?: boolean }).managed) ||
      connections.length
    )
      throw new HttpError(
        409,
        "Ya existe una conexión de WhatsApp; revisala antes de continuar.",
      );
    const base = this.config.openwaUrl.replace(/\/$/, "");
    const adminKey = this.config.managedOpenwaAdminKey!;
    const request = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: { "X-API-Key": adminKey, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
      if (!response.ok)
        throw new HttpError(
          502,
          `OpenWA no pudo preparar la conexión (HTTP ${response.status}).`,
        );
      return response.json();
    };
    const name = `nexo-managed-${workspaceId}`;
    const sessions = await request("/sessions");
    if (!Array.isArray(sessions))
      throw new HttpError(
        502,
        "OpenWA devolvió una lista de sesiones inválida.",
      );
    const matching = sessions.filter((s: any) => s.name === name);
    if (matching.length > 1)
      throw new HttpError(
        409,
        "Hay sesiones duplicadas que requieren revisión del administrador.",
      );
    const session =
      matching[0] || (await request("/sessions", "POST", { name }));
    if (
      typeof session.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.id)
    )
      throw new HttpError(502, "OpenWA devolvió una sesión inválida.");
    if (!runtime.openwaKey) {
      const key = await request("/auth/api-keys", "POST", {
        name: `Nexo ${workspaceId}`,
        role: "operator",
        allowedSessions: [session.id],
      });
      if (typeof key.apiKey !== "string" || typeof key.id !== "string")
        throw new HttpError(502, "OpenWA no devolvió una clave válida.");
      try {
        await this.settings.saveManaged(workspaceId, key.apiKey);
      } catch (error) {
        try {
          await request(
            `/auth/api-keys/${encodeURIComponent(key.id)}`,
            "DELETE",
          );
        } catch {
          /* administrator can revoke the unused key */
        }
        throw error;
      }
    }
    await this.db.connection.create({
      data: {
        workspaceId,
        name: "WhatsApp del negocio",
        provider: "OPENWA",
        sessionId: session.id,
        status: String(session.status || "created").toUpperCase(),
      },
    });
    const saved = await this.settings.resolve(workspaceId);
    const connection = await this.db.connection.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    await new OpenWAAdapter(saved).registerWebhook(
      connection,
      `${(saved.openwaWebhookBaseUrl || saved.publicUrl).replace(/\/$/, "")}/api/webhooks/openwa/${workspaceId}`,
    );
  }
}
