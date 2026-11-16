import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { TrashBinMinimalisticIcon as Trash2 } from "@solar-icons/react/linear/trash-bin-minimalistic";
import { api } from "../../api";
import type { ProductEditorContext } from "./editorTypes";
import { ImagePicker } from "../../components/ResponseImage";

export function ProductRulesForm({
  product,
  busy,
  run,
  update,
  rules,
  setRules,
  updateRule,
}: Pick<
  ProductEditorContext,
  "product" | "busy" | "run" | "update" | "rules" | "setRules" | "updateRule"
>) {
  return (
    <div className="form-card">
      <p className="muted">
        Las respuestas obligatorias tienen prioridad sobre la IA.
      </p>
      {rules.map((r, i) => (
        <div className="rule-card" key={i}>
          <div className="section-title">
            <h3>Respuesta {i + 1}</h3>
            <button
              className="icon-button"
              title="Eliminar respuesta"
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <label>
            Pregunta del cliente
            <input
              value={r.question}
              onChange={(e) => updateRule(i, { question: e.target.value })}
            />
          </label>
          <label>
            Respuesta exacta
            <textarea
              rows={3}
              value={r.answer}
              onChange={(e) => updateRule(i, { answer: e.target.value })}
            />
          </label>
          <ImagePicker
            value={r.imageId}
            onChange={(imageId) => updateRule(i, { imageId })}
            busy={busy}
            run={run}
            label={`Imagen de respuesta ${i + 1}`}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={r.mandatory}
              onChange={(e) => updateRule(i, { mandatory: e.target.checked })}
            />{" "}
            Respuesta obligatoria · prioridad sobre IA
          </label>
        </div>
      ))}
      <div className="button-row">
        <button
          className="secondary"
          onClick={() =>
            setRules([...rules, { question: "", answer: "", mandatory: true }])
          }
        >
          <Plus size={16} /> Agregar respuesta
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const saved = await api(
                `/products/${product.id}/rules`,
                "PUT",
                rules,
              );
              update({ ...product, rules: saved });
            }, "Respuestas guardadas")
          }
        >
          <Check size={16} /> Guardar respuestas
        </button>
      </div>
    </div>
  );
}
