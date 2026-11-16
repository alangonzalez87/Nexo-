import { productIntroduction } from "../../../../../packages/shared/src/product.js";
import React from "react";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";
import { formatMoney } from "../../api";
import type { Pack } from "../../types";
import type { ProductEditorContext } from "./editorTypes";
import { ResponseImage } from "../../components/ResponseImage";

export function ProductConversationPreview({
  product,
  tab,
  firstMessage,
  firstImageId,
  followUpImageIds,
  followUpMessages,
  packs,
  previewPack,
  setPreviewPack,
  keyword,
}: Pick<
  ProductEditorContext,
  | "product"
  | "tab"
  | "firstMessage"
  | "firstImageId"
  | "followUpImageIds"
  | "followUpMessages"
  | "packs"
  | "previewPack"
  | "setPreviewPack"
  | "keyword"
>) {
  return (
    <aside
      className="campaign-preview"
      aria-label="Vista previa de la conversación"
    >
      <div className="campaign-preview-header">
        <span className="campaign-preview-avatar">
          <MessageCircle size={21} />
        </span>
        <div>
          <h3>Vista previa</h3>
          <small>Ejemplo de conversación</small>
        </div>
      </div>
      {packs.length > 0 && tab === "packs" && (
        <div className="preview-pack-switch">
          {packs.map((_, index) => (
            <button
              type="button"
              key={index}
              className={previewPack === index ? "active" : ""}
              onClick={() => setPreviewPack(index)}
            >
              Pack {index + 1}
            </button>
          ))}
        </div>
      )}
      <div className="campaign-preview-chat">
        <div className="campaign-bubble customer">
          {keyword || "La frase de activación aparecerá acá"}
        </div>
        <div className="campaign-bubble seller">
          {firstImageId && (
            <ResponseImage id={firstImageId} alt="Imagen de bienvenida" />
          )}
          {firstMessage ||
            (product.id
              ? productIntroduction({ ...product, firstMessage })
              : "Tu primer mensaje aparecerá acá.")}
        </div>
        {(tab === "packs" ? [] : followUpMessages).map((message, i) => (
          <React.Fragment key={i}>
            <div className="campaign-bubble customer">Sí, contame más</div>
            <div className="campaign-bubble seller">
              {followUpImageIds[i] && (
                <ResponseImage id={followUpImageIds[i]} />
              )}
              {message}
            </div>
          </React.Fragment>
        ))}
        {packs.length > 0 && packs[previewPack] && (
          <>
            <div className="campaign-bubble customer">{previewPack + 1}</div>
            <div className="campaign-bubble seller">
              {packs[previewPack].imageId && (
                <ResponseImage id={packs[previewPack].imageId!} />
              )}
              Elegiste el Pack {previewPack + 1}:{" "}
              {packs[previewPack].name || "Nombre del pack"}.
              {packs[previewPack].summary && ` ${packs[previewPack].summary}`}
              {"\n"}Importe:{" "}
              {formatMoney(
                Math.round(Number(packs[previewPack].price || 0) * 100),
                product.currency,
              )}
              .{"\n"}Te comparto los datos para pagar y me enviás el
              comprobante.
            </div>
            <div className="campaign-bubble customer">Envío comprobante</div>
            <div className="campaign-bubble seller">
              Recibimos tu archivo. Lo revisaremos antes de entregar el pack.
            </div>
            <div className="campaign-bubble seller">
              {packs[previewPack].deliveryMessage ||
                "Acá se mostrará el mensaje de entrega cuando apruebes el pago."}
            </div>
          </>
        )}
      </div>
      <p>
        Es una vista previa: las respuestas reales dependen de lo que escriba el
        cliente.
      </p>
    </aside>
  );
}
