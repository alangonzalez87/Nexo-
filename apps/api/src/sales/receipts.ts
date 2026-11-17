import { cancelPendingAutomation } from "./human-control.js";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SalesContext } from "./context.js";
import { HttpError, sha256 } from "../security.js";
import { evaluateReceipt } from "../receipt-verification.js";
import { receiptFingerprint, receiptWasUsed } from "./receipt-identity.js";
export class ReceiptService {
  constructor(private context: SalesContext) {}
  async review(
    workspaceId: string,
    paymentId: string,
    userId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string,
    expectedAssetId: string,
    selection?: { productId: string; packNumber?: number },
    deliveryMode?: "SEND" | "ALREADY_DELIVERED",
  ) {
    const runtime =
      (await this.context.integrations?.resolve(workspaceId)) ||
      this.context.config;
    if (userId === "auto:receipt" && runtime.paymentAutomationEnabled === false)
      throw new HttpError(409, "La automatización de pagos está desactivada.");
    return this.context.locked(workspaceId, async (tx) => {
      let payment = await tx.payment.findFirst({
        where: { workspaceId, id: paymentId },
        include: { conversation: { include: { product: true } } },
      });
      if (!payment) throw new HttpError(404, "Pago no encontrado.");
      if (payment.assetId !== expectedAssetId)
        throw new HttpError(
          409,
          "El comprobante cambió. Abrí el archivo actual y volvé a revisarlo.",
        );
      if (payment.status === decision) {
        if (
          decision === "APPROVED" &&
          deliveryMode &&
          payment.deliveryMode &&
          payment.deliveryMode !== deliveryMode
        )
          throw new HttpError(
            409,
            "El pago ya fue aprobado con otra modalidad de entrega. Revisá su estado.",
          );
        return payment;
      }
      if (payment.status !== "PENDING")
        throw new HttpError(409, "Este pago ya fue revisado.");
      const automatic = userId === "auto:receipt";
      const alreadyDelivered =
        decision === "APPROVED" && deliveryMode === "ALREADY_DELIVERED";
      if (
        automatic &&
        (payment.conversation.humanControlled ||
          alreadyDelivered ||
          !payment.conversation.product?.active ||
          !payment.conversation.product.agentEnabled)
      )
        throw new HttpError(
          409,
          "La conversación requiere aprobación manual: atención humana o curso fuera de Nexo.",
        );
      if (
        decision === "APPROVED" &&
        payment.conversation.humanControlled &&
        !deliveryMode
      )
        throw new HttpError(
          409,
          "Elegí aprobar y enviar o registrar que ya lo entregaste.",
        );
      if (
        userId === "auto:receipt" &&
        (payment.receiptMode !== "AUTO_RECEIPT" ||
          payment.receiptCheckStatus !== "PASSED")
      )
        throw new HttpError(
          409,
          "El comprobante no superó los controles para entrega automática.",
        );
      if (selection && decision === "APPROVED") {
        if (userId === "auto:receipt")
          throw new HttpError(
            409,
            "La cotización manual requiere aprobación humana.",
          );
        if (
          payment.amountCents !== null &&
          (payment.deliveryMessage ||
            payment.conversation.product?.deliveryAssetId)
        )
          throw new HttpError(409, "Este pago ya tiene producto y cotización.");
        const product = await tx.product.findFirst({
          where: { workspaceId, id: selection.productId, active: true },
          include: { packs: true },
        });
        if (!product) throw new HttpError(404, "Producto no disponible.");
        const pack = product.packs.length
          ? product.packs.find((item) => item.number === selection.packNumber)
          : undefined;
        if (product.packs.length && !pack)
          throw new HttpError(400, "Elegí qué pack corresponde a este pago.");
        if (
          !alreadyDelivered &&
          !product.packs.length &&
          !product.deliveryAssetId
        )
          throw new HttpError(
            409,
            "Cargá el archivo de entrega de este producto antes de aprobar.",
          );
        if (!alreadyDelivered && pack && !pack.deliveryMessage.trim())
          throw new HttpError(
            409,
            "El pack elegido no tiene mensaje de entrega.",
          );
        await tx.conversation.update({
          where: { id: payment.conversationId },
          data: {
            productId: product.id,
            selectedPackNumber: pack?.number ?? null,
            selectedPackName: pack?.name ?? null,
            selectedPackDeliveryMessage: pack?.deliveryMessage ?? null,
            quotedPriceCents: pack?.priceCents ?? product.priceCents,
            quotedCurrency: product.currency,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountCents: pack?.priceCents ?? product.priceCents,
            currency: product.currency,
            packNumber: pack?.number ?? null,
            packName: pack?.name ?? null,
            deliveryMessage: pack?.deliveryMessage ?? null,
          },
        });
        payment = await tx.payment.findFirstOrThrow({
          where: { workspaceId, id: paymentId },
          include: { conversation: { include: { product: true } } },
        });
      }
      const conversation = payment.conversation;
      let approvedFingerprint: string | undefined;
      let text = `No pudimos validar el comprobante.${reason ? ` ${reason}` : ""} Enviá uno nuevo para que lo revisemos.`;
      if (decision === "APPROVED") {
        approvedFingerprint = await receiptFingerprint(
          tx,
          workspaceId,
          expectedAssetId,
        );
        if (
          await receiptWasUsed(
            tx,
            workspaceId,
            paymentId,
            approvedFingerprint,
            payment.receiptReference,
          )
        )
          throw new HttpError(
            409,
            "Este comprobante ya fue utilizado en otro pago.",
          );
        if (
          conversation.state !== "REVIEW" ||
          payment.amountCents === null ||
          (!alreadyDelivered &&
            !payment.deliveryMessage &&
            !conversation.product?.deliveryAssetId)
        )
          throw new HttpError(
            409,
            "Falta una cotización o el archivo de entrega del producto. No se puede aprobar.",
          );
        if (alreadyDelivered) {
          text = "";
        } else if (payment.deliveryMessage) {
          text = payment.deliveryMessage;
        } else {
          const asset = await tx.asset.findFirst({
            where: {
              workspaceId,
              id: conversation.product!.deliveryAssetId!,
              purpose: "DELIVERY",
            },
          });
          if (!asset)
            throw new HttpError(409, "Archivo de entrega no disponible.");
          const token = randomBytes(32).toString("base64url");
          await tx.delivery.create({
            data: {
              workspaceId,
              paymentId,
              assetId: asset.id,
              tokenHash: sha256(token),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
          text = `${userId === "auto:receipt" ? "Recibimos tu comprobante y habilitamos el acceso sin revisión bancaria." : "El equipo aprobó tu pago."} Descargá tu producto aquí (enlace válido por 24 horas): ${runtime.publicUrl}/api/deliveries/${token}`;
        }
      }
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: decision,
          reviewedBy: userId,
          reviewedAt: new Date(),
          reason,
          ...(decision === "APPROVED"
            ? { deliveryMode: alreadyDelivered ? "ALREADY_DELIVERED" : "SEND" }
            : {}),
          ...(approvedFingerprint
            ? { receiptFingerprint: approvedFingerprint }
            : {}),
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          state: decision === "APPROVED" ? "WON" : "AWAITING_PAYMENT",
          paused:
            conversation.humanControlled ||
            alreadyDelivered ||
            decision === "APPROVED",
          humanControlled: conversation.humanControlled || alreadyDelivered,
        },
      });
      if (alreadyDelivered)
        await cancelPendingAutomation(tx, workspaceId, conversation.id);
      if (
        !alreadyDelivered &&
        !(decision === "REJECTED" && conversation.humanControlled)
      )
        await this.context.outgoing(
          tx,
          workspaceId,
          conversation.id,
          text,
          `payment:${paymentId}:${decision}`,
          undefined,
          automatic ? "AUTO" : "PAYMENT",
        );
      await tx.integrationEvent.create({
        data: {
          workspaceId,
          type:
            decision === "APPROVED"
              ? "sale.approved.v1"
              : "payment.rejected.v1",
          payload: {
            paymentId,
            conversationId: conversation.id,
            reviewedBy: userId,
            amountCents: payment.amountCents,
            packNumber: payment.packNumber,
            deliveryMode: updated.deliveryMode,
          },
        },
      });
      return updated;
    });
  }
  private async completeAutomaticReview(
    workspaceId: string,
    paymentId: string,
    expectedAssetId: string,
  ) {
    try {
      await this.review(
        workspaceId,
        paymentId,
        "auto:receipt",
        "APPROVED",
        "Aprobación automática por comprobante; acreditación no verificada.",
        expectedAssetId,
      );
    } catch {
      await this.context.db.payment.updateMany({
        where: {
          workspaceId,
          id: paymentId,
          assetId: expectedAssetId,
          status: "PENDING",
          receiptCheckStatus: "PASSED",
        },
        data: {
          receiptCheckStatus: "NEEDS_REVIEW",
          receiptCheckSummary:
            "No se pudo completar la entrega automática. Requiere revisión manual.",
        },
      });
    }
  }
  async verifyReceipt(workspaceId: string, paymentId: string) {
    if (this.context.config.paymentAutomationEnabled === false) return;
    const payment = await this.context.db.payment.findFirst({
      where: {
        workspaceId,
        id: paymentId,
        status: "PENDING",
        receiptMode: "AUTO_RECEIPT",
      },
      include: { conversation: { include: { product: true } } },
    });
    if (
      !payment ||
      payment.conversation.humanControlled ||
      !payment.conversation.product?.active ||
      !payment.conversation.product.agentEnabled
    )
      return;
    if (payment.receiptCheckStatus === "PASSED") {
      await this.completeAutomaticReview(
        workspaceId,
        payment.id,
        payment.assetId,
      );
      return;
    }
    const stale = new Date(Date.now() - 60_000);
    const claimed = await this.context.db.payment.updateMany({
      where: {
        workspaceId,
        id: paymentId,
        assetId: payment.assetId,
        status: "PENDING",
        receiptMode: "AUTO_RECEIPT",
        conversation: {
          humanControlled: false,
          product: { is: { active: true, agentEnabled: true } },
        },
        OR: [
          { receiptCheckStatus: "NOT_RUN" },
          {
            receiptCheckStatus: "CHECKING",
            receiptCheckStartedAt: { lt: stale },
          },
        ],
      },
      data: {
        receiptCheckStatus: "CHECKING",
        receiptCheckStartedAt: new Date(),
      },
    });
    if (!claimed.count) return;
    let evaluation: ReturnType<typeof evaluateReceipt>;
    let fingerprint = "";
    try {
      const [asset, workspace, runtime] = await Promise.all([
        this.context.db.asset.findFirstOrThrow({
          where: { workspaceId, id: payment.assetId, purpose: "RECEIPT" },
        }),
        this.context.db.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
        }),
        this.context.integrations?.resolve(workspaceId) ||
          Promise.resolve(this.context.config),
      ]);
      fingerprint = sha256(await readFile(asset.path));
      const extracted = await this.context.receiptVerifier.extract(
        asset.path,
        asset.mime,
        runtime,
      );
      evaluation = evaluateReceipt(extracted, {
        amountCents: payment.amountCents,
        currency: payment.currency,
        alias: workspace.paymentAlias,
        earliest: payment.conversation.createdAt,
      });
    } catch {
      evaluation = {
        ok: false,
        summary:
          "No se pudo leer el comprobante con IA. Requiere revisión manual.",
      };
    }
    let readyToApprove = false;
    await this.context.locked(workspaceId, async (tx) => {
      const current = await tx.payment.findFirst({
        where: { workspaceId, id: paymentId },
      });
      if (
        !current ||
        current.status !== "PENDING" ||
        current.receiptCheckStatus !== "CHECKING" ||
        current.assetId !== payment.assetId
      )
        return;
      let summary = evaluation.summary;
      let passed = evaluation.ok;
      const reference = evaluation.ok ? evaluation.reference : "";
      if (passed) {
        try {
          if (
            await receiptWasUsed(
              tx,
              workspaceId,
              paymentId,
              fingerprint,
              reference,
            )
          ) {
            passed = false;
            summary =
              "El ID o archivo del comprobante ya fue usado. Requiere revisión manual.";
          }
        } catch {
          passed = false;
          summary =
            "No se pudo comprobar el historial de recibos. Requiere revisión manual.";
        }
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          receiptCheckStatus: passed ? "PASSED" : "NEEDS_REVIEW",
          receiptCheckSummary: summary,
          ...(passed
            ? { receiptReference: reference, receiptFingerprint: fingerprint }
            : {}),
        },
      });
      readyToApprove = passed;
    });
    if (readyToApprove) {
      await this.completeAutomaticReview(
        workspaceId,
        paymentId,
        payment.assetId,
      );
    }
  }
  async verifyPendingReceipts(workspaceId: string) {
    if (this.context.config.paymentAutomationEnabled === false) return;
    const payments = await this.context.db.payment.findMany({
      where: {
        workspaceId,
        status: "PENDING",
        receiptMode: "AUTO_RECEIPT",
        conversation: {
          humanControlled: false,
          product: { is: { active: true, agentEnabled: true } },
        },
        OR: [
          { receiptCheckStatus: "NOT_RUN" },
          { receiptCheckStatus: "PASSED" },
          {
            receiptCheckStatus: "CHECKING",
            receiptCheckStartedAt: { lt: new Date(Date.now() - 60_000) },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const payment of payments)
      await this.verifyReceipt(workspaceId, payment.id);
  }
}
