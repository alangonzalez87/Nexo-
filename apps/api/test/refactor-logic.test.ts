import { test } from "node:test";
import assert from "node:assert/strict";
import type { Connection, PrismaClient } from "@nexo/database";
import { normalize, findExactRule } from "../src/seller/text.js";
import {
  packChoice,
  resolveCampaignMatch,
  resolveRequestedPacks,
} from "../src/sales/selection.js";
import { formatPackChoices } from "../src/sales/messages.js";
import { messageSchema } from "../src/webhooks/schemas.js";
import {
  readReceiptMedia,
  notifyPendingReceipt,
} from "../src/webhooks/receipts.js";

test("campaign routing prefers a whole, longer phrase and ignores unavailable products", () => {
  const products = [{ id: "basic" }, { id: "advanced" }];
  const campaigns = [
    { code: "curso", adId: null, productId: "basic" },
    { code: "curso avanzado", adId: null, productId: "advanced" },
  ];
  assert.equal(
    resolveCampaignMatch(
      normalize("¡Curso avanzado!"),
      undefined,
      campaigns,
      products,
    ),
    products[1],
  );
  assert.equal(
    resolveCampaignMatch("concurso", undefined, campaigns, products),
    undefined,
  );
  assert.equal(
    resolveCampaignMatch(
      "curso avanzado",
      undefined,
      campaigns,
      products.slice(0, 1),
    ),
    undefined,
  );
});

test("campaign ambiguity remains unresolved, including conflicting ad referrals", () => {
  const products = [{ id: "a" }, { id: "b" }];
  const campaigns = [
    { code: "diseño", adId: null, productId: "a" },
    { code: "otro", adId: "ad-b", productId: "b" },
  ];
  assert.equal(
    resolveCampaignMatch("diseno", { adId: "ad-b" }, campaigns, products),
    undefined,
  );
  assert.equal(
    resolveCampaignMatch("hola", { adId: "ad-b" }, campaigns, products),
    products[1],
  );
  assert.equal(
    resolveCampaignMatch(
      "diseno",
      undefined,
      [...campaigns, { code: "diseño", adId: null, productId: "b" }],
      products,
    ),
    undefined,
  );
  assert.equal(
    resolveCampaignMatch(
      "diseno",
      undefined,
      [...campaigns, campaigns[0]],
      products,
    ),
    products[0],
  );
});

test("explicit pack choices accept ordinals and combinations without treating questions as purchases", () => {
  assert.deepEqual(
    packChoice(normalize("Quiero el pack 2 y pack 1 por favor")),
    [2, 1],
  );
  assert.deepEqual(packChoice("el primero"), [1]);
  assert.deepEqual(packChoice("pack 2 y pack 2"), [2]);
  assert.equal(packChoice("cuanto cuesta el pack 2"), null);
  assert.equal(packChoice("no quiero el pack 2"), null);
  assert.equal(packChoice("pack 10"), null);
});

test("combined packs require explicit inclusion and preserve the selected price", () => {
  const lower = {
    number: 1,
    name: "Inicial",
    summary: "Inicio",
    priceCents: 10050,
  };
  const higher = {
    number: 2,
    name: "Completo",
    summary: "Incluye Pack 1",
    priceCents: 25050,
  };
  const packs = [lower, higher];
  assert.equal(resolveRequestedPacks(packs, [1, 2]).selected, higher);
  assert.equal(resolveRequestedPacks(packs, [2]).selected?.priceCents, 25050);
  assert.equal(
    resolveRequestedPacks(
      [lower, { ...higher, summary: "Otro contenido" }],
      [1, 2],
    ).selected,
    undefined,
  );
  assert.equal(
    resolveRequestedPacks(
      [lower, { ...higher, summary: "No incluye el Pack 1" }],
      [1, 2],
    ).selected,
    undefined,
  );
  assert.equal(resolveRequestedPacks(packs, [9]).validPacks, null);
  assert.deepEqual(resolveRequestedPacks(packs, null), {
    validPacks: null,
    selected: undefined,
  });
  assert.deepEqual(packs, [lower, higher]);
});

test("exact rules preserve mandatory priority and input order on ties", () => {
  const rules = [
    { question: "¿Qué incluye?", mandatory: false, answer: "general" },
    { question: "que incluye", mandatory: true, answer: "obligatoria" },
    { question: "Qué incluye!", mandatory: true, answer: "segunda" },
  ];
  const before = [...rules];
  assert.equal(findExactRule(rules, normalize("QUÉ INCLUYE?")), rules[1]);
  assert.equal(findExactRule(rules.slice(0, 1), "que incluye"), rules[0]);
  assert.equal(findExactRule(rules, "otra pregunta"), undefined);
  assert.deepEqual(rules, before);
});

