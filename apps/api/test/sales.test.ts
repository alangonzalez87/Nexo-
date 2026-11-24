import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { IntegrationSettings } from "../src/integrations.js";
import { seed } from "../../../packages/database/src/seed.js";
import { startLocalDb } from "../../../scripts/local-db.js";
import { answer } from "../src/seller.js";
import { verifyWebhook } from "../src/security.js";
import { pdfFixture } from "./pdf-fixture.js";
import { imageFixture } from "./image-fixture.js";
let local: Awaited<ReturnType<typeof startLocalDb>>,
  db: PrismaClient,
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  sales: Awaited<ReturnType<typeof buildApp>>["sales"];
let headers: Record<string, string>,
  workspaceId: string,
  connectionId: string,
  productId: string,
  userId: string,
  storageDir: string;
before(
  async () => {
    storageDir = await mkdtemp(join(tmpdir(), "nexo-tests-"));
    process.env.JWT_SECRET = "test-only-secret-of-at-least-32-characters";
    process.env.STORAGE_DIR = storageDir;
    process.env.OPENWA_WEBHOOK_SECRET = "webhook-test-secret";
    process.env.NEXO_AUTOMATION_CUTOFF_AT = "1970-01-01T00:00:00.000Z";
    // Set TEST_DATABASE_URL to a dedicated PostgreSQL database to exercise real pooling.
    if (!process.env.TEST_DATABASE_URL) local = await startLocalDb(55433);
    db = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL || local.url } },
    });
    const seeded = await seed(
      db,
      `test-${randomUUID()}@nexo.local`,
      "integration-test-password",
    );
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    ({ app, sales } = await buildApp(db, {
      ...configFromEnv(),
      platformAdminEmail: user.email,
    }));
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password: "integration-test-password" },
    });
    assert.equal(login.statusCode, 200);
    headers = {
      authorization: `Bearer ${login.json().token}`,
      "x-workspace-id": workspaceId,
    };
    connectionId = (
      await db.connection.findFirstOrThrow({ where: { workspaceId } })
    ).id;
    productId = (await db.product.findFirstOrThrow({ where: { workspaceId } }))
      .id;
  },
  { timeout: 60000 },
);
after(async () => {
  await app?.close();
  await db?.$disconnect();
  await local?.close();
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});
async function request(
  method: string,
  url: string,
  payload?: any,
  custom = headers,
) {
  return app.inject({ method: method as "GET", url, headers: custom, payload });
}
async function incoming(
  contact: string,
  text: string,
  assetId?: string,
  eventId = randomUUID(),
) {
  const r = await request("POST", "/api/simulator/messages", {
    connectionId,
    contact,
    text,
    assetId,
    eventId,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function chat(id: string) {
  const r = await request("GET", `/api/conversations/${id}`);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function upload(
  url: string,
  data = pdfFixture(`Unique fixture ${randomUUID()}`),
  name = "receipt.pdf",
) {
  const boundary = "nexo-test-boundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request("POST", url, payload, {
    ...headers,
    "content-type": `multipart/form-data; boundary=${boundary}`,
  });
}
test("only the platform administrator can create isolated accounts", async () => {
  const email = `customer-${randomUUID()}@example.com`;
  const created = await request("POST", "/api/admin/accounts", {
    name: "Negocio de prueba",
    email,
    password: "una-clave-segura-123",
  });
  assert.equal(created.statusCode, 200, created.body);
  const customerWorkspace = created.json().workspace.id;
  assert.equal(created.json().password, undefined);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "una-clave-segura-123" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const customer = {
    authorization: `Bearer ${login.json().token}`,
    "x-workspace-id": customerWorkspace,
  };
  assert.equal(
    (
      await request(
        "POST",
        "/api/workspaces",
        { name: "No permitido" },
        customer,
      )
    ).statusCode,
    403,
  );
  const memberships = await request(
    "GET",
    "/api/workspaces",
    undefined,
    customer,
  );
  assert.deepEqual(
    memberships.json().map((m: any) => m.workspaceId),
    [customerWorkspace],
  );
  assert.equal(
    (await request("GET", "/api/products", undefined, customer)).json().length,
    0,
  );
  assert.equal(
    (
      await request("GET", "/api/products", undefined, {
        ...customer,
        "x-workspace-id": workspaceId,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("GET", "/api/admin/accounts", undefined, customer))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/admin/accounts",
        {
          name: "Otro negocio",
          email: `other-${randomUUID()}@example.com`,
          password: "una-clave-segura-123",
        },
        customer,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("GET", "/api/products", undefined, {
        ...headers,
        "x-workspace-id": customerWorkspace,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request("POST", "/api/admin/accounts", {
        name: "Duplicado",
        email,
        password: "una-clave-segura-123",
      })
    ).statusCode,
    409,
  );
});
test("login throttles one account without blocking others behind the same proxy", async () => {
  const email = `limited-${randomUUID()}@example.com`;
  for (let i = 0; i < 10; i++) {
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-for": `192.0.2.${i + 1}` },
      payload: {
        email: i % 2 ? email.toUpperCase() : ` ${email} `,
        password: "wrong",
      },
    });
    assert.equal(result.statusCode, 401);
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong" },
      })
    ).statusCode,
    429,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: `other-${randomUUID()}@example.com`,
          password: "wrong",
        },
      })
    ).statusCode,
    401,
  );
});
test("tenant isolation, auth and product ownership", async () => {
  assert.equal(
    (await request("GET", "/api/products", undefined, {})).statusCode,
    401,
  );
  const other = await db.workspace.create({
    data: { name: "Private workspace" },
  });
  const foreign = { ...headers, "x-workspace-id": other.id };
  assert.equal(
    (await request("GET", "/api/products", undefined, foreign)).statusCode,
    403,
  );
  const otherProduct = await db.product.create({
    data: { workspaceId: other.id, name: "Hidden product", priceCents: 1 },
  });
  const attempt = await request("PUT", `/api/products/${otherProduct.id}`, {
    name: "Stolen",
    priceCents: 5,
  });
  assert.notEqual(attempt.statusCode, 200);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: otherProduct.id } }))
      .name,
    "Hidden product",
  );
  assert.equal(
    (
      await request("POST", "/api/campaigns", {
        name: "Invalid",
        code: "SECRET",
        productId: otherProduct.id,
      })
    ).statusCode,
    400,
  );
});
test("campaign messages are sent in order once, while purchase and questions keep priority", async () => {
  const created = await request("POST", "/api/products", {
    name: "Curso campaña",
    priceCents: 1000,
    activationKeyword: "TORTAS",
    firstMessage: "¡Hola! ¿Querés conocer el curso?",
    followUpMessages: ["Primera propuesta", "Segunda propuesta"],
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  await request("PUT", `/api/products/${id}/rules`, [
    { question: "¿Cuánto dura?", answer: "Dura dos horas.", mandatory: true },
  ]);
  const incomingFirst = await incoming(`campaign-${randomUUID()}`, "TORTAS");
  const conversation = await chat(incomingFirst.conversationId);
  const contact = conversation.contact;
  assert.deepEqual(
    conversation.messages
      .filter((message: any) => message.direction === "OUT")
      .map((message: any) => message.text),
    [
      "¡Hola! ¿Querés conocer el curso?",
      "Primera propuesta",
      "Segunda propuesta",
    ],
  );
  await incoming(contact, "TORTAS");
  assert.equal(
    (await chat(conversation.id)).messages.filter(
      (message: any) => message.text === "Primera propuesta",
    ).length,
    1,
  );
  await incoming(contact, "¿Cuánto dura?");
  assert.equal(
    (await chat(conversation.id)).messages.at(-1).text,
    "Dura dos horas.",
  );
  await incoming(contact, "quiero comprar");
  assert.match((await chat(conversation.id)).messages.at(-1).text, /Alias:/);
});
test("a full Meta phrase activates only its product and preserves the complete phrase", async () => {
  const phrase = "Quiero más información de limpiapipas";
  const created = await request("POST", "/api/products", {
    name: "Curso limpiapipas",
    priceCents: 2400,
    activationKeyword: phrase,
    notifyApprovalByWhatsApp: false,
    firstMessage: "Te cuento sobre el curso de limpiapipas.",
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    created.json().activationKeyword,
    phrase
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
  );
  assert.equal(created.json().notifyApprovalByWhatsApp, false);
  const listed = (await request("GET", "/api/products")).json();
  assert.equal(
    listed.find((product: any) => product.id === created.json().id)
      .activationKeyword,
    created.json().activationKeyword,
  );
  const partial = await incoming(`partial-${randomUUID()}`, "limpiapipas");
  assert.equal(
    (await chat(partial.conversationId)).productId,
    created.json().id,
  );
  const overlapping = await request("POST", "/api/products", {
    name: "Producto con palabra corta",
    priceCents: 100,
    activationKeyword: "limpiapipas",
  });
  assert.equal(overlapping.statusCode, 200, overlapping.body);
  const matched = await incoming(
    `phrase-${randomUUID()}`,
    "Hola, QUIERO MAS INFORMACION DE LIMPIAPIPAS, por favor",
  );
  const conversation = await chat(matched.conversationId);
  assert.equal(conversation.productId, created.json().id);
  assert.equal(
    conversation.messages.at(-1).text,
    "Te cuento sobre el curso de limpiapipas.",
  );
});
test("a keyword activates its product; unrelated and ambiguous messages stay silent", async () => {
  const r = await incoming("unknown", "hola");
  let c = await chat(r.conversationId);
  assert.equal(c.productId, null);
  assert.equal(c.messages.length, 1);
  const productName = await incoming(
    "product-name-only",
    "Curso de IA para emprendedores",
  );
  c = await chat(productName.conversationId);
  assert.equal(c.productId, productId);
  assert.ok(c.messages.some((m: any) => m.direction === "OUT"));
  const humanBeforeKeyword = await incoming("human-before-keyword", "humano");
  c = await chat(humanBeforeKeyword.conversationId);
  assert.equal(c.productId, null);
  assert.equal(c.messages.length, 1);
  const selected = await incoming("unknown", "Quiero saber sobre CURSOIA");
  assert.equal((await chat(selected.conversationId)).productId, productId);
  const second = await db.product.create({
    data: { workspaceId, name: "Segundo producto", priceCents: 100 },
  });
  await db.campaign.create({
    data: {
      workspaceId,
      productId: second.id,
      name: "Otra campaña",
      code: "SECOND",
    },
  });
  const ambiguous = await incoming("ambiguous", "CURSOIA SECOND");
  c = await chat(ambiguous.conversationId);
  assert.equal(c.productId, null);
  assert.equal(c.messages.length, 1);
  const switched = await incoming("unknown", "Ahora me interesa SECOND");
  c = await chat(switched.conversationId);
  assert.equal(c.productId, second.id);
  assert.match(c.messages.at(-1).text, /Segundo producto/);
  const referral = await request("POST", "/api/simulator/messages", {
    connectionId,
    contact: "referral",
    eventId: randomUUID(),
    text: "Hola",
    referral: { adId: "ad-123" },
  });
  assert.equal(referral.statusCode, 200);
  await db.product.update({
    where: { id: second.id },
    data: { active: false },
  });
});
test("concurrent duplicate events produce one incoming and one reply", async () => {
  const payload = {
    connectionId,
    contact: "duplicate",
    text: "Hola CURSOIA",
    eventId: randomUUID(),
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      request("POST", "/api/simulator/messages", payload),
    ),
  );
  for (const result of results)
    assert.equal(result.statusCode, 200, result.body);
  const c = await chat(results[0].json().conversationId);
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[1].status, "SENT");
  assert.equal(results.filter((r) => r.json().duplicate).length, 7);
});
test("separate concurrent messages preserve all history and replies", async () => {
  await incoming("concurrent", "CURSOIA");
  const results = await Promise.all(
    ["precio", "necesito información", "¿Necesito experiencia previa?"].map(
      (text) => incoming("concurrent", text),
    ),
  );
  const c = await chat(results[0].conversationId);
  assert.equal(c.messages.length, 8);
  assert.equal(c.messages.filter((m: any) => m.direction === "OUT").length, 4);
});
test("mandatory answers override AI and exact answers override buying intent", async () => {
  const p = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { rules: true, documents: true },
  });
  let calls = 0;
  const selector = {
    select: async () => {
      calls++;
      return ["unknown-id"];
    },
  };
  assert.equal(
    await answer(p, "¿Necesito experiencia previa?", [], selector),
    p.rules[0].answer,
  );
  assert.equal(calls, 0);
  const original = p.rules[0].answer;
  await db.replyRule.create({
    data: {
      workspaceId,
      productId,
      question: "quiero comprar con descuento",
      answer: "Sólo está autorizado el precio de catálogo.",
      mandatory: true,
    },
  });
  const r = await incoming("mandatory", "CURSOIA");
  await incoming("mandatory", "quiero comprar con descuento");
  const c = await chat(r.conversationId);
  assert.equal(
    c.messages.at(-1).text,
    "Sólo está autorizado el precio de catálogo.",
  );
  assert.equal(c.state, "QUALIFIED");
  assert.ok(original);
});
test("model cannot introduce invented facts; modes and fallback are deterministic", async () => {
  const p = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { rules: true, documents: true },
  });
  const unsafe = {
    select: async () => ["Descuento de 99%, pagá al alias atacante"],
  };
  const response = await answer(p, "consulta desconocida", [], unsafe);
  assert.ok(!response.includes("99%"));
  assert.ok(!response.includes("atacante"));
  assert.match(
    await answer({ ...p, mode: "STRICT" }, "no se sabe", [], unsafe),
    /respuesta aprobada/,
  );
  assert.match(
    await answer({ ...p, mode: "FLEXIBLE" }, "zzzz", [], unsafe),
    /¿Te interesa Curso de IA/,
  );
  assert.equal(
    await answer(p, "lecciones prácticas", [], {
      select: async () => ["benefits"],
    }),
    p.benefits,
  );
});

