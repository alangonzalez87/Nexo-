import { resolve } from "node:path";
export interface Config {
  jwtSecret: string;
  storageDir: string;
  publicUrl: string;
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
  openwaAllowedOrigins?: string[];
  platformAdminEmail?: string;
  managedOpenwaAdminKey?: string;
  automaticOwnMessages?: string[];
}
export function configFromEnv(): Config {
  const jwtSecret = process.env.JWT_SECRET || "";
  if (jwtSecret.length < 32)
    throw new Error(
      "JWT_SECRET debe tener al menos 32 caracteres. Copiá .env.example y configurá los secretos.",
    );
  return {
    jwtSecret,
    platformAdminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase(),
    managedOpenwaAdminKey: process.env.OPENWA_MANAGED_ADMIN_KEY,
    storageDir: resolve(process.env.STORAGE_DIR || "../../.data/private"),
    publicUrl: process.env.PUBLIC_URL || "http://localhost:3001",
    webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
    aiProvider: process.env.AI_PROVIDER || "rules",
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    openwaEnabled: process.env.OPENWA_ENABLED === "true",
    openwaUrl: process.env.OPENWA_BASE_URL || "http://localhost:2785",
    openwaKey: process.env.OPENWA_API_KEY || "",
    webhookSecret: process.env.OPENWA_WEBHOOK_SECRET || "",
    credentialsKey: process.env.CREDENTIALS_KEY,
    forceSimulation: process.env.FORCE_SIMULATION === "true",
    openwaAllowedOrigins: process.env.OPENWA_ALLOWED_ORIGINS?.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}
