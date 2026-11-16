import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { TrashBinMinimalisticIcon as Trash2 } from "@solar-icons/react/linear/trash-bin-minimalistic";
import { api } from "../../api";
import type { Pack } from "../../types";
import type { ProductEditorContext } from "./editorTypes";
import { ImagePicker } from "../../components/ResponseImage";

export function ProductPacksForm({
  product,
  busy,
  run,
  update,
  packs,
  setPacks,
  setPreviewPack,
  updatePack,
}: Pick<
  ProductEditorContext,
  | "product"
  | "busy"
  | "run"
  | "update"
  | "packs"
  | "setPacks"
  | "setPreviewPack"
  | "updatePack"
>) {
  return (
    <form
      className="form-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const saved = await api<Pack[]>(
            `/products/${product.id}/packs`,
            "PUT",
            packs.map((pack, index) => ({
              number: index + 1,
              name: pack.name,
              priceCents: Math.round(Number(pack.price) * 100),
              summary: pack.summary,
              imageId: pack.imageId,
              deliveryMessage: pack.deliveryMessage,
            })),
          );
          update({ ...product, packs: saved });
        }, "Packs guardados");
      }}
    >
      <h3>Packs y entrega</h3>
      <p className="muted">
        Configurá cada opción que ofrecés en el primer mensaje. El cliente elige
        por número. El texto de entrega se envía recién después de aprobar su
        comprobante.
      </p>
      {packs.map((pack, index) => (
        <div className="rule-card" key={index}>
          <div className="section-title">
            <h3>Pack {index + 1}</h3>
            <button
              type="button"
              className="icon-button"
              title={`Quitar Pack ${index + 1}`}
              onClick={() => {
                setPacks(packs.filter((_, i) => i !== index));
                setPreviewPack(0);
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <label>
            Nombre del pack
            <input
              value={pack.name}
              required
              maxLength={100}
              placeholder="Ejemplo: Flores y llaveros"
              onChange={(e) => updatePack(index, { name: e.target.value })}
            />
          </label>
          <label>
            Precio
            <input
              type="number"
              min="0"
              max="10000000"
              step="0.01"
              value={pack.price}
              required
              onChange={(e) => updatePack(index, { price: e.target.value })}
            />
          </label>
          <label>
            Qué incluye
            <textarea
              rows={2}
              maxLength={1000}
              value={pack.summary}
              placeholder="Ejemplo: Flores y llaveros"
              onChange={(e) => updatePack(index, { summary: e.target.value })}
            />
          </label>
          <ImagePicker
            value={pack.imageId}
            onChange={(imageId) => updatePack(index, { imageId })}
            busy={busy}
            run={run}
            label={`Imagen de presentación del Pack ${index + 1}`}
          />
          <small className="field-help">
            Se envía al elegir el pack o consultar sus detalles. Guardá los
            packs para aplicar el cambio.
          </small>
          <label>
            Mensaje de entrega después de aprobar el pago
            <textarea
              rows={9}
              required
              maxLength={4000}
              value={pack.deliveryMessage}
              placeholder="Pegá el mensaje completo con los enlaces de este pack"
              onChange={(e) =>
                updatePack(index, { deliveryMessage: e.target.value })
              }
            />
            <small className="field-help">
              Pegá los enlaces como direcciones completas (https://...). Revisá
              que este texto incluya sólo los cursos de este pack.
            </small>
            {index > 0 &&
              !pack.deliveryMessage &&
              packs[index - 1].deliveryMessage && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    updatePack(index, {
                      deliveryMessage: packs[index - 1].deliveryMessage,
                    })
                  }
                >
                  Copiar mensaje del pack anterior
                </button>
              )}
          </label>
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={packs.length >= 9}
          onClick={() => {
            setPacks([
              ...packs,
              {
                number: packs.length + 1,
                name: "",
                price: "",
                summary: "",
                deliveryMessage: "",
              },
            ]);
            setPreviewPack(packs.length);
          }}
        >
          <Plus size={16} /> Agregar pack
        </button>
        <button className="primary" disabled={busy}>
          <Check size={16} /> Guardar packs
        </button>
      </div>
    </form>
  );
}
