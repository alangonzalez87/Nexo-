export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export { formatMoney as money } from "../../../../packages/shared/src/product.js";

export function normalizeSalesText(text: string) {
  return normalize(text)
    .replace(/\bs+i+\b/g, "si")
    .replace(/\b(?:quiero+|quioero|quieor|qiero|quero)\b/g, "quiero");
}
export const isBarePurchaseRequest = (query: string) =>
  /^(?:hola )?quiero(?: por favor| gracias)?$/.test(query);

export function asksForSample(text: string) {
  const query = normalize(text);
  return (
    /^(?:muestras?|modelos?|ejemplos?|videos?|fotos?|imagenes?)$/.test(query) ||
    (/\b(?:muestras?|modelos?|ejemplos?|videos?|fotos?|imagenes?)\b/.test(
      query,
    ) &&
      /\b(?:ver|mirar|mostrar|mostras|mostrame|pasame|pasas|mandame|mandas|compartis|compartime|de muestra|tenes (?:alguna? )?(?:muestras?|ejemplos?))\b/.test(
        query,
      ))
  );
}

export function findExactRule<
  T extends { question: string; mandatory: boolean },
>(rules: readonly T[], query: string) {
  return rules
    .filter((r) => normalize(r.question) === query)
    .sort((a, b) => Number(b.mandatory) - Number(a.mandatory))[0];
}
