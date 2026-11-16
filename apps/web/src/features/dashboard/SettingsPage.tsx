import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { api } from "../../api";
import { Integrations } from "../../Integrations";
import type { DashboardState } from "./useDashboard";

export function SettingsPage({
  page,
  workspace,
  payments,
  settings,
  connectionStatuses,
  busy,
  settingsTab,
  setSettingsTab,
  loadWorkspaces,
  action,
}: Pick<
  DashboardState,
  | "page"
  | "workspace"
  | "payments"
  | "settings"
  | "connectionStatuses"
  | "busy"
  | "settingsTab"
  | "setSettingsTab"
  | "loadWorkspaces"
  | "action"
>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TU NEGOCIO</div>
          <h1>Configuración</h1>
          <p>Administrá la información comercial y las conexiones técnicas.</p>
        </div>
      </div>
      <div className="section-switcher" role="tablist">
        <button
          className={settingsTab === "business" ? "active" : ""}
          onClick={() => setSettingsTab("business")}
        >
          Datos del negocio
        </button>
        <button
          className={settingsTab === "payments" ? "active" : ""}
          onClick={() => setSettingsTab("payments")}
        >
          Pagos y aprobación
        </button>
        <button
          className={settingsTab === "advanced" ? "active" : ""}
          onClick={() => setSettingsTab("advanced")}
        >
          Conexiones avanzadas
        </button>
      </div>
      {settingsTab === "business" ? (
        <form
          className="card form-card settings-form"
          key={workspace}
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            action(async () => {
              await api("/settings", "PUT", data);
              await loadWorkspaces();
            });
          }}
        >
          <h2>Información comercial</h2>
          <input
            type="hidden"
            name="paymentAlias"
            value={settings.paymentAlias}
          />
          <input
            type="hidden"
            name="paymentInstructions"
            value={settings.paymentInstructions}
          />
          <input
            type="hidden"
            name="approvalPhone"
            value={settings.approvalPhone || ""}
          />
          <label>
            Nombre del negocio
            <input
              name="name"
              defaultValue={settings.name}
              required
              minLength={2}
            />
          </label>
          <button className="primary" disabled={busy}>
            <Check size={17} /> Guardar configuración
          </button>
        </form>
      ) : settingsTab === "advanced" ? (
        <Integrations
          key={workspace}
          embedded
          connectionStatuses={connectionStatuses}
        />
      ) : (
        <form
          className="card form-card settings-form"
          key={workspace}
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            action(async () => {
              await api("/settings", "PUT", data);
              await loadWorkspaces();
            });
          }}
        >
          <h2>Datos de pago y aprobación</h2>
          <input type="hidden" name="name" value={settings.name} />
          <label>
            Alias de transferencia
            <input
              name="paymentAlias"
              defaultValue={settings.paymentAlias}
              placeholder="mi.negocio.ventas"
            />
          </label>
          <label>
            Titular e instrucciones de pago
            <textarea
              name="paymentInstructions"
              defaultValue={settings.paymentInstructions}
              rows={4}
            />
          </label>
          <label>
            Tu WhatsApp para recibir comprobantes
            <input
              name="approvalPhone"
              type="tel"
              defaultValue={settings.approvalPhone || ""}
              placeholder="+54 9 11 1234-5678"
              autoComplete="tel"
            />
            <small>
              Recibirás el comprobante y un mensaje con su código. Desde ese
              chat podés responder APROBAR o RECHAZAR con el código del pago.
              Escribí el número con código de país; no hace falta vincularlo con
              QR.
            </small>
          </label>
          <button className="primary" disabled={busy}>
            <Check size={17} /> Guardar configuración
          </button>
        </form>
      )}
    </>
  );
}