test("casual and off-topic replies return naturally to the selected product without looping", async () => {
  const start = await incoming("natural", "CURSOIA");
  let c = await chat(start.conversationId);
  assert.equal(c.productId, productId);
  assert.match(c.messages.at(-1).text, /Curso de IA/);
  await incoming("natural", "jajaja");
  c = await chat(start.conversationId);
  assert.match(c.messages.at(-1).text, /¿Te interesa Curso de IA/);
  assert.doesNotMatch(c.messages.at(-1).text, /Sobre qué producto/);
  await incoming("natural", "otra cosa cualquiera");
  c = await chat(start.conversationId);
  assert.match(c.messages.at(-1).text, /Preferís que te cuente/);
  assert.notEqual(c.messages.at(-1).text, c.messages.at(-3).text);
  await incoming("natural", "sigo con la misma duda");
  c = await chat(start.conversationId);
  assert.equal(c.humanControlled, true);
  assert.match(c.messages.at(-1).text, /persona del equipo/);
});

test("generic interest after a previous chat does not select an unrelated approved answer", async () => {
  const start = await incoming("interest", "CURSOIA");
  await incoming("interest", "me interesa Curso ia");
  const c = await chat(start.conversationId);
  assert.match(c.messages.at(-1).text, /Curso de IA/);
  assert.doesNotMatch(c.messages.at(-1).text, /experiencia previa/);
});
test("natural purchase phrases leave the conversation loop and show payment details", async () => {
  for (const [index, phrase] of [
    "QUIERO EL CURSO",
    "quiero abonar el curso",
    "cómo comprarlo",
  ].entries()) {
    const start = await incoming(`purchase-phrase-${index}`, "CURSOIA");
    await incoming(`purchase-phrase-${index}`, phrase);
    const c = await chat(start.conversationId);
    assert.equal(c.state, "AWAITING_PAYMENT");
    assert.match(c.messages.at(-1).text, /Alias:/);
    assert.doesNotMatch(c.messages.at(-1).text, /Preferís que te cuente/);
  }
});

