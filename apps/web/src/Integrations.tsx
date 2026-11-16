import { useIntegrations } from "./features/integrations/useIntegrations";
import { IntegrationSettingsForm } from "./features/integrations/IntegrationSettingsForm";
import { WhatsAppConnections } from "./features/integrations/WhatsAppConnections";
import type { ConnectionStatuses } from "./hooks/useConnectionStatuses";

export function Integrations({ embedded = false, connectionStatuses }: { embedded?: boolean; connectionStatuses: ConnectionStatuses }) {
  const controller = useIntegrations(connectionStatuses);
  const { config, busy, error, notice, run, refresh } = controller;
  if (!config)
    return <div role="status">{error || "Cargando integraciones…"}</div>;
  return (
    <div className={`integrations${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <div className="page-heading">
          <div>
            <div className="eyebrow">CONEXIÓN REAL</div>
            <h1>API e integraciones</h1>
            <p>
              Credenciales privadas de este negocio, WhatsApp y Responses API.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(refresh)}
          >
            Actualizar estado
          </button>
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="info-banner" role="status">
          {notice}
        </div>
      )}
      {config.forceSimulation && (
        <div className="info-banner">
          Estás en modo de prueba. Abrí Nexo con “Iniciar Nexo y WhatsApp”
          para usar las conexiones reales.
        </div>
      )}
      <div className="two-columns">
        <IntegrationSettingsForm {...controller} />
        <WhatsAppConnections {...controller} />
      </div>
    </div>
  );
}
