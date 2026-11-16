import { useState } from "react";
import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { CloseIcon as X } from "@solar-icons/react/linear/close";
import { api, formatMoney } from "../../api";
import type { Product, Run } from "../../types";
export function PaymentActions({
  payment,
  products,
  busy,
  run,
}: {
  payment: any;
  products: Product[];
  busy: boolean;
  run: Run;
}) {
  const [decision, setDecision] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<
    "SEND" | "ALREADY_DELIVERED"
  >("SEND");
  const alreadyDelivered = deliveryMode === "ALREADY_DELIVERED";
  function beginReview(
    value: string,
    mode: "SEND" | "ALREADY_DELIVERED" = "SEND",
  ) {
    setExpectedAssetId(payment.assetId);
    setDeliveryMode(mode);
    setDecision(value);
  }
  const [expectedAssetId, setExpectedAssetId] = useState(payment.assetId);
  const receiptChanged = expectedAssetId !== payment.assetId;
  const [productId, setProductId] = useState(
    payment.conversation.product?.id || "",
  );
  const [packNumber, setPackNumber] = useState(
    payment.packNumber ? String(payment.packNumber) : "",
  );
  const product = products.find((item) => item.id === productId);
  const pack = product?.packs.find(
    (item) => String(item.number) === packNumber,
  );
  const needsSelection =
    payment.amountCents === null ||
    (!alreadyDelivered &&
      !payment.deliveryMessage &&
      !products.find((item) => item.id === payment.conversation.product?.id)
        ?.deliveryAssetId);
  const missingDelivery =
    !alreadyDelivered &&
    product &&
    !product.packs.length &&
    !product.deliveryAssetId;
  return decision ? (
    <form
      className="payment-confirm"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            await api(`/payments/${payment.id}/review`, "POST", {
              decision,
              reason: "",
              expectedAssetId,
              ...(decision === "APPROVED" ? { deliveryMode } : {}),
              ...(decision === "APPROVED" && needsSelection
                ? {
                    selection: {
                      productId,
                      ...(pack ? { packNumber: pack.number } : {}),
                    },
                  }
                : {}),
            });
            setDecision("");
          },
          decision === "APPROVED"
            ? alreadyDelivered
              ? "Pago aprobado; entrega manual registrada, sin enviar mensajes"
              : "Pago aprobado y entrega encolada"
            : payment.conversation.humanControlled
              ? "Pago rechazado; la conversación sigue atendida por vos"
              : "Pago rechazado",
        );
      }}
    >
      <small>
        {decision === "APPROVED"
          ? alreadyDelivered
            ? "Confirmás que verificaste el pago y ya entregaste el curso. No se enviará ningún mensaje."
            : "Confirmá sólo si verificaste la transferencia. Se enviará el curso al cliente."
          : payment.conversation.humanControlled
            ? "Se registrará el rechazo sin enviar mensajes: esta conversación está atendida por vos."
            : "El cliente recibirá un aviso para enviar otro comprobante."}
      </small>
      {receiptChanged && (
        <small role="alert" className="payment-blocker">
          El comprobante cambió. Cancelá y abrí el archivo actual antes de
          revisarlo.
        </small>
      )}
      {decision === "APPROVED" && needsSelection && (
        <>
          <label>
            Producto que corresponde al pago
            <select
              required
              value={productId}
              onChange={(event) => {
                setProductId(event.target.value);
                setPackNumber("");
              }}
            >
              <option value="">Elegí un producto</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {product && product.packs.length > 0 && (
            <label>
              Pack que corresponde al pago
              <select
                required
                value={packNumber}
                onChange={(event) => setPackNumber(event.target.value)}
              >
                <option value="">Elegí un pack</option>
                {product.packs.map((item) => (
                  <option key={item.number} value={item.number}>
                    Pack {item.number}: {item.name} ·{" "}
                    {formatMoney(item.priceCents, product.currency)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {missingDelivery && (
            <small className="payment-blocker">
              Este producto no tiene archivo de entrega. Cargalo en Producto y
              agente → Archivos.
            </small>
          )}
          {!alreadyDelivered && pack && !pack.deliveryMessage && (
            <small className="payment-blocker">
              Este pack no tiene mensaje de entrega. Cargalo en Producto y
              agente → Packs.
            </small>
          )}
          {(pack || (product && !product.packs.length)) && (
            <small>
              Importe esperado:{" "}
              {formatMoney(
                pack?.priceCents ?? product!.priceCents,
                product!.currency,
              )}
            </small>
          )}
        </>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={
            busy ||
            receiptChanged ||
            (decision === "APPROVED" &&
              needsSelection &&
              (!product ||
                (product.packs.length > 0 && !pack) ||
                !!missingDelivery ||
                !!(!alreadyDelivered && pack && !pack.deliveryMessage)))
          }
        >
          {decision === "APPROVED"
            ? alreadyDelivered
              ? "Confirmar: ya lo entregué"
              : "Confirmar y enviar curso"
            : "Confirmar rechazo"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setDecision("")}
        >
          Cancelar
        </button>
      </div>
    </form>
  ) : (
    <div className="button-row">
      <button
        className="approve"
        disabled={busy}
        onClick={() => beginReview("APPROVED", "SEND")}
      >
        <Check size={15} /> Aprobar y enviar curso
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => beginReview("APPROVED", "ALREADY_DELIVERED")}
      >
        Aprobar: ya lo entregué
      </button>
      <button
        className="reject"
        disabled={busy}
        onClick={() => beginReview("REJECTED")}
      >
        <X size={15} /> Rechazar
      </button>
    </div>
  );
}
