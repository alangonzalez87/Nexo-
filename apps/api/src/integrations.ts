import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { PrismaClient } from "@nexo/database";
import { z } from "zod";
import type { Config } from "./config.js";
import { HttpError } from "./security.js";

const endpoint = z
  .string()
  .url()
  .max(1000)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      ["", "/"].includes(u.pathname)
    );
  }, "Usá el origen del gateway, sin /api, credenciales ni parámetros.");
export const integrationSchema = z.object({
  openwaEnabled: z.boolean(),
  openwaUrl: endpoint,
  aiProvider: z.enum(["rules", "openai"]),
  openaiModel: z.string().trim().min(1).max(100),
  publicUrl: endpoint,
  openwaKey: z.string().min(1).max(2048).optional(),
  openaiKey: z.string().min(1).max(2048).optional(),
  webhookSecret: z.string().min(32).max(255).optional(),
  clearOpenwaKey: z.boolean().optional(),
  clearOpenaiKey: z.boolean().optional(),
  automaticOwnMessages: z
    .array(z.string().trim().min(1).max(1000))
    .max(10)
    .optional(),
});
type Saved = Pick<
  Config,
  | "openwaEnabled"
  | "openwaUrl"
  | "openwaKey"
  | "webhookSecret"
  | "aiProvider"
  | "openaiKey"
  | "openaiModel"
  | "publicUrl"
  | "automaticOwnMessages"
> & { managed?: boolean };
const savedKeys = new Set<string>([
  "openwaEnabled",
  "openwaUrl",
  "openwaKey",
  "webhookSecret",
  "aiProvider",
  "openaiKey",
  "openaiModel",
  "publicUrl",
  "managed",
  "automaticOwnMessages",
] satisfies (keyof Saved)[]);
export class IntegrationSettings {
  private key: Buffer;
  constructor(
    private db: PrismaClient,
    private defaults: Config,
  ) {
    this.key = createHash("sha256")
      .update(defaults.credentialsKey || defaults.jwtSecret)
      .digest();
  }
  private encrypt(workspaceId: string, value: Saved) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(workspaceId));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString("base64"))
      .join(".");
  }
  private decrypt(workspaceId: string, value: string): Saved {
    try {
      const [iv, tag, data] = value
        .split(".")
        .map((v) => Buffer.from(v, "base64"));
      const cipher = createDecipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(workspaceId));
      cipher.setAuthTag(tag);
      const saved = JSON.parse(
        Buffer.concat([cipher.update(data), cipher.final()]).toString(),
      );
      // Only active settings are carried forward from older encrypted records.
      return Object.fromEntries(
        Object.entries(saved).filter(([key]) => savedKeys.has(key)),
      ) as Saved;
    } catch {
      throw new HttpError(
        503,
        "No se pudieron descifrar las credenciales. Revisá CREDENTIALS_KEY.",
      );
    }
  }
  async resolve(workspaceId: string): Promise<Config> {
    const row = await this.db.integrationConfig.findUnique({
      where: { workspaceId },
    });
    // Environment credentials are operator-level defaults, never exposed in the panel.
    // Workspace credentials must be explicitly configured: no shared gateway key across tenants.
    const saved = row ? this.decrypt(workspaceId, row.encrypted) : null;
    const result = {
      ...this.defaults,
      ...(saved || {
        openwaEnabled: false,
        openwaKey: "",
        webhookSecret: "",
        openaiKey: "",
        aiProvider: "rules",
      }),
    };
    if (this.defaults.forceSimulation) {
      result.openwaEnabled = !!this.defaults.openwaSetupMode && !!result.openwaEnabled;
      result.aiProvider = "rules";
    }
    return result;
  }
  async view(workspaceId: string) {
    const c = await this.resolve(workspaceId);
    const latest = await this.db.webhookInbox.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        createdAt: true,
        processedAt: true,
        lastError: true,
      },
    });
    return {
      openwaEnabled: c.openwaEnabled,
      openwaUrl: c.openwaUrl,
      openaiModel: c.openaiModel,
      aiProvider: c.aiProvider,
      publicUrl: c.publicUrl,
      hasOpenwaKey: !!c.openwaKey,
      hasOpenaiKey: !!c.openaiKey,
      hasWebhookSecret: !!c.webhookSecret,
      automaticOwnMessages: c.automaticOwnMessages || [],
      managed: !!(c as Config & { managed?: boolean }).managed,
      managedProvisionAvailable:
        !!this.defaults.managedOpenwaAdminKey &&
        (!this.defaults.forceSimulation || !!this.defaults.openwaSetupMode),
      forceSimulation: !!c.forceSimulation,
      openwaSetupMode: !!this.defaults.openwaSetupMode,
      webhookUrl: `${(c.openwaWebhookBaseUrl || c.publicUrl).replace(/\/$/, "")}/api/webhooks/openwa/${workspaceId}`,
      latestWebhook: latest,
    };
  }
  async save(workspaceId: string, input: unknown) {
    const data = integrationSchema.parse(input),
      old = await this.resolve(workspaceId);
    const allowed = this.defaults.openwaAllowedOrigins || [
      this.defaults.openwaUrl,
    ];
    if (
      !allowed.some((v) => new URL(v).origin === new URL(data.openwaUrl).origin)
    )
      throw new HttpError(
        400,
        "Gateway no autorizado por el servidor. Agregá su origen a OPENWA_ALLOWED_ORIGINS en .env y reiniciá.",
      );
    const saved: Saved = {
      openwaEnabled: data.openwaEnabled,
      openwaUrl: data.openwaUrl.replace(/\/$/, ""),
      aiProvider: data.aiProvider,
      openaiModel: data.openaiModel,
      publicUrl: data.publicUrl.replace(/\/$/, ""),
      automaticOwnMessages:
        data.automaticOwnMessages ?? old.automaticOwnMessages ?? [],
      openwaKey: data.clearOpenwaKey ? "" : data.openwaKey || old.openwaKey,
      openaiKey: data.clearOpenaiKey ? "" : data.openaiKey || old.openaiKey,
      webhookSecret:
        data.webhookSecret ||
        old.webhookSecret ||
        randomBytes(32).toString("hex"),
      managed:
        !!(old as Config & { managed?: boolean }).managed &&
        !data.openwaKey &&
        !data.clearOpenwaKey,
    };
    if (saved.openwaEnabled && !saved.openwaKey)
      throw new HttpError(400, "Falta la API key de OpenWA.");
    if (saved.aiProvider === "openai" && !saved.openaiKey)
      throw new HttpError(400, "Falta la API key de OpenAI.");
    const encrypted = this.encrypt(workspaceId, saved);
    await this.db.integrationConfig.upsert({
      where: { workspaceId },
      create: { workspaceId, encrypted },
      update: { encrypted },
    });
    return this.view(workspaceId);
  }
  async saveManaged(workspaceId: string, key: string) {
    const old = await this.resolve(workspaceId);
    const saved: Saved = {
      openwaEnabled: true,
      openwaUrl: this.defaults.openwaUrl,
      openwaKey: key,
      webhookSecret: old.webhookSecret || randomBytes(32).toString("hex"),
      aiProvider: old.aiProvider,
      openaiKey: old.openaiKey,
      openaiModel: old.openaiModel,
      publicUrl: old.publicUrl,
      automaticOwnMessages: old.automaticOwnMessages || [],
      managed: true,
    };
    await this.db.integrationConfig.upsert({
      where: { workspaceId },
      create: { workspaceId, encrypted: this.encrypt(workspaceId, saved) },
      update: { encrypted: this.encrypt(workspaceId, saved) },
    });
  }
}
