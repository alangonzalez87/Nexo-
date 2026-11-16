import { useEffect, useState, useSyncExternalStore } from "react";
import { api, assetBlob, credentials } from "../api";
import type { Run } from "../types";

export function ResponseImage({
  id,
  alt = "Imagen de la respuesta",
}: {
  id: string;
  alt?: string;
}) {
  const revision = useSyncExternalStore(
    credentials.subscribe,
    credentials.getSnapshot,
  );
  const [preview, setPreview] = useState<{ key: string; url: string }>();
  const [error, setError] = useState("");
  const key = `${revision}:${id}`;
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    setError("");
    assetBlob(id, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ key, url });
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("No se pudo cargar la imagen.");
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, key]);
  return preview?.key === key ? (
    <img className="response-image" src={preview.url} alt={alt} />
  ) : (
    <small role="status">{error || "Cargando imagen…"}</small>
  );
}

export function ImagePicker({
  value,
  onChange,
  busy,
  run,
  label = "Imagen de la respuesta",
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
  busy: boolean;
  run: Run;
  label?: string;
}) {
  return (
    <div className="response-image-picker">
      {value && <ResponseImage id={value} alt={label} />}
      <label>
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
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
              onChange(image.id);
            }, "Imagen cargada");
          }}
        />
      </label>
      <small className="field-help">PNG o JPG, hasta 8 MB.</small>
      {value && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => onChange(null)}
        >
          Quitar imagen
        </button>
      )}
    </div>
  );
}
