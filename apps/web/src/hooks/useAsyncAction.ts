import { useEffect, useRef, useState } from "react";

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => { current.active = false; };
  }, []);
  async function run(
    task: () => Promise<unknown>,
    options: { onStart?: () => void; onSuccess?: () => unknown | Promise<unknown> } = {},
  ) {
    const current = lifetime.current;
    if (!current.active) return;
    setBusy(true);
    setError("");
    try {
      options.onStart?.();
      await task();
      if (current.active) await options.onSuccess?.();
    } catch (cause) {
      if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo completar la acción.");
    } finally {
      if (current.active) setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
