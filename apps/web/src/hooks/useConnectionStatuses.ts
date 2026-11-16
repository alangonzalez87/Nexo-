import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../api";
import { createConnectionStatusMonitor } from "../connectionStatusMonitor";

export function useConnectionStatuses(enabled: boolean, sessionKey: string) {
  const monitor = useMemo(() => createConnectionStatusMonitor(
    (signal) => api("/connections/live-status", "GET", undefined, signal),
  ), [enabled, sessionKey]);
  const snapshot = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  useEffect(() => {
    if (enabled) monitor.start();
    return monitor.stop;
  }, [enabled, monitor]);
  return { ...snapshot, refreshLiveStatuses: monitor.refresh, setLiveStatuses: monitor.setLiveStatuses };
}

export type ConnectionStatuses = ReturnType<typeof useConnectionStatuses>;
