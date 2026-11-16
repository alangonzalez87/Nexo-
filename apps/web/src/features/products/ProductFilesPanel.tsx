import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { FileTextIcon as FileText } from "@solar-icons/react/linear/file-text";
import { TrashBinMinimalisticIcon as Trash2 } from "@solar-icons/react/linear/trash-bin-minimalistic";
import { api } from "../../api";
import { UploadForm } from "../../components/UploadForm";
import type { ProductEditorContext } from "./editorTypes";

export function ProductFilesPanel({
  product,
  busy,
  run,
  update,
  packs,
}: Pick<
  ProductEditorContext,
  "product" | "busy" | "run" | "update" | "packs"
>) {
  return (
    <div className="form-card">
      <h3>Conocimiento del agente</h3>
      <p className="muted">
        PDF con texto seleccionable, hasta 8 MB. El modo automático puede usar
        fragmentos del documento.
      </p>
      {product.documents.map((d) => (
        <div className="file-row" key={d.id}>
          <FileText size={19} />
          <span>{d.name}</span>
          <button
            className="icon-button"
            title="Quitar documento"
            onClick={() =>
              run(async () => {
                await api(
                  `/products/${product.id}/documents/${d.id}`,
                  "DELETE",
                );
                update({
                  ...product,
                  documents: product.documents.filter((v) => v.id !== d.id),
                });
              })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <UploadForm
        label="Subir PDF de conocimiento"
        accept="application/pdf"
        busy={busy}
        submit={(file) =>
          run(async () => {
            const d = await api(
              `/products/${product.id}/files/knowledge`,
              "POST",
              file,
            );
            update({
              ...product,
              documents: [...product.documents, d],
            });
          }, "Texto del PDF extraído y guardado")
        }
      />
      <hr />
      <h3>Archivo de entrega digital</h3>
      <p className="muted">
        Para productos sin packs: se entrega mediante un enlace privado de 24
        horas después de aprobar el pago. Los packs usan el mensaje de entrega
        configurado en Packs.
      </p>
      {product.deliveryAssetId && (
        <div className="info-banner">
          <Check size={18} /> Archivo de entrega configurado
        </div>
      )}
      <UploadForm
        label={
          product.deliveryAssetId
            ? "Reemplazar archivo de entrega"
            : "Subir producto digital"
        }
        accept="application/pdf,image/png,image/jpeg"
        busy={busy}
        submit={(file) =>
          run(async () => {
            const a = await api(
              `/products/${product.id}/files/delivery`,
              "POST",
              file,
            );
            update({ ...product, deliveryAssetId: a.id });
          }, "Archivo de entrega guardado")
        }
      />
    </div>
  );
}
