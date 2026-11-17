import { resolve } from "node:path";
export interface Config {
  jwtSecret: string;
  storageDir: string;
  publicUrl: string;
  openwaWebhookBaseUrl?: string;
  webOrigin: string;
  aiProvider: string;
  openaiKey?: string;
  openaiModel: string;
  openwaEnabled: boolean;
  openwaUrl: string;
  openwaKey: string;
  webhookSecret: string;
  credentialsKey?: string;
  forceSimulation?: boolean;
  preview?: boolean;
  openwaSetupMode?: boolean;
  openwaAllowedOrigins?: string[];
  platformAdminEmail?: string;
  managedOpenwaAdminKey?: string;
  automaticOwnMessages?: string[];
  automationCutoffAt?: Date;
  paymentAutomationEnabled?: boolean;
}
export function configFromEnv(): Config {
  const preview = process.env.NEXO_PREVIEW === "true";
  const openwaSetupMode = preview && process.env.NEXO_OPENWA_SETUP_MODE === "true";
  const automationCutoffRaw = process.env.NEXO_AUTOMATION_CUTOFF_AT?.trim();
  const automationCutoffAt = automationCutoffRaw
    ? new Date(automationCutoffRaw)
    : undefined;
  if (automationCutoffRaw && Number.isNaN(automationCutoffAt!.getTime()))
    throw new Error("NEXO_AUTOMATION_CUTOFF_AT debe ser una fecha ISO válida.");
  if (process.env.NEXO_REQUIRE_PREVIEW === "true" && !preview)
    throw new Error("Esta imagen requiere NEXO_PREVIEW=true.");
  const jwtSecret = process.env.JWT_SECRET || "";
  if (jwtSecret.length < 32)
    throw new Error(
      "JWT_SECRET debe tener al menos 32 caracteres. Copiá .env.example y configurá los secretos.",
    );
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:3001";
  const privateDomain = process.env.RAILWAY_PRIVATE_DOMAIN?.trim();
  const openwaWebhookBaseUrl =
    process.env.OPENWA_WEBHOOK_BASE_URL ||
    (privateDomain
      ? `http://${privateDomain}:${Number(process.env.PORT || 3001)}`
      : publicUrl);
  return {
    jwtSecret,
    platformAdminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase(),
    managedOpenwaAdminKey: process.env.OPENWA_MANAGED_ADMIN_KEY,
    automationCutoffAt,
    paymentAutomationEnabled:
      process.env.PAYMENT_AUTOMATION_ENABLED === "true",
    storageDir: resolve(process.env.STORAGE_DIR || "../../.data/private"),
    publicUrl,
    openwaWebhookBaseUrl,
    webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
    aiProvider: process.env.AI_PROVIDER || "rules",
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    openwaEnabled: process.env.OPENWA_ENABLED === "true",
    openwaUrl: process.env.OPENWA_BASE_URL || "http://localhost:2785",
    openwaKey: process.env.OPENWA_API_KEY || "",
    webhookSecret: process.env.OPENWA_WEBHOOK_SECRET || "",
    credentialsKey: process.env.CREDENTIALS_KEY,
    preview,
    openwaSetupMode,
    forceSimulation: preview || process.env.FORCE_SIMULATION === "true",
    openwaAllowedOrigins: process.env.OPENWA_ALLOWED_ORIGINS?.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}
