import type { SalesContext } from "./context.js";
import type { IncomingMessage } from "../messaging.js";
import {
  answer,
  money,
  normalize,
  OpenAISelector,
  productIntroduction,
  purchaseIntent,
  type PackIntent,
} from "../seller.js";
import { saveAsset } from "../storage.js";
import { HttpError, sha256 } from "../security.js";
import { findExactRule } from "../seller/text.js";
import { packChoice, resolveRequestedPacks } from "./selection.js";
import { formatPackChoices } from "./messages.js";
import { resolveCourseScope } from "./course-scope.js";
import {
  isShortConfirmation,
  packOfferText,
  resolveConfirmation,
} from "./confirmations.js";

export async function receiveMessage(
  context: SalesContext,
  workspaceId: string,
  input: IncomingMessage,
) {
  const runtime =
    (await context.integrations?.resolve(workspaceId)) || context.config;
  const paymentsAutomated = runtime.paymentAutomationEnabled !== false;
  const selector =
    context.selector ||
    (runtime.aiProvider === "openai" && runtime.openaiKey
      ? new OpenAISelector(runtime)
      : undefined);
  return context.locked(workspaceId, async (tx) => {
    const connection = await tx.connection.findFirst({
      where: { workspaceId, id: input.connectionId, status: "CONNECTED" },
    });
    if (!connection) throw new HttpError(409, "Conexión no disponible.");
    const eventKey = sha256(`${workspaceId}:${connection.id}:${input.eventId}`);
    const existing = await tx.message.findUnique({
      where: { externalId: eventKey },
    });
    if (existing)
      return { conversationId: existing.conversationId, duplicate: true };
    let conversation = await tx.conversation.upsert({
      where: {
        workspaceId_connectionId_contact: {
          workspaceId,
          connectionId: connection.id,
          contact: input.contact,
        },
      },
      create: {
        workspaceId,
        connectionId: connection.id,
        contact: input.contact,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
      },
      update: {
        updatedAt: new Date(),
        contactName: input.contactName,
        contactPhone: input.contactPhone,
      },
    });
    let asset = null;
    if (input.media)
      asset = await saveAsset(
        tx,
        runtime.storageDir,
        workspaceId,
        input.media.data,
        input.media.name,
        "RECEIPT",
      );
    if (input.assetId) {
      asset = await tx.asset.findFirst({
        where: { workspaceId, id: input.assetId, purpose: "RECEIPT" },
      });
      if (!asset)
        throw new HttpError(400, "Comprobante no válido para este negocio.");
    }
    await tx.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        externalId: eventKey,
        direction: "IN",
        text: input.text,
        assetId: asset?.id,
      },
    });
    const respond = (text: string, imageId?: string | null) =>
      context.outgoing(
        tx,
        workspaceId,
        conversation.id,
        text,
        `reply:${eventKey}`,
        undefined,
        "AUTO",
        imageId,
      );
    const respondPaymentDetails = (
      text: string,
      enabled: boolean,
      imageId?: string | null,
    ) =>
      !paymentsAutomated
        ? respond(
            "Gracias por tu interés. El equipo te indicará cómo continuar; los pagos por WhatsApp están desactivados por el momento.",
          )
        : context.outgoing(
        tx,
        workspaceId,
        conversation.id,
        text,
        enabled ? `payment-details:${eventKey}` : `reply:${eventKey}`,
        undefined,
        "AUTO",
        imageId,
      );
    if (
      !asset &&
      /\b(baja|stop|no me (?:escribas|contactes)|no (?:quiero|deseo) (?:mas )?mensajes)\b/.test(
        normalize(input.text),
      )
    ) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { marketingOptOutAt: new Date() },
      });
      return { conversationId: conversation.id };
    }
    const query = normalize(input.text);
    const products = await tx.product.findMany({
      where: { workspaceId },
      include: {
        rules: true,
        documents: true,
        packs: { orderBy: { number: "asc" } },
      },
    });
    const campaigns = await tx.campaign.findMany({ where: { workspaceId } });
    const scope = resolveCourseScope(
      query,
      input.referral,
      campaigns,
      products,
    );
    const cancelReplies = () =>
      tx.message.updateMany({
        where: {
          workspaceId,
          conversationId: conversation.id,
          direction: "OUT",
          status: "PENDING",
          origin: "AUTO",
          externalId: { not: { startsWith: "payment:" } },
        },
        data: { status: "CANCELLED" },
      });
    const canRoute =
      !conversation.humanControlled &&
      (!conversation.paused || conversation.state === "WON");
    if (scope.outside) {
      if (canRoute) {
        await cancelReplies();
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            state: "OUT_OF_SCOPE",
            paused: false,
            productId: null,
            quotedPriceCents: null,
            quotedCurrency: null,
            selectedPackNumber: null,
            selectedPackName: null,
            selectedPackDeliveryMessage: null,
          },
        });
      }
      return { conversationId: conversation.id };
    }
    let justQualified = false;
    const routedProduct = scope.product;
    // An attachment cannot start or switch a sale using an old quote.
    if (
      (asset || input.mediaUnavailable) &&
      routedProduct &&
      routedProduct.id !== conversation.productId
    )
      return { conversationId: conversation.id };
    if (
      canRoute &&
      !asset &&
      !input.mediaUnavailable &&
      routedProduct &&
      (conversation.productId !== routedProduct.id ||
        conversation.state === "WON")
    ) {
      await cancelReplies();
      conversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          productId: routedProduct.id,
          state: "QUALIFIED",
          paused: false,
          quotedPriceCents: null,
          quotedCurrency: null,
          selectedPackNumber: null,
          selectedPackName: null,
          selectedPackDeliveryMessage: null,
        },
      });
      justQualified = true;
      await tx.integrationEvent.create({
        data: {
          workspaceId,
          type: "lead.qualified.v1",
          payload: {
            conversationId: conversation.id,
            productId: routedProduct.id,
            referral: input.referral || {},
          },
        },
      });
    }
    const product = products.find(
      (p) => p.id === conversation.productId && p.active && p.agentEnabled,
    );
    if (!product || conversation.state === "WON") {
      await cancelReplies();
      return { conversationId: conversation.id };
    }
    if (input.mediaUnavailable) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          paused: true,
          humanControlled: true,
          state: conversation.state === "WON" ? "WON" : "HUMAN",
        },
      });
      await tx.notification.create({
        data: {
          workspaceId,
          text: `No se pudo obtener el archivo de ${input.contact}. Agente pausado; solicitá otro comprobante.`,
        },
      });
      if (!conversation.humanControlled)
        await respond(
          paymentsAutomated
            ? "Recibimos un aviso de archivo, pero no pudimos descargarlo. El equipo revisará el caso; el pago no está aprobado."
            : "No pudimos descargar el archivo. El equipo lo revisará manualmente; no se procesó ningún pago.",
        );
      return { conversationId: conversation.id };
    }
    if (asset) {
      if (conversation.state === "WON")
        return { conversationId: conversation.id };
      if (!paymentsAutomated) {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { paused: true, humanControlled: true, state: "HUMAN" },
        });
        await tx.notification.create({
          data: {
            workspaceId,
            text: "Se recibió un archivo; pagos desactivados, requiere revisión manual.",
          },
        });
        if (!conversation.humanControlled)
          await respond(
            "Recibimos tu archivo. El equipo lo revisará manualmente; no se procesó ni aprobó ningún pago.",
          );
        return { conversationId: conversation.id };
      }
      const receiptMode = product.receiptMode;
      const pending = await tx.payment.findFirst({
        where: {
          workspaceId,
          conversationId: conversation.id,
          status: "PENDING",
        },
      });
      const payment =
        (pending
          ? await tx.payment.update({
              where: { id: pending.id },
              data: {
                assetId: asset.id,
                receiptCheckStatus: "NOT_RUN",
                receiptCheckSummary: null,
                receiptCheckStartedAt: null,
                receiptReference: null,
                receiptFingerprint: null,
              },
            })
          : null) ||
        (await tx.payment.create({
          data: {
            workspaceId,
            conversationId: conversation.id,
            assetId: asset.id,
            amountCents: conversation.quotedPriceCents,
            currency: conversation.quotedCurrency,
            packNumber: conversation.selectedPackNumber,
            packName: conversation.selectedPackName,
            deliveryMessage: conversation.selectedPackDeliveryMessage,
            receiptMode,
          },
        }));
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { paused: true, state: "REVIEW" },
      });
      await tx.notification.create({
        data: {
          workspaceId,
          text: `Comprobante recibido de ${input.contact}. ${receiptMode === "AUTO_RECEIPT" ? "Análisis automático pendiente." : "Requiere revisión manual."}`,
        },
      });
      if (!conversation.humanControlled)
        await respond(
          receiptMode === "AUTO_RECEIPT"
            ? "Recibimos tu archivo. Vamos a revisar los datos del comprobante; si no son claros, el equipo lo revisará manualmente."
            : "Recibimos tu archivo. El equipo revisará el comprobante manualmente; todavía no está aprobado.",
        );
      return {
        conversationId: conversation.id,
        paymentId: payment.id,
        paymentCreated: !pending,
      };
    }
    if (
      conversation.humanControlled ||
      conversation.paused ||
      conversation.state === "WON"
    )
      return { conversationId: conversation.id };
    if (/\b(humano|asesor|persona|operador)\b/.test(query)) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { paused: true, state: "HUMAN" },
      });
      await tx.notification.create({
        data: {
          workspaceId,
          text: `${input.contact} solicita atención humana.`,
        },
      });
      await respond("Te derivo con el equipo. El asistente queda en pausa.");
      return { conversationId: conversation.id };
    }
    if (justQualified) {
      const first = await respond(
        productIntroduction(product),
        product.firstImageId,
      );
      for (const [index, message] of product.followUpMessages.entries()) {
        await context.outgoing(
          tx,
          workspaceId,
          conversation.id,
          message,
          `reply:${eventKey}:followup:${index}`,
          new Date(first.createdAt.getTime() + index + 1),
          "AUTO",
          product.followUpImageIds[index] || null,
        );
      }
      return { conversationId: conversation.id };
    }
    const exact = findExactRule(product.rules, query);
    if (exact?.mandatory) {
      await respond(exact.answer, exact.imageId);
      return { conversationId: conversation.id };
    }
    let confirmedPack: number | undefined;
    if (isShortConfirmation(input.text)) {
      const last = await tx.message.findFirst({
        where: {
          workspaceId,
          conversationId: conversation.id,
          direction: "OUT",
          status: { in: ["SENT", "PENDING"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { origin: true, text: true, externalId: true },
      });
      const confirmation = resolveConfirmation(
        conversation,
        product.packs,
        product.currency,
        last,
      );
      if (confirmation.kind === "reply") {
        await context.outgoing(
          tx,
          workspaceId,
          conversation.id,
          confirmation.text,
          `${confirmation.key}:${eventKey}`,
        );
        return { conversationId: conversation.id };
      }
      if (confirmation.kind === "wait")
        return { conversationId: conversation.id };
      if (confirmation.kind === "choose") confirmedPack = confirmation.number;
    }
    if (product.packs.length) {
      let requestedNumbers =
        confirmedPack === undefined ? packChoice(query) : [confirmedPack];
      let interpreted: PackIntent | null = null;
      if (!requestedNumbers && selector?.classifyPack && input.text.trim()) {
        const recent = await tx.message.findMany({
          where: { workspaceId, conversationId: conversation.id },
          orderBy: { createdAt: "desc" },
          take: 7,
          select: { direction: true, text: true },
        });
        try {
          const result = await selector.classifyPack(
            input.text,
            product.packs,
            recent.reverse(),
            conversation.selectedPackNumber,
            product.currency,
          );
          const validNumbers = [...new Set(result.packNumbers)].filter(
            (number) => product.packs.some((pack) => pack.number === number),
          );
          interpreted = { intent: result.intent, packNumbers: validNumbers };
          if (result.intent === "choose" && validNumbers.length)
            requestedNumbers = validNumbers;
        } catch {
          // An unavailable model cannot create a quote or payment request.
        }
      }
      const { validPacks, selected } = resolveRequestedPacks(
        product.packs,
        requestedNumbers,
      );
      if (selected) {
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
        });
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            selectedPackNumber: selected.number,
            selectedPackName: selected.name,
            selectedPackDeliveryMessage: selected.deliveryMessage,
            quotedPriceCents: selected.priceCents,
            quotedCurrency: product.currency,
            state:
              paymentsAutomated && workspace.paymentAlias
                ? "AWAITING_PAYMENT"
                : "QUALIFIED",
          },
        });
        await respondPaymentDetails(
          workspace.paymentAlias
            ? `Elegiste el Pack ${selected.number}: ${selected.name}. ${selected.summary}\nImporte: ${money(selected.priceCents, product.currency)}.\nAlias: ${workspace.paymentAlias}\n${workspace.paymentInstructions}\nEnviá el comprobante en imagen o PDF. ${product.receiptMode === "AUTO_RECEIPT" ? "Analizaremos sus datos para habilitar el pack." : "Lo revisaremos antes de entregarte el pack."}`
            : `Elegiste el Pack ${selected.number}: ${selected.name}. El equipo todavía no configuró los datos de pago. Escribí «humano».`,
          !!workspace.paymentAlias && product.remarketingEnabled,
          selected.imageId,
        );
        return { conversationId: conversation.id };
      }
      if (requestedNumbers?.length && !selected) {
        await respond(
          validPacks?.length && validPacks.length > 1
            ? `No tengo un precio conjunto configurado para esos packs. ¿Cuál elegís: ${validPacks.map((pack) => `${pack.number} (${pack.name})`).join(" o ")}?`
            : `No encuentro ese pack. Elegí ${product.packs.map((pack) => pack.number).join(", ")}.`,
        );
        return { conversationId: conversation.id };
      }
      if (interpreted?.intent === "choose" && !requestedNumbers) {
        await respond(
          `¿Cuál pack querés? Respondé ${formatPackChoices(product.packs, product.currency)}.`,
        );
        return { conversationId: conversation.id };
      }
      if (
        interpreted?.intent === "price" &&
        interpreted.packNumbers.length === 1
      ) {
        const pack = product.packs.find(
          (item) => item.number === interpreted!.packNumbers[0],
        )!;
        await respond(packOfferText(pack, product.currency), pack.imageId);
        return { conversationId: conversation.id };
      }
      if (
        interpreted?.intent === "details" &&
        interpreted.packNumbers.length === 1
      ) {
        const pack = product.packs.find(
          (item) => item.number === interpreted!.packNumbers[0],
        )!;
        await respond(
          `El Pack ${pack.number}: ${pack.name} incluye: ${pack.summary}. Cuesta ${money(pack.priceCents, product.currency)}.`,
          pack.imageId,
        );
        return { conversationId: conversation.id };
      }
      if (["compare", "ambiguous"].includes(interpreted?.intent || "")) {
        await respond(
          `Estos son los packs: ${formatPackChoices(product.packs, product.currency, true)}. ¿Cuál elegís?`,
        );
        return { conversationId: conversation.id };
      }
      if (
        /^(?:(?:quiero|dame|pasame|mandame)\s+)?(?:(?:el|la)\s+)?(?:pack|pac|pak|pal)$/.test(
          query,
        )
      ) {
        await respond(
          `Claro. ¿Cuál pack querés? Respondé ${formatPackChoices(product.packs, product.currency)}.`,
        );
        return { conversationId: conversation.id };
      }
      if (!conversation.selectedPackNumber && purchaseIntent(query)) {
        if (!paymentsAutomated) {
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { paused: true, humanControlled: true, state: "HUMAN" },
          });
          await respond(
            "Gracias por tu interés. El equipo te contactará para continuar; los pagos por WhatsApp están desactivados por el momento.",
          );
          return { conversationId: conversation.id };
        }
        await respond(
          `¿Cuál pack querés llevar? Respondé ${formatPackChoices(product.packs, product.currency, true)}.`,
        );
        return { conversationId: conversation.id };
      }
      if (/\b(precio|cuanto|cuesta|valor)\b/.test(query)) {
        await respond(
          conversation.selectedPackNumber
            ? `El Pack ${conversation.selectedPackNumber}: ${conversation.selectedPackName} cuesta ${money(conversation.quotedPriceCents!, conversation.quotedCurrency || product.currency)}. Si querés cambiar, respondé con el número de otro pack.`
            : `Los packs disponibles son: ${formatPackChoices(product.packs, product.currency, true)}. ¿Cuál elegís?`,
        );
        return { conversationId: conversation.id };
      }
    }
    if (purchaseIntent(query)) {
      if (!paymentsAutomated) {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { paused: true, humanControlled: true, state: "HUMAN" },
        });
        await respond(
          "Gracias por tu interés. El equipo te contactará para continuar; los pagos por WhatsApp están desactivados por el momento.",
        );
        return { conversationId: conversation.id };
      }
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
      });
      if (!workspace.paymentAlias) {
        await respond(
          "El equipo todavía no configuró los datos de pago. Escribí «humano».",
        );
        return { conversationId: conversation.id };
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          state: "AWAITING_PAYMENT",
          quotedPriceCents: conversation.quotedPriceCents ?? product.priceCents,
          quotedCurrency: conversation.quotedCurrency ?? product.currency,
        },
      });
      await respondPaymentDetails(
        `Para comprar ${conversation.selectedPackName ? `Pack ${conversation.selectedPackNumber}: ${conversation.selectedPackName}` : product.name}, transferí ${money(conversation.quotedPriceCents ?? product.priceCents, conversation.quotedCurrency ?? product.currency)}.\nAlias: ${workspace.paymentAlias}\n${workspace.paymentInstructions}\nEnviá el comprobante en imagen o PDF. ${product.receiptMode === "AUTO_RECEIPT" ? "Analizaremos sus datos para habilitar el curso." : "La aprobación es manual."}`,
        product.remarketingEnabled,
      );
    } else {
      const history = await tx.message.findMany({
        where: { workspaceId, conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      let ruleIds: string[] = [];
      const text = await answer(
        conversation.selectedPackNumber &&
          conversation.quotedPriceCents !== null
          ? { ...product, priceCents: conversation.quotedPriceCents }
          : product,
        input.text,
        history.reverse(),
        selector,
        (ids) => {
          ruleIds = ids;
        },
      );
      const imageIds = [
        ...new Set(
          ruleIds
            .map((id) => product.rules.find((rule) => rule.id === id)?.imageId)
            .filter((id): id is string => !!id),
        ),
      ];
      await respond(text, imageIds[0]);
      for (const [index, imageId] of imageIds.slice(1).entries()) {
        await context.outgoing(
          tx,
          workspaceId,
          conversation.id,
          "",
          `reply:${eventKey}:attachment:${index}`,
          undefined,
          "AUTO",
          imageId,
        );
      }
    }
    return { conversationId: conversation.id };
  });
}
