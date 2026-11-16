import { money } from "../seller/text.js";

export function formatPackChoices(
  packs: { number: number; name: string; priceCents: number }[],
  currency: string,
  includePrice = false,
) {
  return packs.map((pack) => includePrice
    ? `${pack.number} (${pack.name}, ${money(pack.priceCents, currency)})`
    : `${pack.number} (${pack.name})`).join(", ");
}