test("the agent handles colloquial choices and sample requests in an existing sales conversation", async () => {
  const created = await request("POST", "/api/products", {
    name: "Planificación de prueba",
    activationKeyword: "CALENDARIO FIXTURE",
    priceCents: 350000,
    mode: "FLEXIBLE",
    firstMessage:
      "Tenemos calendarios y agendas. Respondeme QUIERO y te explico cómo llevarlos.",
  });
  assert.equal(created.statusCode, 200, created.body);
  const courseId = created.json().id;
  const packs = await request("PUT", `/api/products/${courseId}/packs`, [
    {
      number: 1,
      name: "Calendarios 2031",
      priceCents: 350000,
      summary: "Calendarios imprimibles",
      deliveryMessage: "Entrega calendarios",
    },
    {
      number: 2,
      name: "Agendas 2031",
      priceCents: 650000,
      summary: "Agendas semanales",
      deliveryMessage: "Entrega agendas",
    },
  ]);
  assert.equal(packs.statusCode, 200, packs.body);
  const start = (suffix: string) =>
    incoming(`sales-intent-${suffix}`, "CALENDARIO FIXTURE");
  const say = (suffix: string, text: string) =>
    incoming(`sales-intent-${suffix}`, text);

  const named = await start("name");
  await say("name", "calendario completo");
  let c = await chat(named.conversationId);
  assert.match(c.messages.at(-1).text, /Pack 1.*3\.500.*Querés llevarlo/);
  assert.equal(c.selectedPackNumber, null);
  await say("name", "SSSSIIII");
  c = await chat(named.conversationId);
  assert.equal(c.selectedPackNumber, 1);
  assert.equal(c.quotedPriceCents, 350000);

  const choice = await start("number");
  await say("number", "quioero");
  c = await chat(choice.conversationId);
  assert.match(c.messages.at(-1).text, /Cuál pack querés llevar/);
  assert.equal(c.quotedPriceCents, null);
  await say("number", "Quiero");
  c = await chat(choice.conversationId);
  assert.match(c.messages.at(-1).text, /número del pack/);
  await say("number", "Si me interesa saber cómo ? ...número 1");
  c = await chat(choice.conversationId);
  assert.equal(c.selectedPackNumber, 1);
  assert.equal(c.quotedPriceCents, 350000);

  const both = await start("both");
  await say("both", "quiero ambos");
  c = await chat(both.conversationId);
  assert.equal(c.humanControlled, true);
  assert.equal(c.quotedPriceCents, null);
  assert.match(
    c.messages.at(-1).text,
    /Calendarios 2031.*3\.500.*Agendas 2031.*6\.500/,
  );
  assert.doesNotMatch(c.messages.at(-1).text, /Alias:/);

  const sample = await start("sample");
  await say("sample", "Tenés videos para ver cómo son?");
  c = await chat(sample.conversationId);
  assert.match(c.messages.at(-1).text, /una muestra/);
  assert.doesNotMatch(c.messages.at(-1).text, /Cuál elegís/);
  await say("sample", "Ok");
  c = await chat(sample.conversationId);
  assert.equal(c.humanControlled, true);
  assert.match(c.messages.at(-1).text, /equipo.*muestra/);
  assert.equal(c.quotedPriceCents, null);

  await db.replyRule.create({
    data: {
      workspaceId,
      productId: courseId,
      question: "¿Hay algún video de muestra?",
      answer: "Mirá la muestra en https://example.test/muestra",
    },
  });
  const approved = await start("approved-sample");
  await say("approved-sample", "Tenés video para ver algo de los modelos?");
  c = await chat(approved.conversationId);
  assert.equal(
    c.messages.at(-1).text,
    "Mirá la muestra en https://example.test/muestra",
  );
  assert.equal(c.humanControlled, false);
});
test("a selected pack keeps its own price and delivery message through manual payment approval", async () => {
  const created = await request("POST", "/api/products", {
    name: "Cursos de limpiapipas",
    priceCents: 0,
    activationKeyword: "Quiero más información de packs limpiapipas",
    firstMessage: "Tenemos tres packs. ¿Cuál querés: 1, 2 o 3?",
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const packs = [
    {
      number: 1,
      name: "Flores",
      priceCents: 490000,
      summary: "Flores",
      deliveryMessage: "Pack 1: https://example.test/flores",
    },
    {
      number: 2,
      name: "Flores y llaveros",
      priceCents: 690000,
      summary: "Flores y llaveros",
      deliveryMessage: "Pack 2: https://example.test/llaveros",
    },
    {
      number: 3,
      name: "Pack completo",
      priceCents: 990000,
      summary: "Flores, llaveros y Navidad",
      deliveryMessage: "Pack 3: https://example.test/navidad",
    },
  ];
  const configured = await request("PUT", `/api/products/${id}/packs`, packs);
  assert.equal(configured.statusCode, 200, configured.body);
  const listed = (await request("GET", "/api/products")).json();
  assert.equal(
    listed.find((product: any) => product.id === id).packs.length,
    3,
  );
  const contact = `pack-${randomUUID()}`;
  const start = await incoming(
    contact,
    "Quiero más información de packs limpiapipas",
  );
  assert.equal(
    (await chat(start.conversationId)).messages.at(-1).text,
    "Tenemos tres packs. ¿Cuál querés: 1, 2 o 3?",
  );
  await incoming(contact, "quiero comprar");
  assert.match(
    (await chat(start.conversationId)).messages.at(-1).text,
    /Cuál pack/,
  );
  await incoming(contact, "2");
  let conversation = await chat(start.conversationId);
  assert.equal(conversation.selectedPackNumber, 2);
  assert.equal(conversation.quotedPriceCents, 690000);
  assert.match(conversation.messages.at(-1).text, /6\.900/);
  const typoStart = await incoming(
    `pack-typo-${randomUUID()}`,
    "Quiero más información de packs limpiapipas",
  );
  const typoContact = (await chat(typoStart.conversationId)).contact;
  await incoming(typoContact, "pal 2");
  assert.equal((await chat(typoStart.conversationId)).selectedPackNumber, 2);
  const combinedStart = await incoming(
    `pack-combined-${randomUUID()}`,
    "Quiero más información de packs limpiapipas",
  );
  const combinedContact = (await chat(combinedStart.conversationId)).contact;
  await incoming(combinedContact, "curso 1y2");
  const combined = await chat(combinedStart.conversationId);
  assert.equal(combined.selectedPackNumber, 2);
  assert.equal(combined.quotedPriceCents, 690000);
  assert.match(combined.messages.at(-1).text, /Alias:/);
  await incoming(contact, "cuánto cuesta");
  assert.match(
    (await chat(start.conversationId)).messages.at(-1).text,
    /6\.900/,
  );
  const receipt = await upload("/api/simulator/receipts");
  assert.equal(receipt.statusCode, 200, receipt.body);
  await incoming(contact, "comprobante", receipt.json().id);
  conversation = await chat(start.conversationId);
  const payment = conversation.payments[0];
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.packNumber, 2);
  assert.equal(payment.packName, "Flores y llaveros");
  assert.equal(payment.amountCents, 690000);
  assert.ok(
    (await request("GET", "/api/payments"))
      .json()
      .some(
        (item: any) =>
          item.id === payment.id && item.packName === "Flores y llaveros",
      ),
  );
  await request(
    "PUT",
    `/api/products/${id}/packs`,
    packs.map((pack) => ({
      ...pack,
      deliveryMessage: `Mensaje editado del pack ${pack.number}`,
    })),
  );
  const approved = await request("POST", `/api/payments/${payment.id}/review`, {
    expectedAssetId: payment.assetId,
    decision: "APPROVED",
    reason: "Pago verificado",
  });
  assert.equal(approved.statusCode, 200, approved.body);
  conversation = await chat(start.conversationId);
  assert.equal(
    conversation.messages.at(-1).text,
    "Pack 2: https://example.test/llaveros",
  );
  assert.equal(
    await db.delivery.count({ where: { paymentId: payment.id } }),
    0,
  );
});
test("human reviewer can assign a product and pack to an unquoted receipt before approval", async () => {
  const created = await request("POST", "/api/products", {
    name: "Curso para pago sin cotización",
    priceCents: 100000,
    firstMessage: "Elegí un pack",
  });
  assert.equal(created.statusCode, 200, created.body);
  const product = created.json();
  await request("PUT", `/api/products/${product.id}/packs`, [
    {
      number: 1,
      name: "Básico",
      priceCents: 100000,
      summary: "Básico",
      deliveryMessage: "Entrega básica",
    },
    {
      number: 2,
      name: "Completo",
      priceCents: 180000,
      summary: "Todo el Pack 1",
      deliveryMessage: "Entrega completa",
    },
  ]);
  const contact = `unquoted-${randomUUID()}`;
  await incoming(contact, product.name);
  const receipt = await upload("/api/simulator/receipts");
  const incomingReceipt = await incoming(
    contact,
    "comprobante",
    receipt.json().id,
  );
  let conversation = await chat(incomingReceipt.conversationId);
  const payment = conversation.payments[0];
  assert.equal(payment.amountCents, null);
  assert.equal(conversation.productId, product.id);
  const approved = await request("POST", `/api/payments/${payment.id}/review`, {
    expectedAssetId: payment.assetId,
    decision: "APPROVED",
    selection: { productId: product.id, packNumber: 2 },
  });
  assert.equal(approved.statusCode, 200, approved.body);
  conversation = await chat(conversation.id);
  assert.equal(conversation.productId, product.id);
  assert.equal(conversation.selectedPackNumber, 2);
  assert.equal(conversation.payments[0].amountCents, 180000);
  assert.equal(conversation.messages.at(-1).text, "Entrega completa");
});

test("PDF ingestion extracts text and private files require tenant authorization", async () => {
  const result = await upload(
    `/api/products/${productId}/files/knowledge`,
    pdfFixture("Knowledge says the course is self paced."),
  );
  assert.equal(result.statusCode, 200, result.body);
  const document = await db.knowledgeDocument.findFirstOrThrow({
    where: { workspaceId, productId },
  });
  assert.match(document.text, /self paced/);
  assert.equal(
    (await request("GET", `/api/assets/${document.assetId}`, undefined, {}))
      .statusCode,
    401,
  );
  const download = await request("GET", `/api/assets/${document.assetId}`);
  assert.equal(download.statusCode, 200);
  assert.match(download.headers["content-type"] as string, /pdf/);
  const fake = await upload(
    "/api/simulator/receipts",
    Buffer.from("not a PDF"),
  );
  assert.equal(fake.statusCode, 400);
});
test("full sale: receipt pauses agent; manual approval issues private expiring delivery once", async () => {
  const file = await upload(`/api/products/${productId}/files/delivery`);
  assert.equal(file.statusCode, 200, file.body);
  const start = await incoming("buyer", "Hola CURSOIA");
  await incoming("buyer", "quiero comprar");
  let c = await chat(start.conversationId);
  assert.equal(c.state, "AWAITING_PAYMENT");
  assert.match(c.messages.at(-1).text, /demo.nexo.ventas/);
  const asset = await upload("/api/simulator/receipts");
  assert.equal(asset.statusCode, 200, asset.body);
  await incoming("buyer", "comprobante", asset.json().id);
  c = await chat(c.id);
  assert.equal(c.paused, true);
  assert.equal(c.state, "REVIEW");
  const outCount = c.messages.filter((m: any) => m.direction === "OUT").length;
  await incoming("buyer", "seguís ahí");
  c = await chat(c.id);
  assert.equal(
    c.messages.filter((m: any) => m.direction === "OUT").length,
    outCount,
  );
  assert.equal(
    (
      await request("POST", `/api/conversations/${c.id}/human`, {
        resume: true,
      })
    ).statusCode,
    409,
  );
  const payment = c.payments[0];
  assert.equal(payment.status, "PENDING");
  assert.equal(
    await db.delivery.count({ where: { workspaceId, paymentId: payment.id } }),
    0,
  );
  const approve = await Promise.all(
    [1, 2, 3].map(() =>
      request("POST", `/api/payments/${payment.id}/review`, {
        expectedAssetId: payment.assetId,
        decision: "APPROVED",
        reason: "Banco verificado",
      }),
    ),
  );
  for (const r of approve) assert.equal(r.statusCode, 200, r.body);
  c = await chat(c.id);
  assert.equal(c.state, "WON");
  assert.equal(
    await db.delivery.count({ where: { workspaceId, paymentId: payment.id } }),
    1,
  );
  const links = c.messages.filter((m: any) =>
    m.text.includes("/api/deliveries/"),
  );
  assert.equal(links.length, 1);
  const token = links[0].text.split("/api/deliveries/")[1];
  const download = await request(
    "GET",
    `/api/deliveries/${token}`,
    undefined,
    {},
  );
  assert.equal(download.statusCode, 200);
  const stored = await db.delivery.findFirstOrThrow({
    where: { paymentId: payment.id },
  });
  assert.notEqual(stored.tokenHash, token);
  await db.delivery.update({
    where: { id: stored.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (await request("GET", `/api/deliveries/${token}`, undefined, {}))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request("POST", `/api/payments/${payment.id}/review`, {
        expectedAssetId: payment.assetId,
        decision: "REJECTED",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .reviewedBy,
    userId,
  );
});
test("rejection asks for new receipt; resubmission can be approved; unquoted payments cannot", async () => {
  const start = await incoming("reject-buyer", "CURSOIA");
  await incoming("reject-buyer", "comprar");
  const receipt = await upload("/api/simulator/receipts");
  await incoming("reject-buyer", "archivo", receipt.json().id);
  let c = await chat(start.conversationId);
  const payment = c.payments[0];
  assert.equal(
    (
      await request("POST", `/api/payments/${payment.id}/review`, {
        expectedAssetId: payment.assetId,
        decision: "REJECTED",
        reason: "Importe incorrecto",
      })
    ).statusCode,
    200,
  );
  c = await chat(c.id);
  assert.equal(c.paused, false);
  assert.match(c.messages.at(-1).text, /nuevo/);
  const second = await upload("/api/simulator/receipts");
  await incoming("reject-buyer", "nuevo", second.json().id);
  c = await chat(c.id);
  const pending = c.payments.find((p: any) => p.status === "PENDING");
  assert.equal(
    (
      await request("POST", `/api/payments/${pending.id}/review`, {
        expectedAssetId: pending.assetId,
        decision: "APPROVED",
      })
    ).statusCode,
    200,
  );
  const unknown = await incoming("no-quote", "CURSOIA");
  const third = await upload("/api/simulator/receipts");
  await incoming("no-quote", "pagué", third.json().id);
  c = await chat(unknown.conversationId);
  assert.equal(
    (
      await request("POST", `/api/payments/${c.payments[0].id}/review`, {
        expectedAssetId: c.payments[0].assetId,
        decision: "APPROVED",
      })
    ).statusCode,
    409,
  );
});
test("human takeover suppresses automated replies until explicit resume", async () => {
  const r = await incoming("human", "CURSOIA");
  await incoming("human", "quiero hablar con un humano");
  let c = await chat(r.conversationId);
  assert.equal(c.paused, true);
  assert.equal(c.state, "HUMAN");
  const count = c.messages.length;
  await incoming("human", "precio");
  c = await chat(c.id);
  assert.equal(c.messages.length, count + 1);
  await request("POST", `/api/conversations/${c.id}/human`, {
    text: "Te atiende el equipo.",
  });
  await request("POST", `/api/conversations/${c.id}/human`, { resume: true });
  assert.equal((await chat(c.id)).paused, false);
});
test("webhook rejects missing/tampered signatures and unconfigured workspace credentials", async () => {
  const raw = JSON.stringify({ event: "message.received" });
  const sig =
    "sha256=" +
    createHmac("sha256", "webhook-test-secret").update(raw).digest("hex");
  assert.equal(verifyWebhook(raw, sig, "webhook-test-secret"), true);
  assert.equal(verifyWebhook(raw + " ", sig, "webhook-test-secret"), false);
  assert.equal(
    (
      await request(
        "POST",
        `/api/webhooks/openwa/${workspaceId}`,
        { event: "message.received" },
        {},
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request("POST", `/api/webhooks/openwa/${workspaceId}`, raw, {
        "content-type": "application/json",
        "x-openwa-signature": sig,
      })
    ).statusCode,
    401,
  );
});
test("outbox is persistent and dispatching repeatedly never duplicates mock sends", async () => {
  const result = await sales.receive(workspaceId, {
    connectionId,
    contact: "outbox",
    text: "CURSOIA",
    eventId: randomUUID(),
  });
  assert.equal(
    await db.message.count({
      where: { conversationId: result.conversationId, status: "PENDING" },
    }),
    1,
  );
  await Promise.all([sales.dispatch(workspaceId), sales.dispatch(workspaceId)]);
  const sent = await db.message.findMany({
    where: { conversationId: result.conversationId, direction: "OUT" },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].providerMessageId, `mock:${sent[0].id}`);
});
test("future payment reminder is queued once, skips expired chats, and cancels after a reply", async () => {
  const product = await db.product.create({
    data: {
      workspaceId,
      name: "Recordatorio de prueba",
      priceCents: 1000,
      remarketingEnabled: true,
      remarketingDelayHours: 2,
      remarketingMessage: "¿Querés que te ayude a completar la compra?",
    },
  });
  async function candidate(label: string, hoursAgo: number) {
    const conversation = await db.conversation.create({
      data: {
        workspaceId,
        connectionId,
        contact: `${label}-${randomUUID()}`,
        productId: product.id,
        state: "AWAITING_PAYMENT",
      },
    });
    const inboundAt = new Date(Date.now() - hoursAgo * 3600000);
    await db.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        externalId: randomUUID(),
        direction: "IN",
        text: "Quiero comprar",
        createdAt: inboundAt,
      },
    });
    await db.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        externalId: `payment-details:${randomUUID()}`,
        direction: "OUT",
        status: "SENT",
        text: "Alias: prueba",
        createdAt: new Date(inboundAt.getTime() + 1000),
      },
    });
    return conversation;
  }
  const expired = await candidate("expired", 24);
  const due = await candidate("due", 7);
  assert.equal(await sales.queueDueRemarketing(workspaceId), true);
  assert.equal(
    await db.message.count({
      where: {
        conversationId: expired.id,
        externalId: { startsWith: "remarketing:" },
      },
    }),
    0,
  );
  const reminder = await db.message.findUniqueOrThrow({
    where: { externalId: `remarketing:${due.id}` },
  });
  assert.equal(reminder.status, "PENDING");
  await db.message.create({
    data: {
      workspaceId,
      conversationId: due.id,
      externalId: randomUUID(),
      direction: "IN",
      text: "Lo veo después",
    },
  });
  for (let i = 0; i < 20; i++) {
    await sales.dispatch(workspaceId);
    if (
      (await db.message.findUniqueOrThrow({ where: { id: reminder.id } }))
        .status === "CANCELLED"
    )
      break;
  }
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: reminder.id } })).status,
    "CANCELLED",
  );
});
test("VIEWER can read but cannot change products or approve payments", async () => {
  await db.membership.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { role: "VIEWER" },
  });
  try {
    assert.equal((await request("GET", "/api/products")).statusCode, 200);
    assert.equal(
      (
        await request("POST", "/api/products", {
          name: "Forbidden",
          priceCents: 1,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request("POST", "/api/payments/nonexistent/review", {
          decision: "APPROVED",
        })
      ).statusCode,
      403,
    );
  } finally {
    await db.membership.update({
      where: { userId_workspaceId: { userId, workspaceId } },
      data: { role: "ADMIN" },
    });
  }
});
test("catalog CRUD preserves history with soft deletion and validates amounts", async () => {
  assert.equal(
    (
      await request("POST", "/api/products", {
        name: "Invalid",
        priceCents: -1,
      })
    ).statusCode,
    400,
  );
  const created = await request("POST", "/api/products", {
    name: "Test catalog item",
    priceCents: 12345,
    activationKeyword: "CATALOGO",
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().activationKeyword, "CATALOGO");
  const id = created.json().id;
  assert.equal(
    (
      await request("PUT", `/api/products/${id}`, {
        name: "Updated catalog item",
        priceCents: 20000,
        mode: "FLEXIBLE",
        activationKeyword: "ACTUALIZADO",
      })
    ).statusCode,
    200,
  );
  const listed = (await request("GET", "/api/products")).json();
  assert.equal(
    listed.find((product: any) => product.id === id).activationKeyword,
    "ACTUALIZADO",
  );
  assert.equal(
    (await request("DELETE", `/api/products/${id}`)).statusCode,
    200,
  );
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id } })).active,
    false,
  );
  assert.ok(
    !(await request("GET", "/api/products"))
      .json()
      .some((p: any) => p.id === id),
  );
});

