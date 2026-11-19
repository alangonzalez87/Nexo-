import { api } from "../../api";
import type { IntegrationsController } from "./useIntegrations";
import { canStopConnection, connectionStatusDetail, connectionStatusName, isConnectionActive } from "../../connectionStatus";

export function WhatsAppConnections(
  { config, connections, busy, checks, liveStatuses, statusLoaded, run, refresh, refreshLiveStatuses, prepareAndWaitForQr, setChecks, setNotice }: Pick<IntegrationsController, "config" | "connections" | "busy" | "checks" | "liveStatuses" | "statusLoaded" | "run" | "refresh" | "refreshLiveStatuses" | "prepareAndWaitForQr" | "setChecks" | "setNotice">,
) {
  return (
        <div className="integration-stack">
          {!config.managed && (
          <form
            className="card form-card"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(async () => {
                const created = await api<any>("/connections/openwa", "POST", {
                  name: f.get("name"),
                });
                form.reset();
                await refresh();
                await prepareAndWaitForQr(created.id);
              });
            }}
          >
            <h2>{config.openwaSetupMode ? "Preparar WhatsApp" : "Agregar otro WhatsApp"}</h2>
            <p className="muted">
              {config.openwaSetupMode
                ? "Se conectará una sesión nueva de Railway sin activar respuestas automáticas."
                : "Se mostrará un QR para el nuevo número."}
            </p>
            {!config.openwaEnabled && config.managedProvisionAvailable && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("/connections/managed", "POST");
                      await refresh();
                      setNotice(
                        "WhatsApp preparado. Tocá Mostrar QR en la conexión del negocio.",
                      );
                    })
                  }
                >
                  Preparar WhatsApp para este negocio
                </button>
              )}
            {!config.openwaEnabled && !config.managedProvisionAvailable && (
              <p className="muted">Activá WhatsApp real en “Configuración técnica” para agregar un número.</p>
            )}
            {config.openwaEnabled && !config.openwaSetupMode && (
              <>
            <label>
              Nombre para identificarlo
              <input
                name="name"
                required
                minLength={2}
                placeholder="WhatsApp · Curso nuevo"
              />
            </label>
            <button
              className="primary"
              disabled={busy}
            >
              Crear y mostrar QR
            </button>
              </>
            )}
          </form>
          )}
          <section className="card form-card">
            <h2>Estado de WhatsApp</h2>
            {!connections.length && (
              <p className="muted">No hay ningún WhatsApp configurado.</p>
            )}
            {connections.map((c) => {
              // A managed Railway key is scoped to one session. Imported local
              // connections stay visible for their history, but must not offer
              // controls that will inevitably fail with OpenWA 403.
              const managedSession =
                !config.managed || c.sessionId === config.managedSessionId;
              const usableInSetup =
                managedSession &&
                (!config.openwaSetupMode || config.managed);
              return (
              <div className="integration-session" key={c.id}>
                <h3>{c.name}</h3>
                {config.managed && !managedSession && (
                  <p className="muted">
                    Conexión histórica conservada. OpenWA de Railway no tiene acceso a esta sesión.
                  </p>
                )}
                <p>
                  {!managedSession ? (
                    <span className="badge connection-status">HISTÓRICA</span>
                  ) : (
                  <span className={`badge connection-status ${(statusLoaded ? liveStatuses[c.id]?.status || "UNAVAILABLE" : "CHECKING").toLowerCase()}`}>
                    {connectionStatusName(statusLoaded ? liveStatuses[c.id]?.status || "UNAVAILABLE" : "CHECKING")}
                  </span>
                  )}
                  {liveStatuses[c.id]?.phone && ` · +${liveStatuses[c.id].phone}`}
                </p>
                {managedSession && <p className="muted">{connectionStatusDetail(statusLoaded ? liveStatuses[c.id]?.status || "UNAVAILABLE" : "CHECKING")}</p>}
                <div className="integration-actions">
                  {usableInSetup && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await refreshLiveStatuses();
                        setNotice("Estado actualizado con OpenWA.");
                      })
                    }
                  >
                    Actualizar estado
                  </button>
                  )}
                  {usableInSetup && !isConnectionActive(statusLoaded ? liveStatuses[c.id]?.status || "UNAVAILABLE" : "CHECKING") && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => run(() => prepareAndWaitForQr(c.id))}
                    >
                      Mostrar QR
                    </button>
                  )}
                  {!config.openwaSetupMode && managedSession && canStopConnection(statusLoaded ? liveStatuses[c.id]?.status || "UNAVAILABLE" : "CHECKING") && (
                    <button
                      className="secondary disconnect-button"
                      disabled={busy}
                      onClick={() => run(async () => {
                        await api(`/connections/${c.id}/stop`, "POST");
                        setChecks((value) => ({ ...value, [c.id]: undefined }));
                        await refreshLiveStatuses();
                        setNotice(`${c.name} quedó desconectado. El vínculo y los chats siguen guardados.`);
                      })}
                    >
                      Desconectar
                    </button>
                  )}
                </div>
                {usableInSetup && (
                  <details className="settings-details session-tools">
                    <summary>Solucionar problemas</summary>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => run(async () => {
                        await api(`/connections/${c.id}/webhook`, "POST");
                        setNotice("Recepción reparada.");
                      })}
                    >
                      Reparar recepción
                    </button>
                  </details>
                )}
                {checks[c.id]?.qr && liveStatuses[c.id]?.status === "QR_READY" && (
                  <>
                    <img
                      className="integration-qr"
                      src={checks[c.id].qr}
                      alt="QR real de OpenWA para vincular WhatsApp"
                    />
                    <p className="muted">El QR se actualiza automáticamente mientras lo tengas abierto.</p>
                  </>
                )}
              </div>
              );
            })}
          </section>
        </div>
  );
}
