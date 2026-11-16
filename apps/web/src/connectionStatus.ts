export type LiveConnectionStatus = {
  status: string;
  phone?: string | null;
  checkedAt: string;
};

export const connectionStatusNames: Record<string, string> = {
  CONNECTED: "Conectado",
  READY: "Conectado",
  CREATED: "Sin vincular",
  INITIALIZING: "Iniciando",
  STARTING: "Iniciando",
  AUTHENTICATING: "Vinculando",
  AUTHENTICATED: "Vinculando",
  QR_READY: "Esperando QR",
  DISCONNECTED: "Desconectado",
  ACTION_REQUIRED: "Necesita atención",
  FAILED: "Error de conexión",
  UNAVAILABLE: "No se puede comprobar",
  CHECKING: "Comprobando",
};

export function connectionStatusName(status: string) {
  return connectionStatusNames[status] || "Estado desconocido";
}

export function connectionStatusDetail(status: string) {
  switch (status) {
    case "CONNECTED":
    case "READY":
      return "Puede recibir y responder mensajes.";
    case "INITIALIZING":
    case "STARTING":
    case "AUTHENTICATING":
    case "AUTHENTICATED":
      return "OpenWA está recuperando la conexión. Esperá un momento.";
    case "QR_READY":
      return "Está esperando que vincules un teléfono con el QR.";
    case "UNAVAILABLE":
      return "No se pudo consultar OpenWA. Revisá si el servicio está encendido.";
    case "CHECKING":
      return "Consultando el estado actual de OpenWA.";
    case "ACTION_REQUIRED":
      return "Revisá la sesión en OpenWA antes de continuar.";
    case "FAILED":
      return "La sesión tuvo un error. Intentá actualizar el estado.";
    default:
      return "Este WhatsApp no recibe mensajes ahora. Podés consultar el estado o mostrar el QR.";
  }
}

export function isConnectionActive(status: string) {
  return status === "CONNECTED" || status === "READY";
}

export function canStopConnection(status: string) {
  return [
    "CONNECTED",
    "READY",
    "INITIALIZING",
    "STARTING",
    "AUTHENTICATING",
    "AUTHENTICATED",
    "QR_READY",
    "ACTION_REQUIRED",
  ].includes(status);
}
