import { useRef, useState } from "react";
import { api } from "../../api";
import { ResponseImage } from "../../components/ResponseImage";
import type { Run } from "../../types";

export function HumanComposer({
  conversationId,
  busy,
  run,
  refresh,
}: {
  conversationId: string;
  busy: boolean;
  run: Run;
  refresh: () => Promise<void>;
}) {
  const [imageId, setImageId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const text = String(new FormData(form).get("text") || "").trim();
        void run(async () => {
          if (!text && !imageId)
            throw new Error("Escribí un mensaje o agregá una imagen.");
          await api(`/conversations/${conversationId}/human`, "POST", {
            ...(text ? { text } : {}),
            ...(imageId ? { imageId } : {}),
          });
          await refresh();
          form.reset();
          setImageId(null);
        }, "Respuesta registrada; agente pausado");
      }}
    >
      {imageId && (
        <div className="compose-attachment">
          <ResponseImage id={imageId} alt="Imagen adjunta" />
          <span>Imagen adjunta</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Quitar imagen adjunta"
            disabled={busy}
            onClick={() => setImageId(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="human-compose">
        <input
          ref={fileInput}
          className="compose-file-input"
          type="file"
          accept="image/png,image/jpeg"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > 8 * 1024 * 1024)
                throw new Error("La imagen puede pesar hasta 8 MB.");
              const form = new FormData();
              form.append("file", file);
              const image = await api<{ id: string }>("/images", "POST", form);
              setImageId(image.id);
            }, "Imagen cargada");
          }}
        />
        <button
          type="button"
          className="compose-attach"
          aria-label="Adjuntar imagen"
          title="Adjuntar imagen (PNG o JPG, hasta 8 MB)"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21 11-8.5 8.5a5.3 5.3 0 0 1-7.5-7.5L14 3a3.5 3.5 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-2.5-2.5L16 6" />
          </svg>
        </button>
        <input
          name="text"
          placeholder="Responder como administrador…"
          required={!imageId}
          maxLength={4000}
        />
        <button className="primary" disabled={busy}>
          Enviar
        </button>
      </div>
    </form>
  );
}
