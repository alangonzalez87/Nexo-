import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Product } from "../../types";
import type {
  CourseReplyRequest,
  CourseReplyResult,
  CourseReplyTarget,
} from "../../../../../packages/shared/src/course-replies.js";

export type CourseReplySelection = {
  label: string;
  unansweredOnly: boolean;
  targets: (CourseReplyTarget & { label: string })[];
};

export function courseReplySummary(results: CourseReplyResult[]) {
  const queued = results.filter((result) => result.status === "QUEUED").length;
  const existing = results.filter(
    (result) => result.status === "ALREADY_QUEUED",
  ).length;
  return [
    queued === 1
      ? "1 presentación en cola."
      : queued > 1
        ? `${queued} presentaciones en cola.`
        : "",
    existing === 1
      ? "1 presentación ya registrada."
      : existing > 1
        ? `${existing} presentaciones ya registradas.`
        : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function CourseReplyDialog({
  selection,
  products,
  onClose,
  onResult,
}: {
  selection: CourseReplySelection;
  products: Product[];
  onClose: () => void;
  onResult: (results: CourseReplyResult[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [search, setSearch] = useState("");
  const [chosenId, setChosenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<CourseReplyResult[] | null>(null);
  const chosen = products.find(
    (product) => product.id === chosenId && product.agentEnabled,
  );
  const visible = products.filter((product) =>
    product.name
      .toLocaleLowerCase("es-AR")
      .includes(search.trim().toLocaleLowerCase("es-AR")),
  );
  const skipped =
    results?.filter((result) => result.status === "SKIPPED") ?? [];
  const summary = results ? courseReplySummary(results) : "";

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    searchInput.current?.focus();
    return () => element.close();
  }, []);

  async function send() {
    if (!chosen || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const request: CourseReplyRequest = {
        productId: chosen.id,
        targets: selection.targets.map(
          ({ conversationId, expectedMessageId }) => ({
            conversationId,
            expectedMessageId,
          }),
        ),
        unansweredOnly: selection.unansweredOnly,
      };
      const next = await api<CourseReplyResult[]>(
        "/conversations/course-replies",
        "POST",
        request,
      );
      onResult(next);
      if (next.some((result) => result.status === "SKIPPED")) setResults(next);
      else onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo preparar el envío.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      className="course-reply-dialog"
      ref={dialog}
      aria-labelledby="course-reply-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!sending.current) onClose();
      }}
    >
      <header>
        <h2 id="course-reply-title">
          {results ? "Resultado del envío" : "Enviar presentación de un curso"}
        </h2>
        <p className="muted">{selection.label}</p>
      </header>
      {results ? (
        <div role="status" className="course-reply-result">
          {summary && <p>{summary}</p>}
          <p>
            {skipped.length === 1
              ? "1 chat quedó sin enviar."
              : `${skipped.length} chats quedaron sin enviar.`}
          </p>
          {skipped.length > 0 && (
            <ul>
              {skipped.map((result) => (
                <li key={result.conversationId}>
                  <strong>
                    {
                      selection.targets.find(
                        (target) =>
                          target.conversationId === result.conversationId,
                      )?.label
                    }
                  </strong>
                  <span>{result.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <input
            ref={searchInput}
            type="search"
            aria-label="Buscar curso"
            placeholder="Buscar curso"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <fieldset className="course-reply-options" aria-label="Cursos">
            {visible.map((product) => (
              <label key={product.id} className="course-reply-option">
                <input
                  type="radio"
                  name="course-reply-product"
                  value={product.id}
                  checked={product.id === chosenId}
                  disabled={busy || !product.agentEnabled}
                  onChange={() => setChosenId(product.id)}
                />
                <span>
                  {product.name}
                  {!product.agentEnabled && <small>Agente desactivado</small>}
                </span>
              </label>
            ))}
            {!visible.length && (
              <p className="muted">
                {search
                  ? "No encontramos cursos con ese nombre."
                  : "Todavía no hay cursos activos."}
              </p>
            )}
          </fieldset>
          <p className="course-reply-note">
            {chosen && <strong>{chosen.name}. </strong>}
            Se enviará la bienvenida con los seguimientos e imágenes
            configurados y el agente retomará el chat.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <footer>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          {results ? "Cerrar" : "Cancelar"}
        </button>
        {!results && (
          <button
            type="button"
            className="primary"
            onClick={() => void send()}
            disabled={busy || !chosen}
          >
            {busy ? "Preparando envío…" : "Enviar y reactivar"}
          </button>
        )}
      </footer>
    </dialog>
  );
}
