import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { TrashBinMinimalisticIcon as Trash2 } from "@solar-icons/react/linear/trash-bin-minimalistic";
import { api } from "../../api";
import type { ProductEditorContext } from "./editorTypes";
import { ImagePicker } from "../../components/ResponseImage";

export function ProductDetailsForm({
  product,
  agentEnabled,
  setAgentEnabled,
  tab,
  close,
  busy,
  run,
  update,
  deleteConfirm,
  setDeleteConfirm,
  firstMessage,
  setFirstMessage,
  firstImageId,
  setFirstImageId,
  followUpImageIds,
  setFollowUpImageIds,
  followUpMessages,
  setFollowUpMessages,
  packs,
  keyword,
  setKeyword,
  notifyApprovalByWhatsApp,
  setNotifyApprovalByWhatsApp,
  receiptMode,
  setReceiptMode,
  remarketingEnabled,
  setRemarketingEnabled,
  remarketingDelayHours,
  setRemarketingDelayHours,
  remarketingMessage,
  setRemarketingMessage,
}: Pick<
  ProductEditorContext,
  | "product"
  | "agentEnabled"
  | "setAgentEnabled"
  | "tab"
  | "close"
  | "busy"
  | "run"
  | "update"
  | "deleteConfirm"
  | "setDeleteConfirm"
  | "firstMessage"
  | "firstImageId"
  | "setFirstImageId"
  | "followUpImageIds"
  | "setFollowUpImageIds"
  | "setFirstMessage"
  | "followUpMessages"
  | "setFollowUpMessages"
  | "packs"
  | "keyword"
  | "setKeyword"
  | "notifyApprovalByWhatsApp"
  | "setNotifyApprovalByWhatsApp"
  | "receiptMode"
  | "setReceiptMode"
  | "remarketingEnabled"
  | "setRemarketingEnabled"
  | "remarketingDelayHours"
  | "setRemarketingDelayHours"
  | "remarketingMessage"
  | "setRemarketingMessage"
>) {
  return (
    <form
      className="form-card"
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        const payload = {
          ...product,
          ...d,
          agentEnabled,
          firstMessage,
          firstImageId,
          notifyApprovalByWhatsApp,
          receiptMode,
          remarketingEnabled,
          remarketingDelayHours,
          remarketingMessage,
          followUpMessages: followUpMessages
            .map((message) => message.trim())
            .filter(Boolean),
          followUpImageIds: followUpMessages
            .map((message, index) => ({
              message: message.trim(),
              image: followUpImageIds[index] || "",
            }))
            .filter((item) => !!item.message)
            .map((item) => item.image),
          priceCents:
            d.price !== undefined
              ? Math.round(Number(d.price) * 100)
              : product.priceCents,
        };
        run(async () => {
          const saved = await api(
            `/products${product.id ? `/${product.id}` : ""}`,
            product.id ? "PUT" : "POST",
            payload,
          );
          update({ ...product, ...saved });
        }, "Producto guardado");
      }}
    >
      {tab === "general" ? (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={agentEnabled}
              onChange={(e) => setAgentEnabled(e.target.checked)}
            />
            Atendido por Nexo
          </label>
          <p className="muted">
            Si lo desactivás, Nexo no responde ni analiza comprobantes
            automáticamente para este curso. El curso y sus ventas se conservan.
          </p>
          <div className="product-section-heading">
            <h3>Lo esencial</h3>
            <p>
              Nombre, frase del anuncio y precio. Después podés completar el
              resto.
            </p>
          </div>
          <label>
            Nombre del producto
            <input
              name="name"
              defaultValue={product.name}
              required
              minLength={2}
            />
          </label>
          <label>
            Frase que activa al agente
            <input
              name="activationKeyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="Ejemplo: Quiero más información de limpiapipas"
              required
              maxLength={200}
            />
            <small className="field-help">
              Escribí la frase completa que llega desde tu anuncio de Meta. El
              agente responde cuando el mensaje la contiene.
            </small>
          </label>
          <div className="two-fields">
            <label>
              {packs.length ? "Precio base" : "Precio"}
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={product.priceCents / 100}
                required
              />
            </label>
            <label>
              Moneda
              <select name="currency" defaultValue={product.currency}>
                <option>ARS</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
          </div>
          <small className="field-help">
            Si ofrecés packs, vas a definir el precio de cada uno en “Packs”.
          </small>
          <div className="product-section-heading">
            <h3>Primer mensaje</h3>
            <p>
              Es lo primero que verá el cliente cuando llegue con esa frase.
            </p>
          </div>
          <label>
            Mensaje de bienvenida
            <textarea
              rows={4}
              maxLength={4000}
              required={followUpMessages.some((message) => !!message.trim())}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="Escribí el primer mensaje que recibirá el cliente"
            />
            <small className="field-help">
              Opcional. Si agregás mensajes siguientes, este campo es
              obligatorio.
            </small>
          </label>
          <ImagePicker
            value={firstImageId}
            onChange={setFirstImageId}
            busy={busy}
            run={run}
            label="Imagen de bienvenida"
          />
          <small className="field-help">
            Guardá el producto para aplicar las imágenes de bienvenida y
            mensajes siguientes.
          </small>
          <details
            className="product-optional"
            open={followUpMessages.length > 0}
          >
            <summary>
              Mensajes siguientes y ofertas adicionales <span>Opcional</span>
            </summary>
            <div className="campaign-messages">
              <p>
                Cada casilla sale como un mensaje separado. Se envían seguidos
                después de la bienvenida, sin esperar respuesta, cuando un
                cliente activa este producto por primera vez.
              </p>
              {followUpMessages.map((message, index) => (
                <div key={index}>
                  <label>
                    Mensaje {index + 1}
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={message}
                      onChange={(e) =>
                        setFollowUpMessages(
                          followUpMessages.map((value, i) =>
                            i === index ? e.target.value : value,
                          ),
                        )
                      }
                      placeholder="Escribí tu próximo mensaje"
                    />
                  </label>
                  <ImagePicker
                    value={followUpImageIds[index]}
                    onChange={(imageId) =>
                      setFollowUpImageIds(
                        followUpMessages.map((_, i) =>
                          i === index
                            ? imageId || ""
                            : followUpImageIds[i] || "",
                        ),
                      )
                    }
                    busy={busy}
                    run={run}
                    label={`Imagen del mensaje adicional ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() => {
                      setFollowUpMessages(
                        followUpMessages.filter((_, i) => i !== index),
                      );
                      setFollowUpImageIds(
                        followUpMessages
                          .filter((_, i) => i !== index)
                          .map(
                            (_, i) =>
                              followUpImageIds[i < index ? i : i + 1] || "",
                          ),
                      );
                    }}
                  >
                    <Trash2 size={15} /> Quitar mensaje
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={followUpMessages.length >= 20}
                onClick={() => setFollowUpMessages([...followUpMessages, ""])}
              >
                <Plus size={16} /> Agregar mensaje
              </button>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="product-section-heading">
            <h3>Cómo responde el agente</h3>
            <p>
              Este modo controla las respuestas informativas. Si OpenAI está
              activo, la IA interpreta la elección de packs en cualquiera de los
              modos; Nexo usa siempre el precio y la entrega configurados.
            </p>
          </div>
          <label>
            Modo del agente
            <select name="mode" defaultValue={product.mode}>
              <option value="STRICT">
                Estricto · respuestas exactas y datos comerciales
              </option>
              <option value="FLEXIBLE">
                Flexible · selección semántica de respuestas aprobadas
              </option>
              <option value="AUTO">
                Automático · selección de respuestas y conocimiento
              </option>
            </select>
          </label>
          <details className="product-optional">
            <summary>
              Textos adicionales del agente <span>Opcional</span>
            </summary>
            <div className="product-optional-fields">
              <label>
                Hook de bienvenida
                <textarea name="hook" rows={2} defaultValue={product.hook} />
              </label>
              <label>
                Llamado a la acción (CTA)
                <textarea name="cta" rows={2} defaultValue={product.cta} />
              </label>
              <label>
                Manejo de objeciones
                <textarea
                  name="objections"
                  rows={3}
                  defaultValue={product.objections}
                />
              </label>
            </div>
          </details>
          <div className="product-section-heading">
            <h3>Comprobantes y entrega</h3>
            <p>Por defecto, cada pago espera tu aprobación.</p>
          </div>
          <label>
            Revisión del comprobante
            <select
              value={receiptMode}
              onChange={(e) =>
                setReceiptMode(e.target.value as "MANUAL" | "AUTO_RECEIPT")
              }
            >
              <option value="MANUAL">Yo apruebo cada pago</option>
              <option value="AUTO_RECEIPT">
                Entregar si la IA lee un comprobante compatible
              </option>
            </select>
          </label>
          <small className="field-help">
            {receiptMode === "AUTO_RECEIPT"
              ? "La IA compara los datos del comprobante, pero no confirma que el dinero llegó. Un comprobante falso podría liberar el curso. Si faltan datos, pide tu revisión."
              : "Cada comprobante aparece en Pagos para que lo apruebes antes de entregar."}
          </small>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={notifyApprovalByWhatsApp}
              onChange={(e) => setNotifyApprovalByWhatsApp(e.target.checked)}
            />
            Avisarme por WhatsApp cuando llegue un comprobante
          </label>
          <div className="product-section-heading">
            <h3>Recordatorio de pago</h3>
            <p>
              Para futuras conversaciones. Se envía una sola vez si mandamos el
              alias y aún no llegó un comprobante.
            </p>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={remarketingEnabled}
              onChange={(e) => setRemarketingEnabled(e.target.checked)}
            />
            Enviar recordatorio automático
          </label>
          {remarketingEnabled && (
            <>
              <label>
                Esperar después de enviar los datos de pago
                <select
                  value={remarketingDelayHours}
                  onChange={(e) =>
                    setRemarketingDelayHours(Number(e.target.value))
                  }
                >
                  <option value={2}>2 horas</option>
                  <option value={6}>6 horas</option>
                  <option value={18}>18 horas</option>
                </select>
              </label>
              <label>
                Mensaje de recordatorio
                <textarea
                  rows={4}
                  maxLength={1000}
                  required
                  value={remarketingMessage}
                  onChange={(e) => setRemarketingMessage(e.target.value)}
                />
              </label>
              <small className="field-help">
                Sólo para clientes que aceptaron recibir seguimiento. Nexo lo
                cancela si el cliente responde, envía un comprobante, pide no
                recibir mensajes o pasan 23 horas desde su último mensaje.
              </small>
            </>
          )}
        </>
      )}
      <div className="modal-footer">
        <button className="primary" disabled={busy}>
          <Check size={16} /> Guardar cambios
        </button>
        {product.id && (
          <button
            type="button"
            className="danger-text"
            onClick={() => setDeleteConfirm(!deleteConfirm)}
          >
            <Trash2 size={15} /> Eliminar producto
          </button>
        )}
      </div>
      {deleteConfirm && (
        <div className="info-banner">
          Se quitará del catálogo y se conservará el historial.
          <button
            type="button"
            className="reject"
            onClick={() =>
              run(async () => {
                await api(`/products/${product.id}`, "DELETE");
                close();
              }, "Producto eliminado")
            }
          >
            Confirmar
          </button>
        </div>
      )}
    </form>
  );
}