test("pack lists preserve labels and monetary cents", () => {
  const packs = [{ number: 1, name: "Inicial", priceCents: 10050 }];
  assert.equal(formatPackChoices(packs, "ARS"), "1 (Inicial)");
  assert.match(
    formatPackChoices(packs, "ARS", true),
    /^1 \(Inicial, .*100,50\)$/,
  );
  assert.equal(formatPackChoices([], "ARS", true), "");
});

const connection = { id: "test-connection" } as Connection;
const message = (extra: Record<string, unknown> = {}) =>
  messageSchema.parse({
    id: "test-message",
    chatId: "123456789@c.us",
    type: "image",
    fromMe: false,
    isGroup: false,
    ...extra,
  });

test("receipt media uses inline bytes or the supplied downloader and keeps the filename", async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let downloads = 0;
  const adapter = {
    downloadMedia: async () => {
      downloads++;
      return bytes;
    },
  };
  const inline = await readReceiptMedia(
    message({
      media: {
        mimetype: "image/png",
        data: bytes.toString("base64"),
        filename: "pago.png",
      },
    }),
    adapter,
    connection,
  );
  assert.equal(inline.mediaUnavailable, false);
  assert.equal(inline.media?.name, "pago.png");
  assert.deepEqual(inline.media?.data, bytes);
  assert.equal(downloads, 0);
  const fetched = await readReceiptMedia(message(), adapter, connection);
  assert.equal(fetched.media?.name, "comprobante-test-message");
  assert.equal(downloads, 1);
  const text = await readReceiptMedia(
    message({ type: "text" }),
    adapter,
    connection,
  );
  assert.deepEqual(text, { media: undefined, mediaUnavailable: false });
  assert.equal(downloads, 1);
});

test("invalid, oversized or unavailable receipts stay unavailable", async () => {
  let downloads = 0;
  const adapter = {
    downloadMedia: async () => {
      downloads++;
      throw new Error("offline");
    },
  };
  const large = await readReceiptMedia(
    message({
      media: { mimetype: "image/png", sizeBytes: 8 * 1024 * 1024 + 1 },
    }),
    adapter,
    connection,
  );
  assert.deepEqual(large, { media: undefined, mediaUnavailable: true });
  assert.equal(downloads, 0);
  const invalid = await readReceiptMedia(
    message({
      media: {
        mimetype: "image/png",
        data: Buffer.from("invalid").toString("base64"),
      },
    }),
    adapter,
    connection,
  );
  assert.deepEqual(invalid, { media: undefined, mediaUnavailable: true });
  const missing = await readReceiptMedia(message(), adapter, connection);
  assert.deepEqual(missing, { media: undefined, mediaUnavailable: true });
  assert.equal(downloads, 1);
  const oversizedBytes = Buffer.alloc(8 * 1024 * 1024 + 1);
  oversizedBytes.write("%PDF-");
  const oversized = await readReceiptMedia(
    message(),
    { downloadMedia: async () => oversizedBytes },
    connection,
  );
  assert.deepEqual(oversized, { media: undefined, mediaUnavailable: true });
});

test("pending receipt notices keep workspace scope, recipient, amount and idempotency key", async () => {
  const queries: unknown[] = [];
  const sent: unknown[][] = [];
  const db = {
    payment: {
      findFirst: async (query: unknown) => {
        queries.push(query);
        return {
          id: "payment-1",
          assetId: "asset-1",
          amountCents: 10050,
          currency: "ARS",
          packName: "Inicial",
          packNumber: 1,
          conversation: {
            contactName: "Cliente",
            contact: "customer@c.us",
            product: { name: "Curso", notifyApprovalByWhatsApp: true },
          },
        };
      },
    },
    asset: {
      findUnique: async (query: unknown) => {
        queries.push(query);
        return null;
      },
    },
  } as unknown as PrismaClient;
  const adapter = {
    sendText: async (...args: unknown[]) => {
      sent.push(args);
      return "sent";
    },
    sendDocument: async () => {
      throw new Error("No attachment expected");
    },
  };
  await notifyPendingReceipt(
    db,
    adapter,
    connection,
    "workspace-1",
    "conversation-1",
    "123456789",
  );
  assert.deepEqual((queries[0] as { where: unknown }).where, {
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    status: "PENDING",
  });
  assert.deepEqual((queries[1] as { where: unknown }).where, {
    workspaceId_id: { workspaceId: "workspace-1", id: "asset-1" },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], "123456789@c.us");
  assert.match(String(sent[0][2]), /100,50/);
  assert.match(
    String(sent[0][2]),
    /APROBAR payment-1\.asset-1.*ENTREGADO payment-1\.asset-1.*RECHAZAR payment-1\.asset-1/,
  );
  assert.equal(sent[0][3], "approval-notice:payment-1:asset-1");
});
