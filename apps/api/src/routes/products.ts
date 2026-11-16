import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import type { Prisma } from "@nexo/database";
import { createRequire } from "node:module";
import { HttpError } from "../security.js";
import { saveAsset } from "../storage.js";
import { normalize } from "../seller.js";
import {
  activationCode,
  assertActivationAvailable,
} from "../catalog/activation.js";
import { idParam } from "./context.js";
import { assertResponseImages } from "../sales/outgoing.js";

const require = createRequire(import.meta.url);
const parsePdf = require("pdf-parse/lib/pdf-parse.js") as (
  data: Uint8Array,
) => Promise<{ text: string }>;
const productSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    agentEnabled: z.boolean().optional(),
    priceCents: z.number().int().min(0).max(1000000000),
    currency: z.enum(["ARS", "USD", "EUR"]).default("ARS"),
    description: z.string().max(2500).default(""),
    benefits: z.string().max(2000).default(""),
    firstMessage: z.string().trim().max(4000).optional(),
    firstImageId: z.string().min(1).nullable().optional(),
    followUpImageIds: z.array(z.string()).max(20).optional(),
    followUpMessages: z
      .array(z.string().trim().min(1).max(4000))
      .max(20)
      .optional(),
    notifyApprovalByWhatsApp: z.boolean().optional(),
    receiptMode: z.enum(["MANUAL", "AUTO_RECEIPT"]).optional(),
    remarketingEnabled: z.boolean().optional(),
    remarketingDelayHours: z.number().int().min(1).max(22).optional(),
    remarketingMessage: z.string().trim().max(1000).optional(),
    hook: z.string().max(500).default(""),
    cta: z.string().max(500).default(""),
    objections: z.string().max(2000).default(""),
    mode: z.enum(["STRICT", "FLEXIBLE", "AUTO"]).default("STRICT"),
    activationKeyword: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.remarketingEnabled && !value.remarketingMessage?.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remarketingMessage"],
        message: "Escribí el recordatorio antes de activarlo.",
      });
    if (value.followUpMessages?.length && !value.firstMessage?.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstMessage"],
        message:
          "Escribí un primer mensaje para activar los mensajes adicionales.",
      });
    if (
      value.followUpMessages &&
      new Set([value.firstMessage, ...value.followUpMessages]).size !==
        value.followUpMessages.length + 1
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUpMessages"],
        message: "Cada mensaje debe ser diferente.",
      });
  });

