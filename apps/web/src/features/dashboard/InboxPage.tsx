import { CheckReadIcon as CheckCheck } from "@solar-icons/react/linear/check-read";
import { DownloadMinimalisticIcon as Download } from "@solar-icons/react/linear/download-minimalistic";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";
import { PauseIcon as Pause } from "@solar-icons/react/linear/pause";
import { PlayIcon as Play } from "@solar-icons/react/linear/play";
import { MagnifierIcon as Search } from "@solar-icons/react/linear/magnifier";
import { HumanComposer } from "./HumanComposer";
import { ResponseImage } from "../../components/ResponseImage";
import { api, download } from "../../api";
import { connectionStatusName } from "../../connectionStatus";
import { contactTitle } from "./viewHelpers";
import { Badge } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";
export function InboxPage({
  page,
  conversations,
  channelFilter,
  setChannelFilter,
  busy,
  selected,
  setSelected,
  search,
  setSearch,
  action,
  openChat,
  openwaConnections,
  statusFor,
  activeConnectionIds,
  visibleConversations,
}: Pick<
  DashboardState,
  | "page"
  | "conversations"
  | "channelFilter"
  | "setChannelFilter"
  | "busy"
  | "selected"
  | "setSelected"
  | "search"
  | "setSearch"
  | "action"
  | "openChat"
  | "openwaConnections"
  | "statusFor"
  | "activeConnectionIds"
  | "visibleConversations"
>) {
  const resumeAgent =
    !!selected?.paused &&
    selected?.state !== "REVIEW" &&
    (selected?.state !== "WON" || !!selected?.humanControlled);
  return (
    <>
      <div className="page-heading compact">
        <div>
          <h1>Conversaciones</h1>
          <p>
            Los contactos nuevos aparecen cuando te escriben por WhatsApp. Se
            actualiza cada 8 segundos.
          </p>
        </div>
      </div>
      <div className="inbox">
        <section className="conversation-list">
          <div className="list-heading">
            <h3>
              WhatsApp <span>{visibleConversations.length}</span>
            </h3>
            <label className="channel-filter">
              Ver conversaciones de
              <select
                aria-label="Filtrar por WhatsApp"
                value={channelFilter}
                onChange={(e) => {
                  setChannelFilter(e.target.value);
                  setSelected(null);
                }}
              >
                <option value="active">
                  WhatsApp activos ({activeConnectionIds.size})
                </option>
                {openwaConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ·{" "}
                    {connectionStatusName(statusFor(connection.id))}
                  </option>
                ))}
                <option value="all">Todos, incluido historial</option>
              </select>
            </label>
            <div className="search-row">
              <Search size={16} />
              <input
                value={search}
                placeholder="Buscar conversación"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {visibleConversations.map((c) => (
            <button
              className={`conversation-item ${selected?.id === c.id ? "selected" : ""}`}
              key={c.id}
              onClick={() => openChat(c.id)}
            >
              <span className="avatar">{contactTitle(c).slice(0, 2)}</span>
              <div>
                <strong>{contactTitle(c)}</strong>
                {c.contactPhone && <small>+{c.contactPhone}</small>}
                <small className="conversation-channel">
                  {openwaConnections.find(
                    (connection) => connection.id === c.connectionId,
                  )?.name || "WhatsApp anterior"}
                </small>
                <p>{c.messages[0]?.text || "Sin mensajes"}</p>
                <Badge value={c.state} />
              </div>
            </button>
          ))}
          {!visibleConversations.length && (
            <p className="muted padded">
              {search
                ? "No hay coincidencias."
                : channelFilter === "active" && !activeConnectionIds.size
                  ? "No hay WhatsApp activo. Elegí un número o «Todos, incluido historial» para ver chats anteriores."
                  : "Todavía no hay conversaciones en este canal."}
            </p>
          )}
        </section>
        <section className="chat-panel">
          {selected ? (
            <>
              <div className="chat-header">
                <span className="avatar">
                  {contactTitle(selected).slice(0, 2)}
                </span>
                <div>
                  <h3>{contactTitle(selected)}</h3>
                  <small>
                    {selected.contactPhone
                      ? `WhatsApp · +${selected.contactPhone}`
                      : "WhatsApp · número no disponible"}
                  </small>
                  <small className="conversation-channel">
                    Canal:{" "}
                    {openwaConnections.find(
                      (connection) => connection.id === selected.connectionId,
                    )?.name || "WhatsApp anterior"}
                  </small>
                  <br />
                  <small>
                    {selected.product?.name || "Producto sin identificar"}
                  </small>
                </div>
                <Badge value={selected.state} />
                {selected.humanControlled && (
                  <small role="status">
                    Atendida por vos · agente en silencio
                  </small>
                )}
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    (selected.state === "WON" && !selected.humanControlled) ||
                    (selected.state === "REVIEW" && !!selected.humanControlled)
                  }
                  title={
                    selected.state === "REVIEW"
                      ? "El agente permanece pausado durante la revisión"
                      : selected.state === "WON"
                        ? "Una nueva consulta por un curso habilitado puede iniciar otra venta; reactivar libera el control humano"
                        : undefined
                  }
                  onClick={() =>
                    action(
                      async () => {
                        await api(
                          `/conversations/${selected.id}/human`,
                          "POST",
                          { resume: resumeAgent },
                        );
                        setSelected(await api(`/conversations/${selected.id}`));
                      },
                      resumeAgent
                        ? "Agente reactivado"
                        : "Conversación atendida por vos",
                    )
                  }
                >
                  {resumeAgent ? <Play size={14} /> : <Pause size={14} />}{" "}
                  {selected.state === "WON" && !selected.humanControlled
                    ? "Venta completada"
                    : resumeAgent
                      ? "Reactivar agente"
                      : selected.humanControlled
                        ? "Atendida por vos"
                        : "Tomar control"}
                </button>
              </div>
              <div className="messages">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`bubble ${m.direction === "OUT" ? "out" : "in"}`}
                  >
                    {m.assetId && m.direction === "OUT" && (
                      <ResponseImage id={m.assetId} />
                    )}
                    {m.assetId && m.direction !== "OUT" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          action(() => download(m.assetId!, "comprobante"), "")
                        }
                      >
                        <Download size={15} /> Descargar comprobante
                      </button>
                    )}
                    <p>{m.text}</p>
                    <small>
                      {new Date(m.createdAt).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.direction === "OUT" && (
                        <>
                          {m.status === "SENT" && <CheckCheck size={13} />}
                          {m.status === "SENT"
                            ? "Aceptado por OpenWA"
                            : m.status === "PENDING"
                              ? "Pendiente"
                              : m.status === "CANCELLED"
                                ? "Cancelado · no enviado por Nexo"
                                : m.status === "NEEDS_REVIEW"
                                  ? "Envío sin confirmar · revisar WhatsApp"
                                  : "Estado desconocido · revisar envío"}
                        </>
                      )}
                    </small>
                  </div>
                ))}
              </div>
              <HumanComposer
                key={selected.id}
                conversationId={selected.id}
                busy={busy}
                run={action}
                refresh={async () => {
                  setSelected(await api(`/conversations/${selected.id}`));
                }}
              />
            </>
          ) : (
            <div className="chat-welcome">
              <div className="agent-orb">
                <MessageCircle size={35} />
              </div>
              <h2>Conversaciones de WhatsApp</h2>
              <p>
                Elegí un chat de la lista. Para probar con un contacto nuevo,
                escribí desde otro teléfono al WhatsApp vinculado.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
