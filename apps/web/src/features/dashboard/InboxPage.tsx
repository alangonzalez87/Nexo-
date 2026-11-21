import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AltArrowLeftIcon as ChevronLeft } from "@solar-icons/react/linear/alt-arrow-left";
import { CheckReadIcon as CheckCheck } from "@solar-icons/react/linear/check-read";
import { DownloadMinimalisticIcon as Download } from "@solar-icons/react/linear/download-minimalistic";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";
import { PauseIcon as Pause } from "@solar-icons/react/linear/pause";
import { PlayIcon as Play } from "@solar-icons/react/linear/play";
import { MagnifierIcon as Search } from "@solar-icons/react/linear/magnifier";
import { HumanComposer } from "./HumanComposer";
import {
  CourseReplyDialog,
  courseReplySummary,
  type CourseReplySelection,
} from "./CourseReplyDialog";
import { ResponseImage } from "../../components/ResponseImage";
import { api, download } from "../../api";
import { connectionStatusName } from "../../connectionStatus";
import { Badge, contactTitle, type Conversation } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";
import {
  MAX_COURSE_REPLY_BATCH,
  type CourseReplyResult,
} from "../../../../../packages/shared/src/course-replies.js";
export function InboxPage({
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
  realConversations,
  products,
  refresh,
  setNotice,
}: Pick<
  DashboardState,
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
  | "realConversations"
  | "products"
  | "refresh"
  | "setNotice"
>) {
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [unanswered, setUnanswered] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState("");
  const [listRevision, setListRevision] = useState(0);
  const [marked, setMarked] = useState<Map<string, string>>(() => new Map());
  const [courseReply, setCourseReply] = useState<CourseReplySelection | null>(
    null,
  );

  useEffect(() => {
    if (!unansweredOnly) return;
    const controller = new AbortController();
    async function fetchUnanswered() {
      try {
        const rows = await api<Conversation[]>(
          "/conversations/unanswered?provider=OPENWA",
          "GET",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setUnanswered(rows);
          setListError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setListError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar la lista.",
          );
        }
      }
    }
    void fetchUnanswered();
    const interval = setInterval(fetchUnanswered, 8000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [unansweredOnly, listRevision]);

  const query = search.trim().toLowerCase();
  const visibleConversations = (
    unansweredOnly ? (unanswered ?? []) : realConversations
  ).filter(
    (chat) =>
      (!unansweredOnly || activeConnectionIds.has(chat.connectionId)) &&
      (channelFilter === "all" ||
        (channelFilter === "active"
          ? activeConnectionIds.has(chat.connectionId)
          : chat.connectionId === channelFilter)) &&
      `${chat.contact} ${chat.contactName || ""} ${chat.contactPhone || ""} ${chat.product?.name || ""}`
        .toLowerCase()
        .includes(query),
  );
  const markedChats = visibleConversations.filter(
    (chat) => chat.messages[0] && marked.get(chat.id) === chat.messages[0].id,
  );
  const canChooseCourse =
    selected &&
    activeConnectionIds.has(selected.connectionId) &&
    selected.state !== "REVIEW";
  const resumeAgent =
    !!selected?.paused &&
    selected?.state !== "REVIEW" &&
    (selected?.state !== "WON" || !!selected?.humanControlled);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const previousChat = useRef<string | undefined>(undefined);
  const chatId = selected?.id;
  const lastMessageId = selected?.messages.at(-1)?.id;

  function scrollToLatest() {
    const history = messagesRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }

  useLayoutEffect(() => {
    if (previousChat.current !== chatId) {
      previousChat.current = chatId;
      followLatest.current = true;
    }
    if (followLatest.current) scrollToLatest();
  }, [chatId, lastMessageId]);

  function changeView(pending: boolean) {
    if (pending === unansweredOnly) return;
    setUnansweredOnly(pending);
    setMarked(new Map());
    if (pending) {
      setUnanswered(null);
      setListError("");
    }
  }

  function onCourseReplyResult(results: CourseReplyResult[]) {
    const summary = courseReplySummary(results);
    if (summary) setNotice(summary);
    setMarked(new Map());
    setListRevision((current) => current + 1);
    const affected =
      chatId &&
      results.some(
        (result) =>
          result.conversationId === chatId && result.status !== "SKIPPED",
      );
    if (affected) {
      followLatest.current = true;
      api<Conversation>(`/conversations/${chatId}`)
        .then((chat) =>
          setSelected((current) => (current?.id === chat.id ? chat : current)),
        )
        .catch(() => {});
    }
    void refresh().catch(() => {});
  }

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
      <div className={selected ? "inbox has-selection" : "inbox"}>
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
                  setMarked(new Map());
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setMarked(new Map());
                }}
              />
            </div>
            <div
              className="inbox-views"
              role="group"
              aria-label="Filtrar por respuesta"
            >
              <button
                type="button"
                aria-pressed={!unansweredOnly}
                onClick={() => changeView(false)}
              >
                Todos
              </button>
              <button
                type="button"
                aria-pressed={unansweredOnly}
                onClick={() => changeView(true)}
              >
                Sin respuesta
              </button>
            </div>
          </div>
          {unansweredOnly && visibleConversations.length > 0 && (
            <div className="course-batch-actions">
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setMarked(
                    new Map(
                      visibleConversations
                        .slice(0, MAX_COURSE_REPLY_BATCH)
                        .map((chat) => [chat.id, chat.messages[0].id]),
                    ),
                  )
                }
              >
                {visibleConversations.length > MAX_COURSE_REPLY_BATCH
                  ? `Marcar ${MAX_COURSE_REPLY_BATCH} visibles`
                  : "Marcar visibles"}
              </button>
              {markedChats.length > 0 && (
                <>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setMarked(new Map())}
                  >
                    Desmarcar
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    aria-haspopup="dialog"
                    disabled={busy || !!listError}
                    onClick={() =>
                      setCourseReply({
                        label:
                          markedChats.length === 1
                            ? contactTitle(markedChats[0])
                            : `${markedChats.length} conversaciones`,
                        unansweredOnly: true,
                        targets: markedChats.map((chat) => ({
                          conversationId: chat.id,
                          expectedMessageId: chat.messages[0].id,
                          label: contactTitle(chat),
                        })),
                      })
                    }
                  >
                    Elegir curso para {markedChats.length}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="conversation-items">
            {visibleConversations.map((c) => (
              <div
                key={c.id}
                className={unansweredOnly ? "course-batch-chat" : undefined}
              >
                {unansweredOnly && (
                  <input
                    type="checkbox"
                    aria-label={`Marcar conversación de ${contactTitle(c)}`}
                    checked={marked.get(c.id) === c.messages[0].id}
                    disabled={
                      marked.get(c.id) !== c.messages[0].id &&
                      markedChats.length >= MAX_COURSE_REPLY_BATCH
                    }
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setMarked((current) => {
                        const next = new Map(current);
                        if (checked) next.set(c.id, c.messages[0].id);
                        else next.delete(c.id);
                        return next;
                      });
                    }}
                  />
                )}
                <button
                  type="button"
                  className={`conversation-item ${selected?.id === c.id ? "selected" : ""}`}
                  onClick={() => openChat(c.id, !unansweredOnly)}
                  aria-current={selected?.id === c.id ? "true" : undefined}
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
                    {unansweredOnly && c.product && (
                      <small>{c.product.name}</small>
                    )}
                    <p>{c.messages[0]?.text || "Sin mensajes"}</p>
                    <Badge value={c.state} />
                  </div>
                </button>
              </div>
            ))}
            {unansweredOnly && listError && (
              <div className="muted padded" role="alert">
                <p>{listError}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setListRevision((current) => current + 1)}
                >
                  Volver a cargar
                </button>
              </div>
            )}
            {!visibleConversations.length && !(unansweredOnly && listError) && (
              <p className="muted padded">
                {unansweredOnly
                  ? !unanswered
                    ? "Buscando conversaciones…"
                    : search
                      ? "No hay coincidencias."
                      : "No hay chats sin respuesta en este canal."
                  : search
                    ? "No hay coincidencias."
                    : channelFilter === "active" && !activeConnectionIds.size
                      ? "No hay WhatsApp activo. Elegí un número o «Todos, incluido historial» para ver chats anteriores."
                      : "Todavía no hay conversaciones en este canal."}
              </p>
            )}
          </div>
        </section>
        <section className="chat-panel">
          {selected ? (
            <>
              <div className="chat-header">
                <button
                  type="button"
                  className="icon-button chat-back"
                  aria-label="Volver a la lista de conversaciones"
                  onClick={() => setSelected(null)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="avatar">
                  {contactTitle(selected).slice(0, 2)}
                </span>
                <div className="chat-contact">
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
                  <small>
                    {selected.product?.name || "Producto sin identificar"}
                  </small>
                </div>
                <div className="chat-controls">
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
                      (selected.state === "REVIEW" &&
                        !!selected.humanControlled)
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
                          setSelected(
                            await api(`/conversations/${selected.id}`),
                          );
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
              </div>
              <div
                className="messages"
                ref={messagesRef}
                role="region"
                aria-label="Historial de mensajes"
                tabIndex={0}
                onScroll={(event) => {
                  const { clientHeight, scrollHeight, scrollTop } =
                    event.currentTarget;
                  followLatest.current =
                    scrollHeight - scrollTop - clientHeight <= 32;
                }}
                onLoadCapture={() => {
                  if (followLatest.current) scrollToLatest();
                }}
              >
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
                onChooseCourse={
                  canChooseCourse
                    ? () =>
                        setCourseReply({
                          label: contactTitle(selected),
                          unansweredOnly: false,
                          targets: [
                            {
                              conversationId: selected.id,
                              expectedMessageId: lastMessageId ?? null,
                              label: contactTitle(selected),
                            },
                          ],
                        })
                    : undefined
                }
                refresh={async () => {
                  followLatest.current = true;
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
      {courseReply && (
        <CourseReplyDialog
          products={products}
          selection={courseReply}
          onClose={() => setCourseReply(null)}
          onResult={onCourseReplyResult}
        />
      )}
    </>
  );
}