export function registerProductRoutes(
  app: FastifyInstance,
  {
    db,
    config,
    sales,
    scope,
  }: Pick<RouteContext, "db" | "config" | "sales" | "scope">,
) {
  app.get("/api/products", async (req) => {
    const products = await db.product.findMany({
      where: { workspaceId: await scope(req), active: true },
      include: {
        rules: true,
        packs: { orderBy: { number: "asc" } },
        documents: { select: { id: true, name: true, createdAt: true } },
        campaigns: {
          where: { adId: null },
          select: { code: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return products.map(({ campaigns, ...product }) => ({
      ...product,
      activationKeyword: campaigns[0]?.code || "",
    }));
  });
  const saveActivationKeyword = async (
    tx: Prisma.TransactionClient,
    workspaceId: string,
    productId: string,
    productName: string,
    rawKeyword: string | undefined,
  ) => {
    if (rawKeyword === undefined) return;
    const code = activationCode(rawKeyword);
    if (rawKeyword.trim() && !code)
      throw new HttpError(
        400,
        "La frase de activación debe contener letras o números.",
      );
    const campaigns = await tx.campaign.findMany({
      where: { workspaceId },
      select: { id: true, productId: true, code: true, adId: true },
    });
    const current = campaigns.find(
      (campaign) => campaign.productId === productId && !campaign.adId,
    );
    if (!code) {
      if (current) await tx.campaign.delete({ where: { id: current.id } });
      return;
    }
    await assertActivationAvailable(tx, workspaceId, code, current?.id);
    if (current) {
      await tx.campaign.update({
        where: { id: current.id },
        data: { code, name: `Activación · ${productName}` },
      });
    } else {
      await tx.campaign.create({
        data: {
          workspaceId,
          productId,
          code,
          name: `Activación · ${productName}`,
        },
      });
    }
  };
  app.post("/api/products", async (req) => {
    const workspaceId = await scope(req, true);
    const { activationKeyword, ...data } = productSchema.parse(req.body);
    return sales.locked(workspaceId, async (tx) => {
      const product = await tx.product.create({
        data: { ...data, workspaceId },
      });
      await assertResponseImages(tx, workspaceId, [
        product.firstImageId,
        ...product.followUpImageIds,
      ]);
      if (
        product.followUpImageIds.some(
          (id, index) => id && !product.followUpMessages[index],
        )
      )
        throw new HttpError(
          400,
          "Cada imagen adicional debe acompañar un mensaje.",
        );
      await saveActivationKeyword(
        tx,
        workspaceId,
        product.id,
        product.name,
        activationKeyword,
      );
      return {
        ...product,
        activationKeyword: activationCode(activationKeyword || ""),
      };
    });
  });
  app.put("/api/products/:id", async (req) => {
    const workspaceId = await scope(req, true);
    const id = idParam(req);
    const { activationKeyword, ...data } = productSchema.parse(req.body);
    return sales.locked(workspaceId, async (tx) => {
      const product = await tx.product.update({
        where: { workspaceId_id: { workspaceId, id } },
        data,
      });
      await assertResponseImages(tx, workspaceId, [
        product.firstImageId,
        ...product.followUpImageIds,
      ]);
      if (
        product.followUpImageIds.some(
          (id, index) => id && !product.followUpMessages[index],
        )
      )
        throw new HttpError(
          400,
          "Cada imagen adicional debe acompañar un mensaje.",
        );
      await saveActivationKeyword(
        tx,
        workspaceId,
        product.id,
        product.name,
        activationKeyword,
      );
      const campaign = await tx.campaign.findFirst({
        where: { workspaceId, productId: id, adId: null },
        select: { code: true },
      });
      if (!product.agentEnabled) {
        await tx.message.updateMany({
          where: {
            workspaceId,
            direction: "OUT",
            status: "PENDING",
            origin: "AUTO",
            conversation: { productId: id },
          },
          data: { status: "CANCELLED" },
        });
      }
      return { ...product, activationKeyword: campaign?.code || "" };
    });
  });
  app.delete("/api/products/:id", async (req) => {
    const workspaceId = await scope(req, true);
    // Soft-delete retains historic sales and payment audit references.
    return db.product.update({
      where: { workspaceId_id: { workspaceId, id: idParam(req) } },
      data: { active: false },
    });
  });
  app.put("/api/products/:id/rules", async (req) => {
    const workspaceId = await scope(req, true),
      productId = idParam(req);
    const rules = z
      .array(
        z
          .object({
            question: z.string().trim().min(2).max(500),
            answer: z.string().trim().max(3000),
            imageId: z.string().min(1).nullable().optional(),
            mandatory: z.boolean(),
          })
          .refine(
            (rule) => !!rule.answer || !!rule.imageId,
            "Agregá texto o una imagen a la respuesta.",
          ),
      )
      .max(100)
      .parse(req.body);
    const normalized = rules.map((r) => normalize(r.question));
    if (normalized.some((question) => !question))
      throw new HttpError(
        400,
        "Las preguntas deben contener letras o números.",
      );
    if (new Set(normalized).size !== normalized.length)
      throw new HttpError(400, "Hay preguntas duplicadas.");
    return sales.locked(workspaceId, async (tx) => {
      await tx.product.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: productId } },
      });
      await assertResponseImages(
        tx,
        workspaceId,
        rules.map((rule) => rule.imageId),
      );
      await tx.replyRule.deleteMany({ where: { workspaceId, productId } });
      await tx.replyRule.createMany({
        data: rules.map((r) => ({ ...r, workspaceId, productId })),
      });
      return tx.replyRule.findMany({ where: { workspaceId, productId } });
    });
  });
  app.put("/api/products/:id/packs", async (req) => {
    const workspaceId = await scope(req, true);
    const productId = idParam(req);
    const packs = z
      .array(
        z.object({
          number: z.number().int().min(1).max(9),
          name: z.string().trim().min(2).max(100),
          priceCents: z.number().int().min(0).max(1000000000),
          summary: z.string().trim().max(1000).default(""),
          imageId: z.string().min(1).nullable().optional(),
          deliveryMessage: z.string().trim().min(1).max(4000),
        }),
      )
      .max(9)
      .parse(req.body);
    if (packs.some((pack, index) => pack.number !== index + 1))
      throw new HttpError(400, "Numerá los packs desde 1, sin saltos.");
    return sales.locked(workspaceId, async (tx) => {
      await tx.product.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: productId } },
      });
      await assertResponseImages(
        tx,
        workspaceId,
        packs.map((pack) => pack.imageId),
      );
      await tx.pack.deleteMany({ where: { workspaceId, productId } });
      if (packs.length)
        await tx.pack.createMany({
          data: packs.map((pack) => ({ ...pack, workspaceId, productId })),
        });
      return tx.pack.findMany({
        where: { workspaceId, productId },
        orderBy: { number: "asc" },
      });
    });
  });
  app.post("/api/products/:id/files/:purpose", async (req) => {
    const workspaceId = await scope(req, true),
      productId = idParam(req);
    const { purpose } = z
      .object({ purpose: z.enum(["knowledge", "delivery"]) })
      .parse(req.params);
    await db.product.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: productId } },
    });
    const file = await req.file();
    if (!file) throw new HttpError(400, "Seleccioná un archivo.");
    const data = await file.toBuffer();
    let text = "";
    if (purpose === "knowledge") {
      if (data.subarray(0, 5).toString() !== "%PDF-")
        throw new HttpError(400, "El conocimiento debe ser un PDF.");
      try {
        text = (await parsePdf(Uint8Array.from(data))).text.trim();
      } catch {
        throw new HttpError(400, "No se pudo extraer texto del PDF.");
      }
      if (!text)
        throw new HttpError(
          400,
          "El PDF no contiene texto. OCR pendiente; usá un PDF con texto seleccionable.",
        );
      if (text.length > 150000)
        throw new HttpError(
          400,
          "El PDF excede el máximo de 150.000 caracteres.",
        );
    }
    const asset = await saveAsset(
      db,
      config.storageDir,
      workspaceId,
      data,
      file.filename,
      purpose === "knowledge" ? "KNOWLEDGE" : "DELIVERY",
    );
    if (purpose === "knowledge")
      return db.knowledgeDocument.create({
        data: {
          workspaceId,
          productId,
          assetId: asset.id,
          name: asset.originalName,
          text,
        },
        select: { id: true, name: true },
      });
    await db.product.update({
      where: { workspaceId_id: { workspaceId, id: productId } },
      data: { deliveryAssetId: asset.id },
    });
    return { id: asset.id, name: asset.originalName };
  });
  app.delete("/api/products/:id/documents/:documentId", async (req) => {
    const workspaceId = await scope(req, true),
      productId = idParam(req);
    const { documentId } = z
      .object({ documentId: z.string() })
      .parse(req.params);
    return db.knowledgeDocument.deleteMany({
      where: { workspaceId, productId, id: documentId },
    });
  });
}
