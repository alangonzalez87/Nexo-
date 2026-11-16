export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export { formatMoney as money } from "../../../../packages/shared/src/product.js";

export function findExactRule<
  T extends { question: string; mandatory: boolean },
>(rules: readonly T[], query: string) {
  return rules
    .filter((r) => normalize(r.question) === query)
    .sort((a, b) => Number(b.mandatory) - Number(a.mandatory))[0];
}