test("normalized questions and activation phrases cannot create ambiguous rules", async () => {
  const created = await request("POST", "/api/products", {
    name: "Normalización",
    priceCents: 10050,
    activationKeyword: "Café & Arte",
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().activationKeyword, "CAFE ARTE");
  const id = created.json().id;
  const duplicateRules = await request("PUT", `/api/products/${id}/rules`, [
    { question: "¿Qué incluye?", answer: "Uno", mandatory: true },
    { question: "que incluye!", answer: "Dos", mandatory: false },
  ]);
  assert.equal(duplicateRules.statusCode, 400);
  assert.equal(
    (
      await request("PUT", `/api/products/${id}/rules`, [
        { question: "!!!", answer: "Nada", mandatory: false },
      ])
    ).statusCode,
    400,
  );
  const other = (
    await request("POST", "/api/products", {
      name: "Otro producto",
      priceCents: 10050,
    })
  ).json();
  const conflict = await request("POST", "/api/campaigns", {
    name: "Duplicada",
    productId: other.id,
    code: "cafe---arte",
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(
    (
      await request("POST", "/api/campaigns", {
        name: "Vacía",
        productId: other.id,
        code: "!!!",
      })
    ).statusCode,
    400,
  );
  const results = await Promise.all([
    request("POST", "/api/campaigns", {
      name: "Carrera uno",
      productId: id,
      code: "Luz y Color",
    }),
    request("POST", "/api/campaigns", {
      name: "Carrera dos",
      productId: other.id,
      code: "luz-y-color",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
});

test("course attention switch persists without hiding the product and cancels pending automatic replies", async () => {
  const create = await request("POST", "/api/products", {
    name: "Toggle fixture",
    priceCents: 100,
    agentEnabled: false,
    activationKeyword: "TOGGLEFIXTURE",
  });
  assert.equal(create.statusCode, 200, create.body);
  const product = create.json();
  assert.equal(product.agentEnabled, false);
  assert.ok(
    (await request("GET", "/api/products"))
      .json()
      .some((p: any) => p.id === product.id),
  );
  let result = await request("PUT", `/api/products/${product.id}`, {
    ...product,
    agentEnabled: true,
  });
  assert.equal(result.statusCode, 200, result.body);
  const { conversationId } = await sales.receive(workspaceId, {
    connectionId,
    contact: "toggle",
    text: "TOGGLEFIXTURE",
    eventId: randomUUID(),
  });
  assert.ok(
    await db.message.count({ where: { conversationId, status: "PENDING" } }),
  );
  result = await request("PUT", `/api/products/${product.id}`, {
    ...product,
    agentEnabled: false,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(
    await db.message.count({ where: { conversationId, status: "PENDING" } }),
    0,
  );
  const { agentEnabled, ...legacyPayload } = product;
  await request("PUT", `/api/products/${product.id}`, legacyPayload);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
      .agentEnabled,
    false,
  );
});

test("response images upload privately, validate ownership and retain attachments in product settings", async () => {
  const pdf = await upload("/api/images");
  assert.equal(pdf.statusCode, 400);
  const photo = await upload("/api/images", imageFixture(), "example.png");
  assert.equal(photo.statusCode, 200, photo.body);
  const imageId = photo.json().id;
  assert.equal(
    (await request("GET", `/api/assets/${imageId}`, undefined, {})).statusCode,
    401,
  );
  const downloaded = await request("GET", `/api/assets/${imageId}`);
  assert.equal(downloaded.statusCode, 200);
  assert.match(downloaded.headers["content-type"] as string, /image\/png/);
  const product = (
    await request("POST", "/api/products", {
      name: "Image fixture",
      priceCents: 100,
      firstMessage: "Bienvenida",
      firstImageId: imageId,
      followUpMessages: ["Detalles"],
      followUpImageIds: [imageId],
    })
  ).json();
  assert.equal(product.firstImageId, imageId);
  assert.deepEqual(product.followUpImageIds, [imageId]);
  const rule = await request("PUT", `/api/products/${product.id}/rules`, [
    { question: "foto", answer: "", mandatory: true, imageId },
  ]);
  assert.equal(rule.statusCode, 200, rule.body);
  assert.equal(rule.json()[0].imageId, imageId);
  const pack = await request("PUT", `/api/products/${product.id}/packs`, [
    {
      number: 1,
      name: "Pack visual",
      priceCents: 100,
      summary: "Ejemplo",
      deliveryMessage: "Acceso privado",
      imageId,
    },
  ]);
  assert.equal(pack.statusCode, 200, pack.body);
  assert.equal(pack.json()[0].imageId, imageId);
  const receipt = await upload(
    "/api/simulator/receipts",
    imageFixture(),
    "receipt.png",
  );
  assert.equal(
    (
      await request("PUT", `/api/products/${product.id}`, {
        ...product,
        firstImageId: receipt.json().id,
      })
    ).statusCode,
    400,
  );
  const other = await db.workspace.create({
    data: { name: "Foreign image tenant" },
  });
  const asset = await db.asset.findUniqueOrThrow({ where: { id: imageId } });
  const foreign = await db.asset.create({
    data: {
      workspaceId: other.id,
      path: asset.path,
      mime: asset.mime,
      originalName: "foreign.png",
      purpose: "RESPONSE_IMAGE",
      size: asset.size,
    },
  });
  assert.equal(
    (
      await request("PUT", `/api/products/${product.id}/rules`, [
        { question: "foto", answer: "", mandatory: true, imageId: foreign.id },
      ])
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("PUT", `/api/products/${product.id}/packs`, [
        {
          number: 1,
          name: "Pack visual",
          priceCents: 100,
          summary: "",
          deliveryMessage: "Acceso",
          imageId: foreign.id,
        },
      ])
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("PUT", `/api/products/${product.id}`, {
        ...product,
        firstImageId: foreign.id,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("PUT", `/api/products/${product.id}`, {
        ...product,
        firstImageId: null,
        followUpImageIds: [],
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
      .firstImageId,
    null,
  );
});

test("welcome and follow-up images preserve long text and ordering, while human takeover cancels pending photos", async () => {
  const imageId = (
    await upload("/api/images", imageFixture(), "welcome.png")
  ).json().id;
  const long = "Welcome ".repeat(200) + "END";
  const product = (
    await request("POST", "/api/products", {
      name: "Photo order fixture",
      activationKeyword: "PHOTOORDER",
      priceCents: 100,
      firstMessage: long,
      firstImageId: imageId,
      followUpMessages: ["Second message"],
      followUpImageIds: [imageId],
    })
  ).json();
  const eventId = randomUUID();
  const payload = {
    connectionId,
    contact: "photo-order",
    text: "PHOTOORDER",
    eventId,
  };
  const received = await sales.receive(workspaceId, payload);
  await sales.receive(workspaceId, payload);
  const messages = await db.message.findMany({
    where: { conversationId: received.conversationId, direction: "OUT" },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].text, long);
  assert.equal(messages[0].assetId, null);
  assert.equal(messages[1].text, "");
  assert.equal(messages[1].assetId, imageId);
  assert.equal(messages[2].text, "Second message");
  assert.equal(messages[2].assetId, imageId);
  await sales.human(
    workspaceId,
    received.conversationId,
    undefined,
    false,
    imageId,
  );
  assert.equal(
    await db.message.count({
      where: {
        conversationId: received.conversationId,
        origin: "AUTO",
        status: "PENDING",
      },
    }),
    0,
  );
  await sales.dispatch(workspaceId);
  const human = await db.message.findFirstOrThrow({
    where: { conversationId: received.conversationId, origin: "HUMAN" },
  });
  assert.equal(human.assetId, imageId);
  assert.equal(human.status, "SENT");
  assert.equal(
    (
      await db.conversation.findUniqueOrThrow({
        where: { id: received.conversationId },
      })
    ).humanControlled,
    true,
  );
  await sales.receive(workspaceId, {
    ...payload,
    eventId: randomUUID(),
    text: "foto",
  });
  assert.equal(
    await db.message.count({
      where: { conversationId: received.conversationId, direction: "OUT" },
    }),
    4,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/conversations/${received.conversationId}/human`,
        { imageId, resume: true },
      )
    ).statusCode,
    400,
  );
});

test("exact and selected answers send only their configured images; disabled courses stay silent", async () => {
  const imageId = (
    await upload("/api/images", imageFixture(), "answer.png")
  ).json().id;
  const product = (
    await request("POST", "/api/products", {
      name: "Visual answers fixture",
      activationKeyword: "VISUALANSWERS",
      priceCents: 100,
      mode: "FLEXIBLE",
    })
  ).json();
  await request("PUT", `/api/products/${product.id}/rules`, [
    { question: "foto", answer: "", mandatory: true, imageId },
    {
      question: "ejemplos",
      answer: "Ejemplos del curso",
      mandatory: false,
      imageId,
    },
  ]);
  const r = await sales.receive(workspaceId, {
    connectionId,
    contact: "photo-rule",
    eventId: randomUUID(),
    text: "VISUALANSWERS",
  });
  for (const text of ["foto", "quiero saber ejemplos"]) {
    await sales.receive(workspaceId, {
      connectionId,
      contact: "photo-rule",
      eventId: randomUUID(),
      text,
    });
    const last = await db.message.findFirstOrThrow({
      where: { conversationId: r.conversationId, direction: "OUT" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(last.assetId, imageId);
    assert.equal(last.text, text === "foto" ? "" : "Ejemplos del curso");
  }
  await request("PUT", `/api/products/${product.id}`, {
    ...product,
    agentEnabled: false,
  });
  await sales.receive(workspaceId, {
    connectionId,
    contact: "photo-rule",
    eventId: randomUUID(),
    text: "foto",
  });
  await sales.dispatch(workspaceId);
  assert.equal(
    await db.message.count({
      where: {
        conversationId: r.conversationId,
        direction: "OUT",
        status: "SENT",
      },
    }),
    0,
  );
});

test("WhatsApp payments include older pending receipts beyond both recent lists", async () => {
  const currentSessionId = randomUUID();
  const [currentChannel, historicalChannel] = await Promise.all([
    db.connection.create({
      data: {
        workspaceId,
        provider: "OPENWA",
        name: "WhatsApp del negocio",
        sessionId: currentSessionId,
      },
    }),
    db.connection.create({
      data: {
        workspaceId,
        provider: "OPENWA",
        name: "WhatsApp anterior",
        sessionId: randomUUID(),
      },
    }),
  ]);
  await new IntegrationSettings(db, configFromEnv()).saveManaged(
    workspaceId,
    "fixture-gateway-key",
    currentSessionId,
  );
  const oldDate = new Date("2020-01-01T00:00:00Z");
  const oldChat = await db.conversation.create({
    data: {
      workspaceId,
      connectionId: historicalChannel.id,
      contact: "historical-payment",
      contactName: "Cliente anterior",
      updatedAt: oldDate,
    },
  });
  const currentChat = await db.conversation.create({
    data: {
      workspaceId,
      connectionId: currentChannel.id,
      contact: "current-payment",
    },
  });
  const mockChat = await db.conversation.create({
    data: { workspaceId, connectionId, contact: "mock-payment" },
  });
  await db.conversation.createMany({
    data: Array.from({ length: 200 }, (_, index) => ({
      workspaceId,
      connectionId: currentChannel.id,
      contact: `recent-chat-${index}`,
    })),
  });

  const olderReference = randomUUID();
  const recentReference = randomUUID();
  const mockReference = randomUUID();
  await db.payment.createMany({
    data: [
      {
        workspaceId,
        conversationId: oldChat.id,
        assetId: olderReference,
        createdAt: oldDate,
      },
      { workspaceId, conversationId: currentChat.id, assetId: recentReference },
      { workspaceId, conversationId: mockChat.id, assetId: mockReference },
      ...Array.from({ length: 201 }, () => ({
        workspaceId,
        conversationId: currentChat.id,
        assetId: randomUUID(),
        status: "APPROVED",
      })),
    ],
  });

  const chats = (await request("GET", "/api/conversations")).json();
  assert.ok(!chats.some((chat: { id: string }) => chat.id === oldChat.id));
  const response = await request("GET", "/api/payments?provider=OPENWA");
  assert.equal(response.statusCode, 200, response.body);
  const payments = response.json();
  assert.deepEqual(
    payments.slice(0, 2).map((payment: { assetId: string }) => payment.assetId),
    [recentReference, olderReference],
  );
  assert.equal(payments[0].historicalConnection, false);
  assert.equal(payments[1].historicalConnection, true);
  assert.equal(payments[1].connectionName, "WhatsApp anterior");
  assert.equal(payments[1].conversation.contactName, "Cliente anterior");
  assert.equal(payments.length, 202);
  assert.ok(
    payments
      .slice(2)
      .every((payment: { status: string }) => payment.status === "APPROVED"),
  );
  assert.equal((await request("GET", "/api/overview")).json().pending, 2);
});

test("starting a course from the inbox resumes the agent and queues the configured welcome once", async () => {
  const image = await upload("/api/images", imageFixture(), "course-reply.png");
  assert.equal(image.statusCode, 200, image.body);
  const imageId = image.json().id;
  const created = await request("POST", "/api/products", {
    name: "Course reply fixture",
    activationKeyword: "INBOX WELCOME FIXTURE",
    priceCents: 100,
    firstMessage: "Bienvenida del curso",
    firstImageId: imageId,
    followUpMessages: ["Materiales", "El programa del curso"],
    followUpImageIds: ["", imageId],
  });
  assert.equal(created.statusCode, 200, created.body);
  const { id: courseId } = created.json();
  const { conversationId } = await incoming(
    "course-reply-single",
    "Hola, hay alguien?",
  );
  await sales.human(workspaceId, conversationId, undefined, false);
  const previous = await chat(conversationId);
  assert.equal(previous.humanControlled, true);
  const anchor = previous.messages.at(-1).id;
  const requestBody = {
    productId: courseId,
    unansweredOnly: false,
    targets: [{ conversationId, expectedMessageId: anchor }],
  };
  const [first, retry] = await Promise.all([
    request("POST", "/api/conversations/course-replies", requestBody),
    request("POST", "/api/conversations/course-replies", requestBody),
  ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(retry.statusCode, 200, retry.body);
  assert.deepEqual([first.json()[0].status, retry.json()[0].status].sort(), [
    "ALREADY_QUEUED",
    "QUEUED",
  ]);
  const after = await chat(conversationId);
  assert.equal(after.product.id, courseId);
  assert.equal(after.state, "QUALIFIED");
  assert.equal(after.paused, false);
  assert.equal(after.humanControlled, false);
  assert.deepEqual(
    after.messages
      .filter((message: any) => message.direction === "OUT")
      .map((message: any) => [message.text, message.assetId, message.status]),
    [
      ["Bienvenida del curso", imageId, "PENDING"],
      ["Materiales", null, "PENDING"],
      ["El programa del curso", imageId, "PENDING"],
    ],
  );
});

test("batch course replies ignore automatic greetings and recheck that selected chats still await a reply", async () => {
  const greeting = "¡Información de la prueba de recuperación!";
  const settings = new IntegrationSettings(db, configFromEnv());
  const { openwaEnabled, openwaUrl, aiProvider, openaiModel, publicUrl } =
    await settings.view(workspaceId);
  await settings.save(workspaceId, {
    openwaEnabled,
    openwaUrl,
    aiProvider: aiProvider === "openai" ? "openai" : "rules",
    openaiModel,
    publicUrl,
    automaticOwnMessages: [greeting],
  });
  const fixture = async (contact: string) => {
    const { conversationId } = await incoming(
      contact,
      "¿Me pasás más información?",
    );
    const message = (await chat(conversationId)).messages.at(-1);
    return { conversationId, expectedMessageId: message.id };
  };
  const waiting = await fixture("course-reply-batch-waiting");
  const changed = await fixture("course-reply-batch-changed");
  const review = await fixture("course-reply-batch-review");
  const pending = await fixture("course-reply-batch-pending");
  const other = await fixture("course-reply-batch-other-course");
  const otherCourse = await request("POST", "/api/products", {
    name: "Other course replay fixture",
    priceCents: 100,
  });
  assert.equal(otherCourse.statusCode, 200, otherCourse.body);
  await db.conversation.update({
    where: { id: other.conversationId },
    data: { productId: otherCourse.json().id },
  });
  await db.conversation.update({
    where: { id: review.conversationId },
    data: { state: "REVIEW", paused: true },
  });
  const outgoing = (conversationId: string, text: string, status: string) =>
    db.message.create({
      data: {
        workspaceId,
        conversationId,
        direction: "OUT",
        origin: "HUMAN",
        status,
        text,
        externalId: `own:${randomUUID()}`,
      },
    });
  await outgoing(waiting.conversationId, greeting.normalize("NFD"), "SENT");
  await outgoing(pending.conversationId, "Envío en preparación", "PENDING");
  const before = await request("GET", "/api/conversations/unanswered");
  assert.equal(before.statusCode, 200, before.body);
  const candidates = before.json() as {
    id: string;
    messages: { id: string }[];
  }[];
  assert.equal(
    candidates.find(({ id }) => id === waiting.conversationId)?.messages[0].id,
    waiting.expectedMessageId,
  );
  assert.ok(candidates.some(({ id }) => id === changed.conversationId));
  assert.ok(
    !candidates.some(
      ({ id }) => id === review.conversationId || id === pending.conversationId,
    ),
  );
  await outgoing(
    changed.conversationId,
    "Hola, ya te paso los detalles.",
    "SENT",
  );

  const result = await request("POST", "/api/conversations/course-replies", {
    productId,
    unansweredOnly: true,
    targets: [waiting, changed, review, pending, other],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(
    result.json().map(({ status }: { status: string }) => status),
    ["QUEUED", "SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"],
  );
  const after = await request("GET", "/api/conversations/unanswered");
  assert.equal(after.statusCode, 200, after.body);
  assert.ok(
    !after
      .json()
      .some(
        ({ id }: { id: string }) =>
          id === changed.conversationId || id === waiting.conversationId,
      ),
  );
});
