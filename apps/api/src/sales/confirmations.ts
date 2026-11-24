import { normalizeSalesText, money } from "../seller/text.js";
import { formatPackChoices } from "./messages.js";

export function isShortConfirmation(text: string) {
  return /^(?:(?:si|sisi|dale|ok|okay|bueno|perfecto|listo|de acuerdo)(?: |$))+(?:gracias)?$/.test(
    normalizeSalesText(text),
  );
}

type Pack = { number: number; name: string; priceCents: number };

export function packOfferText(pack: Pack, currency: string) {
  return `El Pack ${pack.number}: ${pack.name} cuesta ${money(pack.priceCents, currency)}. ¿Querés llevarlo?`;
}

type Confirmation =
  | { kind: "choose"; number: number }
  | { kind: "reply"; key: string; text: string }
  | { kind: "wait" }
  | { kind: "unhandled" };

// A bare yes can confirm an explicit offer, but cannot invent a pack or prove payment.
export function resolveConfirmation(
  conversation: {
    state: string;
    selectedPackNumber: number | null;
    quotedPriceCents: number | null;
  },
  packs: Pack[],
  currency: string,
  last: { origin: string; text: string; externalId: string | null } | null,
): Confirmation {
  if (!last || last.origin !== "AUTO") return { kind: "unhandled" };
  const offered = packs.find(
    (pack) => last.text === packOfferText(pack, currency),
  );
  if (offered) return { kind: "choose", number: offered.number };
  if (
    conversation.state === "AWAITING_PAYMENT" &&
    conversation.quotedPriceCents !== null
  ) {
    if (last.externalId?.startsWith("payment-ack:")) return { kind: "wait" };
    return {
      kind: "reply",
      key: "payment-ack",
      text: `Perfecto, seguimos con ${conversation.selectedPackNumber ? `el Pack ${conversation.selectedPackNumber}` : "tu compra"}. Cuando hagas la transferencia, enviame el comprobante en imagen o PDF para revisarlo.`,
    };
  }
  if (packs.length && !conversation.selectedPackNumber) {
    if (last.externalId?.startsWith("confirmation-clarify:"))
      return { kind: "wait" };
    if (last.externalId?.startsWith("confirmation-options:")) {
      return {
        kind: "reply",
        key: "confirmation-clarify",
        text: `Necesito el número del pack para continuar. Respondé ${packs.map((pack) => pack.number).join(" o ")}.`,
      };
    }
    return {
      kind: "reply",
      key: "confirmation-options",
      text: `Estos son los packs: ${formatPackChoices(packs, currency, true)}. ¿Cuál elegís? Respondé con el número.`,
    };
  }
  if (
    packs.length &&
    conversation.selectedPackNumber &&
    conversation.state === "QUALIFIED"
  ) {
    if (last.externalId?.startsWith("confirmation-selected:"))
      return { kind: "wait" };
    return {
      kind: "reply",
      key: "confirmation-selected",
      text: `Tu elección del Pack ${conversation.selectedPackNumber} está guardada. Escribí «comprar» para pedir los datos de pago o «humano» para recibir ayuda del equipo.`,
    };
  }
  return { kind: "unhandled" };
}
