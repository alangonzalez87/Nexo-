let token = sessionStorage.getItem("nexo-token") || "";
let workspace = sessionStorage.getItem("nexo-workspace") || "";
let revision = 0;
let controller = new AbortController();
let sessionNotice = "";
const listeners = new Set<() => void>();
function changed() {
  revision++;
  controller.abort();
  controller = new AbortController();
  listeners.forEach((listener) => listener());
}
function assertCurrent(version: number) {
  if (version !== revision) throw new Error("La sesión o el negocio cambió.");
}
function expireSession(version: number, status: number) {
  assertCurrent(version);
  if (status === 401 && token) {
    token = "";
    workspace = "";
    sessionStorage.removeItem("nexo-token");
    sessionStorage.removeItem("nexo-workspace");
    sessionNotice = "Tu sesión venció. Volvé a iniciar sesión para continuar.";
    changed();
  }
}
export const credentials = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => revision,
  get notice() {
    return sessionNotice;
  },
  get token() {
    return token;
  },
  get workspace() {
    return workspace;
  },
  setToken(value: string) {
    if (token === value) return;
    token = value;
    workspace = "";
    sessionStorage.removeItem("nexo-workspace");
    sessionNotice = "";
    sessionStorage.setItem("nexo-token", value);
    changed();
  },
  setWorkspace(value: string) {
    if (workspace === value) return;
    workspace = value;
    sessionStorage.setItem("nexo-workspace", value);
    changed();
  },
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const form = body instanceof FormData;
  const version = revision;
  const response = await fetch(`/api${path}`, {
    signal: signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-workspace-id": workspace,
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  assertCurrent(version);
  if (path !== "/auth/login") expireSession(version, response.status);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo completar la solicitud.");
  }
  const data = await response.json();
  assertCurrent(version);
  return data;
}
export async function assetBlob(id: string, signal?: AbortSignal) {
  const version = revision;
  const response = await fetch(`/api/assets/${id}`, {
    signal: signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal,
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": workspace },
  });
  expireSession(version, response.status);
  if (!response.ok) throw new Error("No se pudo descargar el archivo.");
  const blob = await response.blob();
  assertCurrent(version);
  return blob;
}
export async function download(id: string, name = "archivo") {
  const blob = await assetBlob(id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export { formatMoney } from "../../../packages/shared/src/product.js";
