import type { SalesService } from "./sales.js";
import type { WebhookService } from "./webhooks.js";

type WorkerServices = {
  listWorkspaces: () => Promise<{ id: string }[]>;
  webhooks: Pick<WebhookService, "process">;
  sales: Pick<SalesService, "verifyPendingReceipts" | "queueDueRemarketing" | "dispatchBatch">;
};

/** One cycle at a time; stop waits for the active cycle before closing its dependencies. */
export function startWorker(
  services: WorkerServices,
  options: {
    intervalMs: number;
    onError: (workspaceId?: string) => void;
    paymentAutomationEnabled?: boolean;
  },
) {
  let pending: Promise<void> | undefined;
  let stopped = false;
  async function processWorkspaces() {
    try {
      for (const workspace of await services.listWorkspaces()) {
        try {
          await services.webhooks.process(workspace.id);
          if (options.paymentAutomationEnabled !== false) {
            await services.sales.verifyPendingReceipts(workspace.id);
            await services.sales.queueDueRemarketing(workspace.id);
          }
          await services.sales.dispatchBatch(workspace.id);
        } catch {
          options.onError(workspace.id);
        }
      }
    } catch {
      options.onError();
    }
  }
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = processWorkspaces().finally(() => { pending = undefined; });
  }, options.intervalMs);
  return async function stop() {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
