/** Pure presentation rules shared by the browser and the seller. */
export const formatMoney = (cents: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(
    cents / 100,
  );

export function productIntroduction(product: {
  name: string;
  hook: string;
  description: string;
  priceCents: number;
  currency: string;
  cta: string;
  firstMessage?: string | null;
}) {
  if (product.firstMessage) return product.firstMessage;
  return [
    product.hook,
    `Te cuento sobre ${product.name}.`,
    product.description,
    `Precio: ${formatMoney(product.priceCents, product.currency)}`,
    product.cta,
  ]
    .filter(Boolean)
    .join("\n\n");
}
