import { normalize } from "../seller/text.js";
import { resolveCampaignMatch } from "./selection.js";

// Generic sales words cannot establish which course the customer is asking about.
const genericWords = new Set(
  "hola buenas buen dia dias tardes noches precio precios informacion info comprar compra pagar pago comprobante curso cursos pack packs si ok gracias quiero quisiera saber mas me interesa interesan el la los las un una de del sobre por favor cuanto cuesta vale sale este ese como hago para adquirir adquirirlo llevarlo pasame mandame brindas das podes tenes disponible detalles necesito".split(
    " ",
  ),
);
const isGeneric = (phrase: string) =>
  normalize(phrase)
    .split(" ")
    .every((word) => !word || genericWords.has(word) || /^\d+$/.test(word));
const contains = (query: string, phrase: string) =>
  !!phrase && ` ${query} `.includes(` ${phrase} `);

export function resolveCourseScope<
  T extends {
    id: string;
    name: string;
    active: boolean;
    agentEnabled: boolean;
  },
>(
  query: string,
  referral: { adId?: string } | undefined,
  campaigns: { code: string; adId: string | null; productId: string }[],
  products: T[],
) {
  const names = products.flatMap((product) => {
    const name = normalize(product.name);
    const short = name.replace(/^(?:curso|taller) (?:de )?/, "");
    return [...new Set([name, short])]
      .filter((code) => code.length > 1 && !isGeneric(code))
      .map((code) => ({ code, adId: null, productId: product.id }));
  });
  const identifiers = [
    ...campaigns.filter((c) => !isGeneric(c.code) || !!c.adId),
    ...names,
  ];
  // A generic code may identify an ad, but must not activate from its text alone.
  const safeIdentifiers = identifiers.map((c) =>
    isGeneric(c.code) ? { ...c, code: "" } : c,
  );
  const product = resolveCampaignMatch(
    query,
    referral,
    safeIdentifiers,
    products,
  );
  const hasReference = safeIdentifiers.some(
    (c) =>
      contains(query, normalize(c.code)) ||
      (c.adId && c.adId === referral?.adId),
  );
  const subjects = [
    ...query.matchAll(
      /\b(?:curso|taller|capacitacion) (?:de|sobre|para aprender) (.+?)(?=\b(?:y el curso|y curso|pero|ahora)\b|$)/g,
    ),
  ];
  const unknownSubject = subjects.some((match) => {
    const subject = match[1].trim();
    if (
      /^(?:ustedes|ustedes mismos|principiantes|cero|nivel|\d)\b/.test(subject)
    )
      return false;
    return !safeIdentifiers.some((c) => contains(subject, normalize(c.code)));
  });
  const outside =
    unknownSubject ||
    (!!referral?.adId && !hasReference) ||
    (hasReference && !product) ||
    (!!product && (!product.active || !product.agentEnabled));
  return { product: outside ? undefined : product, outside };
}
