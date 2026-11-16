import { CloseIcon as X } from "@solar-icons/react/linear/close";
import { ProductDetailsForm } from "./ProductDetailsForm";
import { ProductPacksForm } from "./ProductPacksForm";
import { ProductRulesForm } from "./ProductRulesForm";
import { ProductFilesPanel } from "./ProductFilesPanel";
import { ProductConversationPreview } from "./ProductConversationPreview";
import type { ProductEditorProps } from "./editorTypes";
import { useProductEditor } from "./useProductEditor";

export function ProductEditor(props: ProductEditorProps) {
  const { product, tab, setTab, close, busy, run, update } = props;
  const editor = { ...props, ...useProductEditor(product) };
  return (
    <div className="modal-backdrop">
      <section className="modal product-modal">
        <div className="modal-header">
          <div>
            <small>CATÁLOGO DE PRODUCTOS</small>
            <h2>{product.id ? product.name : "Nuevo producto"}</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Cerrar editor"
          >
            <X size={22} />
          </button>
        </div>
        <div className="tabs">
          {[
            ["general", "Para empezar"],
            ["commercial", "Agente y pagos"],
            ["packs", "Packs"],
            ["responses", "Respuestas"],
            ["files", "Archivos"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
              disabled={!product.id && id !== "general"}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="product-editor-layout">
          <div className="modal-body">
            {(tab === "general" || tab === "commercial") && (
              <ProductDetailsForm {...editor} />
            )}
            {tab === "packs" && <ProductPacksForm {...editor} />}
            {tab === "responses" && <ProductRulesForm {...editor} />}
            {tab === "files" && <ProductFilesPanel {...editor} />}
          </div>
          <ProductConversationPreview {...editor} />
        </div>
      </section>
    </div>
  );
}
