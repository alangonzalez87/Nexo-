import type { Connection } from "@nexo/database";
import type { Config } from "./config.js";
import { HttpError } from "./security.js";
export function validPhone(value: unknown): string | undefined {
  return typeof value === "string" && /^\+?[1-9]\d{6,14}$/.test(value)
    ? value.replace(/^\+/, "")
    : undefined;
}
export function phoneFromContact(contact: string): string | undefined {
  const match = /^(\d+)@(c\.us|s\.whatsapp\.net)$/.exec(contact);
  return match ? validPhone(match[1]) : undefined;
}
export function contactName(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.trim().slice(0, 200) || undefined
    : undefined;
}
export interface IncomingMessage {
  eventId: string;
  connectionId: string;
  contact: string;
  contactName?: string;
  contactPhone?: string;
  text: string;
  assetId?: string;
  media?: { data: Buffer; name: string };
  mediaUnavailable?: boolean;
  referral?: { adId?: string; sourceUrl?: string; campaignId?: string };
}
export interface MessagingAdapter {
  sendImage(
    connection: Connection,
    contact: string,
    data: Buffer,
    mimetype: string,
    caption: string,
    key: string,
  ): Promise<string>;
  connect(
    connection: Connection,
  ): Promise<{ status: string; qr: string | null }>;
  status(
    connection: Connection,
  ): Promise<{ status: string; qr: string | null; phone?: string }>;
  sendText(
    connection: Connection,
    contact: string,
    text: string,
    idempotencyKey: string,
  ): Promise<string>;
}
export class MockAdapter implements MessagingAdapter {
  async sendImage(
    _connection: Connection,
    _contact: string,
    _data: Buffer,
    _mimetype: string,
    _caption: string,
    key: string,
  ) {
    return `mock:${key}`;
  }
  async connect() {
    return { status: "CONNECTED", qr: null };
  }
  async status(connection: Connection) {
    return { status: connection.status, qr: null };
  }
  async sendText(
    _connection: Connection,
    _contact: string,
    _text: string,
    key: string,
  ) {
    return `mock:${key}`;
  }
}
// API verified against rmyndharis/OpenWA/openapi.json. No OpenWA source is vendored or modified.
export class OpenWAAdapter implements MessagingAdapter {
  constructor(private config: Config) {}
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    timeoutMs = 12000,
  ): Promise<any> {
    if (!this.config.openwaEnabled || !this.config.openwaKey)
      throw new HttpError(409, "OpenWA está deshabilitado o sin credenciales.");
    const response = await fetch(
      `${this.config.openwaUrl.replace(/\/$/, "")}/api${path}`,
      {
        method,
        headers: {
          "X-API-Key": this.config.openwaKey,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      },
    );
    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "OpenWA rechazó la clave o el acceso a esta sesión."
          : response.status >= 500
            ? "OpenWA tuvo un error al iniciar esta sesión. Actualizá el estado de WhatsApp y volvé a intentar."
            : `OpenWA no pudo completar la operación (HTTP ${response.status}). Actualizá el estado de WhatsApp.`;
      throw new HttpError(502, message);
    }
    return response.json();
  }
  // Verified against POST /api/sessions in OpenWA's bundled OpenAPI document.
  async createSession(name: string) {
    const session = await this.request("/sessions", "POST", { name });
    if (
      typeof session.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.id)
    )
      throw new HttpError(502, "OpenWA devolvió una sesión inválida.");
    return {
      sessionId: session.id,
      status: String(session.status || "created").toUpperCase(),
    };
  }

  async connect(connection: Connection) {
    return this.status(connection);
  }
  // POST /api/sessions/{sessionId}/stop preserves the linked phone and its history.
  async stop(connection: Connection) {
    const session = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/stop`,
      "POST",
      undefined,
      undefined,
      45000,
    );
    if (session.id && session.id !== connection.sessionId)
      throw new HttpError(502, "OpenWA devolvió otra sesión.");
    return { status: String(session.status || "DISCONNECTED").toUpperCase() };
  }
  // Verified against OpenWA's ContactController. A LID is never a phone number.
  async contactDetails(connection: Connection, contact: string) {
    const path = `/sessions/${encodeURIComponent(connection.sessionId)}/contacts/${encodeURIComponent(contact)}`;
    const directPhone = phoneFromContact(contact);
    const [details, resolved] = await Promise.allSettled([
      this.request(path, "GET", undefined, undefined, 5000),
      directPhone
        ? Promise.resolve({ phone: directPhone })
        : this.request(`${path}/phone`, "GET", undefined, undefined, 5000),
    ]);
    const value = details.status === "fulfilled" ? details.value : null;
    return {
      contactName: contactName(value?.name) || contactName(value?.pushName),
      contactPhone:
        resolved.status === "fulfilled"
          ? validPhone(resolved.value?.phone)
          : undefined,
    };
  }
  async prepareQr(connection: Connection) {
    const current = await this.status(connection);
    if (
      [
        "CONNECTED",
        "QR_READY",
        "STARTING",
        "INITIALIZING",
        "AUTHENTICATED",
        "AUTHENTICATING",
      ].includes(current.status)
    )
      return current;
    await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/start`,
      "POST",
      undefined,
      undefined,
      45000,
    );
    return this.status(connection);
  }
  async status(connection: Connection) {
    const session = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}`,
    );
    const status =
      session.status === "ready"
        ? "CONNECTED"
        : String(session.status || "DISCONNECTED").toUpperCase();
    if (session.id && session.id !== connection.sessionId)
      throw new HttpError(502, "OpenWA devolvió otra sesión.");
    const phone = validPhone(session.phone);
    if (status !== "QR_READY")
      return { status, qr: null, ...(phone ? { phone } : {}) };
    const qr = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/qr`,
    );
    return {
      status,
      ...(phone ? { phone } : {}),
      qr:
        typeof qr.qrCode === "string" &&
        /^data:image\/png;base64,/.test(qr.qrCode)
          ? qr.qrCode
          : null,
    };
  }
  async registerWebhook(connection: Connection, url: string) {
    if (!this.config.webhookSecret)
      throw new HttpError(
        400,
        "Guardá primero la configuración de integraciones.",
      );
    const path = `/sessions/${encodeURIComponent(connection.sessionId)}/webhooks`;
    const existing = await this.request(path);
    if (!Array.isArray(existing))
      throw new HttpError(502, "Listado de webhooks inválido.");
    const match = existing.find((w: any) => w.url === url);
    const body = {
      url,
      events: this.config.openwaSetupMode
        ? ["session.status", "session.disconnected"]
        : [
            "message.sent",
            "message.received",
            "session.status",
            "session.disconnected",
          ],
      secret: this.config.webhookSecret,
      retryCount: 5,
    };
    const result = match
      ? await this.request(`${path}/${encodeURIComponent(match.id)}`, "PUT", {
          ...body,
          active: true,
        })
      : await this.request(path, "POST", body);
    return { id: result.id, url, updated: !!match };
  }
  async downloadMedia(
    connection: Connection,
    chatId: string,
    messageId: string,
  ) {
    const url = `${this.config.openwaUrl.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(connection.sessionId)}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/media`;
    const response = await fetch(url, {
      headers: { "X-API-Key": this.config.openwaKey },
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok)
      throw new HttpError(502, `OpenWA media HTTP ${response.status}`);
    const chunks: Buffer[] = [];
    let size = 0;
    if (!response.body) throw new HttpError(502, "Media vacía");
    for await (const part of response.body) {
      size += part.length;
      if (size > 8 * 1024 * 1024) throw new HttpError(413, "Media excede 8 MB");
      chunks.push(Buffer.from(part));
    }
    return Buffer.concat(chunks);
  }
  async sendText(
    connection: Connection,
    contact: string,
    text: string,
    key: string,
  ) {
    const result = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/messages/send-text`,
      "POST",
      { chatId: contact, text, linkPreview: false },
      key,
    );
    if (typeof result.messageId !== "string")
      throw new HttpError(502, "Respuesta inválida de OpenWA");
    return result.messageId;
  }
  async sendImage(
    connection: Connection,
    contact: string,
    data: Buffer,
    mimetype: string,
    caption: string,
    key: string,
  ) {
    const result = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/messages/send-image`,
      "POST",
      { chatId: contact, base64: data.toString("base64"), mimetype, caption },
      key,
    );
    if (typeof result.messageId !== "string")
      throw new HttpError(502, "Respuesta inválida de OpenWA");
    return result.messageId;
  }
  async sendDocument(
    connection: Connection,
    contact: string,
    data: Buffer,
    mimetype: string,
    filename: string,
    key: string,
  ) {
    const result = await this.request(
      `/sessions/${encodeURIComponent(connection.sessionId)}/messages/send-document`,
      "POST",
      {
        chatId: contact,
        base64: data.toString("base64"),
        mimetype,
        filename,
      },
      key,
    );
    if (typeof result.messageId !== "string")
      throw new HttpError(502, "Respuesta inválida de OpenWA");
    return result.messageId;
  }
}
export const adapterFor = (
  provider: string,
  config: Config,
): MessagingAdapter =>
  provider === "MOCK" ? new MockAdapter() : new OpenWAAdapter(config);
