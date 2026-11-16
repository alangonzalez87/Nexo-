import { ArrowRightUpIcon as ArrowUpRight } from "@solar-icons/react/linear/arrow-right-up";
import { BookIcon as BookOpen } from "@solar-icons/react/linear/book";
import { FileTextIcon as FileText } from "@solar-icons/react/linear/file-text";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { MagnifierIcon as Search } from "@solar-icons/react/linear/magnifier";
import { BoltIcon as Zap } from "@solar-icons/react/linear/bolt";
import { formatMoney } from "../../api";
import { emptyProduct } from "../products/productDefaults";
import { Empty } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";

const modes: Record<string, string> = {
  STRICT: "Estricto",
  FLEXIBLE: "Flexible",
  AUTO: "Automático",
};

export function ProductsPage({
  page,
  products,
  setEditing,
  setEditorTab,
  search,
  setSearch,
}: Pick<
  DashboardState,
  "page" | "products" | "setEditing" | "setEditorTab" | "search" | "setSearch"
>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OFERTA Y CONOCIMIENTO</div>
          <h1>Producto y agente</h1>
          <p>
            Configurá qué vendés, cómo conversa el agente y qué archivos
            utiliza.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditing({ ...emptyProduct });
            setEditorTab("general");
          }}
        >
          <Plus size={17} /> Nuevo producto
        </button>
      </div>
      <div className="search-row">
        <Search size={18} />
        <input
          placeholder="Buscar un producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{products.length} productos</span>
      </div>
      <div className="product-grid">
        {products
          .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
          .map((p, i) => (
            <section className="card product-card" key={p.id}>
              <div className={`product-art art-${i % 3}`}>
                <BookOpen size={42} />
                <span>PRODUCTO DIGITAL</span>
              </div>
              <div className="product-body">
                <div className="section-title">
                  <span
                    className={`badge ${p.agentEnabled ? "connected" : "disconnected"}`}
                  >
                    {p.agentEnabled
                      ? "Atendido por Nexo"
                      : "Atención desactivada"}
                  </span>
                  <span className="subtle-tag">{modes[p.mode]}</span>
                </div>
                <h2>{p.name}</h2>
                <p>
                  {p.firstMessage ||
                    p.description ||
                    "Agregá una descripción para tu agente."}
                </p>
                <strong className="product-price">
                  {formatMoney(p.priceCents, p.currency)}{" "}
                  <small>{p.currency}</small>
                </strong>
                <div className="product-meta">
                  <Zap size={15} />
                  {p.activationKeyword
                    ? `Se activa con: ${p.activationKeyword}`
                    : "Sin frase de activación"}
                </div>
                <div className="product-meta">
                  <FileText size={15} /> {p.documents.length} documentos
                  <span>·</span> {p.rules.length} respuestas
                </div>
                <button
                  className="secondary full"
                  onClick={() => {
                    setEditing(structuredClone(p));
                    setEditorTab("general");
                  }}
                >
                  Gestionar producto
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </section>
          ))}
      </div>
      {!products.length && (
        <Empty title="Construí tu catálogo">
          Creá un producto para empezar a configurar tu agente.
        </Empty>
      )}
    </>
  );
}
