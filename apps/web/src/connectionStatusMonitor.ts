import type { LiveConnectionStatus } from "./connectionStatus.js";

type StatusMap = Record<string, LiveConnectionStatus>;
type Snapshot = { liveStatuses: StatusMap; statusLoaded: boolean };

/** One monitor belongs to one mounted session; consumers share its requests and timer. */
export function createConnectionStatusMonitor(
  requestStatuses: (signal: AbortSignal) => Promise<(LiveConnectionStatus & { id: string })[]>,
  intervalMs = 20000,
) {
  let snapshot: Snapshot = { liveStatuses: {}, statusLoaded: false };
  const listeners = new Set<() => void>();
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  let revision = 0;
  function publish(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  function refresh() {
    if (!controller || controller.signal.aborted) return Promise.resolve();
    if (pending) return pending;
    const current = controller;
    const version = revision;
    const isCurrent = () => controller === current && !current.signal.aborted && version === revision;
    const request = (async () => {
      try {
        const rows = await requestStatuses(current.signal);
        if (isCurrent()) publish({
          liveStatuses: Object.fromEntries(rows.map(({ id, ...value }) => [id, value])),
          statusLoaded: true,
        });
      } catch (error) {
        if (isCurrent()) publish({ liveStatuses: {}, statusLoaded: true });
        throw error;
      }
    })().finally(() => { if (pending === request) pending = undefined; });
    pending = request;
    return request;
  }
  function stop() {
    controller?.abort();
    controller = undefined;
    clearInterval(timer);
    timer = undefined;
    pending = undefined;
    revision++;
  }
  function start() {
    if (controller) return;
    controller = new AbortController();
    publish({ liveStatuses: {}, statusLoaded: false });
    void refresh().catch(() => {});
    timer = setInterval(() => void refresh().catch(() => {}), intervalMs);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start,
    stop,
    refresh,
    setLiveStatuses(update: StatusMap | ((current: StatusMap) => StatusMap)) {
      if (!controller || controller.signal.aborted) return;
      revision++;
      publish({ ...snapshot, liveStatuses: typeof update === "function" ? update(snapshot.liveStatuses) : update });
    },
  };
}
