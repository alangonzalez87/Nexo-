import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney,
  productIntroduction,
} from "../../../packages/shared/src/product.js";
import { money } from "../src/seller/text.js";

test("panel, seller and preview preserve cents in all supported currencies", () => {
  for (const currency of ["ARS", "USD", "EUR"]) {
    assert.match(formatMoney(10050, currency), /100,50/);
    assert.equal(formatMoney(10050, currency), money(10050, currency));
    const product = {
      name: "Curso",
      hook: "Hola",
      description: "Contenido",
      priceCents: 10050,
      currency,
      cta: "Escribime",
    };
    assert.ok(
      productIntroduction(product).includes(
        `Precio: ${formatMoney(10050, currency)}`,
      ),
    );
    assert.equal(
      productIntroduction({
        ...product,
        firstMessage: "Mensaje personalizado",
      }),
      "Mensaje personalizado",
    );
  }
});
