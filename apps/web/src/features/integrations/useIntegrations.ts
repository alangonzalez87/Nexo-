import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { ConnectionStatuses } from "../../hooks/useConnectionStatuses";
import { useAsyncAction } from "../../hooks/useAsyncAction";

export function useIntegrations(connectionStatuses: ConnectionStatuses) {
  const controller = useRef(new AbortController());
  const [config, setConfig] = useState<any>(null),
    [connections, setConnections] = useState<any[]>([]);
  const [notice, setNotice] = useState("");
  const { busy, error, run: runAction } = useAsyncAction();
  const [checks, setChecks] = useState<Record<string, any>>({});
  const { liveStatuses, statusLoaded, refreshLiveStatuses, setLiveStatuses } = connectionStatuses;
  async function refresh() {
    const [c, s] = await Promise.all([
      api("/integrations/config", "GET", undefined, controller.current.signal),
      api("/connections", "GET", undefined, controller.current.signal),
    ]);
    setConfig(c);
    setConnections(s.filter((v: any) => v.provider === "OPENWA"));
    await refreshLiveStatuses();
  }
  async function run(fn: () => Promise<void>) {
    await runAction(fn, { onStart: () => setNotice("") });
  }
  async function prepareAndWaitForQr(connectionId: string) {
    const signal = controller.current.signal;
    let result = await api<any>(
      `/connections/${connectionId}/prepare-qr`,
      "POST",
      undefined,
      signal,
    );
    setChecks((value) => ({ ...value, [connectionId]: result }));
    setLiveStatuses((value) => ({ ...value, [connectionId]: { status: result.status, checkedAt: new Date().toISOString() } }));
    for (
      let attempt = 0;
      attempt < 24 &&
      !result.qr &&
      !["CONNECTED", "FAILED", "ACTION_REQUIRED"].includes(result.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      signal.throwIfAborted();
      result = await api<any>(`/connections/${connectionId}/connect`, "POST", undefined, signal);
      setChecks((value) => ({ ...value, [connectionId]: result }));
      setLiveStatuses((value) => ({ ...value, [connectionId]: { status: result.status, checkedAt: new Date().toISOString() } }));
    }
    await refresh();
    if (result.qr)
      setNotice(
        "QR listo. Escanealo desde WhatsApp → Dispositivos vinculados.",
      );
    else if (result.status === "CONNECTED")
      setNotice("WhatsApp quedó conectado correctamente.");
    else
      setNotice(
        "La sesión sigue iniciando. Esperá unos segundos y tocá “Mostrar QR” otra vez.",
      );
  }
  useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    const current = controller.current;
    void run(refresh);
    return () => current.abort();
  }, []);
  useEffect(() => {
    const qrConnectionIds = connections
      .filter((connection) => checks[connection.id]?.qr)
      .map((connection) => connection.id);
    if (!qrConnectionIds.length) return;
    let active = true;
    const timer = setInterval(() => {
      for (const connectionId of qrConnectionIds) {
        void api<any>(`/connections/${connectionId}/connect`, "POST", undefined, controller.current.signal)
          .then((result) => {
            if (!active) return;
            setChecks((current) => ({ ...current, [connectionId]: result }));
            setLiveStatuses((current) => ({
              ...current,
              [connectionId]: {
                status: result.status,
                checkedAt: new Date().toISOString(),
              },
            }));
          })
          .catch(() => {
            if (active) setChecks((current) => ({ ...current, [connectionId]: undefined }));
          });
      }
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [checks, connections]);
  return { config, connections, busy, error, notice, checks, liveStatuses, statusLoaded, refreshLiveStatuses, refresh, run, prepareAndWaitForQr, setChecks, setNotice };
}

export type IntegrationsController = ReturnType<typeof useIntegrations>;
