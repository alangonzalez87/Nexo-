import { DownloadMinimalisticIcon as Download } from "@solar-icons/react/linear/download-minimalistic";
import { download, formatMoney } from "../../api";
import { PaymentActions } from "../payments/PaymentActions";
import { Badge, contactTitle, Empty } from "./viewHelpers";
import type { DashboardState } from "./useDashboard";
export function PaymentsPage({
  products,
  busy,
  action,
  payments,
}: Pick<DashboardState, "products" | "busy" | "action" | "payments">) {
  const pending = payments?.filter(
    (payment) => payment.status === "PENDING",
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONTROL HUMANO, SIEMPRE</div>
          <h1>Pagos y comprobantes</h1>
          <p>Comprobantes y aprobaciones de tus productos.</p>
        </div>
        {pending !== undefined && (
          <span className="badge review">{pending} por revisar</span>
        )}
      </div>
      <section className="card">
        {payments === null ? (
          <p className="muted padded" role="status">
            Cargando comprobantes…
          </p>
        ) : payments.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente / producto</th>
                  <th>Recibido</th>
                  <th>Importe cotizado</th>
                  <th>Estado</th>
                  <th>Comprobante</th>
                  <th>Revisión</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{contactTitle(p.conversation)}</strong>
                      <small>
                        {p.conversation.product?.name ||
                          "Producto sin identificar"}
                        {p.packName && ` · Pack ${p.packNumber}: ${p.packName}`}
                      </small>
                      <small>
                        {p.connectionName}
                        {p.historicalConnection && " · WhatsApp histórico"}
                      </small>
                    </td>
                    <td>
                      <time dateTime={p.createdAt}>
                        {new Date(p.createdAt).toLocaleDateString("es-AR")}
                      </time>
                    </td>
                    <td>
                      {p.amountCents !== null
                        ? formatMoney(p.amountCents, p.currency ?? undefined)
                        : "Sin cotización"}
                    </td>
                    <td>
                      <Badge value={p.status} />
                      {p.conversation.humanControlled && (
                        <small>Atendida por vos · agente en silencio</small>
                      )}
                      {p.deliveryMode === "ALREADY_DELIVERED" && (
                        <small>Entregado manualmente · sin reenvío</small>
                      )}
                      {p.receiptCheckSummary && (
                        <small>{p.receiptCheckSummary}</small>
                      )}
                      {p.reviewedBy === "auto:receipt" && (
                        <small>
                          Entrega automática según comprobante; acreditación
                          bancaria no verificada.
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          action(() => download(p.assetId, "comprobante"), "")
                        }
                      >
                        <Download size={15} /> Descargar
                      </button>
                    </td>
                    <td>
                      {p.status === "PENDING" ? (
                        <PaymentActions
                          payment={p}
                          products={products}
                          busy={busy}
                          run={action}
                        />
                      ) : (
                        <small>
                          {p.reviewedAt && (
                            <>
                              {new Date(p.reviewedAt).toLocaleString("es-AR")}
                              <br />
                            </>
                          )}
                          {p.reason}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Todavía no hay comprobantes">
            Los comprobantes que recibas aparecerán acá.
          </Empty>
        )}
      </section>
    </>
  );
}
