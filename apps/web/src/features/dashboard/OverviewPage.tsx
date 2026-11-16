import { ArrowRightUpIcon as ArrowUpRight } from "@solar-icons/react/linear/arrow-right-up";
import { ArrowRightIcon as ArrowRight } from "@solar-icons/react/linear/arrow-right";
import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { CardIcon as CreditCard } from "@solar-icons/react/linear/card";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";
import { PauseIcon as Pause } from "@solar-icons/react/linear/pause";
import { StarsIcon as Sparkles } from "@solar-icons/react/linear/stars";
import { formatMoney } from "../../api";
import { stateNames } from "./viewHelpers";
import { Empty } from "./viewHelpers";
import { Stat } from "./viewHelpers";
import { ConversationTable } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";

export function OverviewPage({
  page,
  setPage,
  overview,
  products,
  conversations,
  setSelected,
  openChat,
  realConversations,
}: Pick<
  DashboardState,
  | "page"
  | "setPage"
  | "overview"
  | "products"
  | "conversations"
  | "setSelected"
  | "openChat"
  | "realConversations"
>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TU NEGOCIO, EN UN VISTAZO</div>
          <h1>Resumen de tu negocio</h1>
        </div>
        <button
          className="primary"
          onClick={() => {
            setPage("inbox");
            setSelected(null);
          }}
        >
          <MessageCircle size={16} /> Ver conversaciones
        </button>
      </div>
      <div className="stats">
        <Stat
          icon={MessageCircle}
          label="Conversaciones"
          value={overview?.conversations ?? "—"}
          note="Conversaciones recibidas"
        />
        <Stat
          icon={CreditCard}
          label="Ventas aprobadas"
          value={overview?.sales ?? "—"}
          note="Confirmadas por tu equipo"
        />
        <Stat
          icon={ArrowUpRight}
          label="Ingresos confirmados"
          value={
            Object.entries(overview?.revenue || {})
              .map(([c, v]) => formatMoney(v as number, c))
              .join(" · ") || "$ 0"
          }
          note="Importes con aprobación manual"
        />
        <Stat
          icon={Pause}
          label="Pagos por revisar"
          value={overview?.pending ?? "—"}
          note="Requieren tu aprobación"
          accent
        />
      </div>
      <div className="overview-grid">
        <section className="card activity-card">
          <div className="section-title">
            <div>
              <h2>Tu actividad comercial</h2>
              <p>Estado actual de las conversaciones</p>
            </div>
            <span className="subtle-tag">En vivo</span>
          </div>
          <div className="funnel">
            {[
              "DISCOVERY",
              "QUALIFIED",
              "AWAITING_PAYMENT",
              "REVIEW",
              "WON",
            ].map((s, i) => {
              const n = realConversations.filter((c) => c.state === s).length;
              return (
                <div key={s}>
                  <div className="bar-count">{n}</div>
                  <div className="bar-track">
                    <div
                      className={`bar bar-${i}`}
                      style={{
                        height: Math.max(
                          n ? 12 : 0,
                          (n /
                            Math.max(
                              1,
                              ...[
                                "DISCOVERY",
                                "QUALIFIED",
                                "AWAITING_PAYMENT",
                                "REVIEW",
                                "WON",
                              ].map(
                                (st) =>
                                  realConversations.filter(
                                    (c) => c.state === st,
                                  ).length,
                              ),
                            )) *
                            130,
                        ),
                      }}
                    />
                  </div>
                  <small>{stateNames[s]}</small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="agent-card">
          <div className="agent-orb">
            <Sparkles size={30} />
          </div>
          <span className="subtle-tag light">TU AGENTE</span>
          <h2>Productos y respuestas</h2>
          <div className="agent-facts">
            <span>
              <Check size={15} /> {products.length} productos en el catálogo
            </span>
            <span>
              <Check size={15} />{" "}
              {products.reduce((n, p) => n + p.rules.length, 0)} respuestas
              configuradas
            </span>
          </div>
          <button onClick={() => setPage("products")}>
            Configurar mi agente <ArrowRight size={17} />
          </button>
        </section>
      </div>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Conversaciones recientes</h2>
            <p>Retomá donde lo dejaste.</p>
          </div>
          <button className="text-button" onClick={() => setPage("inbox")}>
            Ver todas <ArrowRight size={15} />
          </button>
        </div>
        {realConversations.length ? (
          <ConversationTable
            conversations={realConversations.slice(0, 5)}
            onOpen={openChat}
          />
        ) : (
          <Empty title="Tu primera conversación empieza acá">
            Escribí desde otro teléfono al número de WhatsApp conectado.
          </Empty>
        )}
      </section>
    </>
  );
}
