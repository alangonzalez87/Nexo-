import { ArrowRightIcon as ArrowRight } from "@solar-icons/react/linear/arrow-right";
import { ChatRoundCallIcon as WhatsAppIcon } from "@solar-icons/react/linear/chat-round-call";
import { PauseIcon as Pause } from "@solar-icons/react/linear/pause";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { RefreshIcon as RefreshCw } from "@solar-icons/react/linear/refresh";
import { api } from "../../api";
import {
  canStopConnection,
  connectionStatusDetail,
  connectionStatusName,
  isConnectionActive,
} from "../../connectionStatus";
import { Empty } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";

export function ConnectionsPage({
  page,
  setPage,
  connections,
  settings,
  liveStatuses,
  statusLoaded,
  refreshLiveStatuses,
  setLiveStatuses,
  busy,
  setSelected,
  setSettingsTab,
  action,
  current,
  openwaConnections,
  statusFor,
  activeConnectionIds,
}: Pick<
  DashboardState,
  | "page"
  | "setPage"
  | "connections"
  | "settings"
  | "liveStatuses"
  | "statusLoaded"
  | "refreshLiveStatuses"
  | "setLiveStatuses"
  | "busy"
  | "setSelected"
  | "setSettingsTab"
  | "action"
  | "current"
  | "openwaConnections"
  | "statusFor"
  | "activeConnectionIds"
>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CANAL DE VENTA</div>
          <h1>WhatsApp</h1>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setPage("settings");
            setSettingsTab("advanced");
          }}
        >
          Agregar WhatsApp <Plus size={16} />
        </button>
      </div>
      <div
        className={`whatsapp-summary ${activeConnectionIds.size ? "is-active" : "is-offline"}`}
        role="status"
      >
        <span className="connection-icon">
          <WhatsAppIcon size={25} />
        </span>
        <div>
          <strong>
            {!statusLoaded
              ? "Comprobando WhatsApp…"
              : activeConnectionIds.size
                ? `${activeConnectionIds.size} WhatsApp ${activeConnectionIds.size === 1 ? "activo" : "activos"}`
                : "No hay ningún WhatsApp activo"}
          </strong>
          <p>
            {!statusLoaded
              ? "Consultando OpenWA para mostrar el estado actual."
              : activeConnectionIds.size
                ? "Las conversaciones nuevas llegarán por los números conectados."
                : "Los chats anteriores siguen guardados. Revisá las sesiones de abajo para recuperarlas."}
          </p>
        </div>
      </div>
      <div className="whatsapp-grid">
        <section className="card whatsapp-card">
          <div className="section-title">
            <div>
              <h2>Tus números de WhatsApp</h2>
              <p>
                Estado comprobado con OpenWA; los chats antiguos se conservan.
              </p>
            </div>
            <span className="connection-icon">
              <WhatsAppIcon size={24} />
            </span>
          </div>
          {openwaConnections.map((c) => (
            <div className="connection-row" key={c.id}>
              <div>
                <h3>{c.name}</h3>
                <p>
                  {liveStatuses[c.id]?.phone
                    ? `Número: +${liveStatuses[c.id].phone}`
                    : "Número todavía no disponible"}
                </p>
                <span
                  className={`badge connection-status ${statusFor(c.id).toLowerCase()}`}
                >
                  {connectionStatusName(statusFor(c.id))}
                </span>
                <p className="connection-explanation">
                  {connectionStatusDetail(statusFor(c.id))}
                </p>
              </div>
              <div className="connection-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(refreshLiveStatuses, "Estado actualizado")
                  }
                >
                  <RefreshCw size={15} /> Actualizar
                </button>
                {!isConnectionActive(statusFor(c.id)) && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setPage("settings");
                      setSettingsTab("advanced");
                    }}
                  >
                    Ver QR y conexión <ArrowRight size={15} />
                  </button>
                )}
                {canStopConnection(statusFor(c.id)) && (
                  <button
                    className="secondary disconnect-button"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const result = await api<{ status: string }>(
                          `/connections/${c.id}/stop`,
                          "POST",
                        );
                        setLiveStatuses((current) => ({
                          ...current,
                          [c.id]: {
                            ...current[c.id],
                            status: result.status,
                            checkedAt: new Date().toISOString(),
                          },
                        }));
                        setSelected((current) =>
                          current?.connectionId === c.id ? null : current,
                        );
                      }, `${c.name} quedó desconectado. El número y sus chats siguen guardados.`)
                    }
                  >
                    <Pause size={15} /> Desconectar
                  </button>
                )}
              </div>
            </div>
          ))}
          {!openwaConnections.length && (
            <Empty title="WhatsApp todavía no está configurado">
              Prepará una conexión en Configuración → Conexiones avanzadas.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
