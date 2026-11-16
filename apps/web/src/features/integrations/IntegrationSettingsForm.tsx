import { api } from "../../api";
import type { IntegrationsController } from "./useIntegrations";

export function IntegrationSettingsForm({
  config,
  busy,
  checks,
  run,
  refresh,
  setChecks,
  setNotice,
}: Pick<
  IntegrationsController,
  "config" | "busy" | "checks" | "run" | "refresh" | "setChecks" | "setNotice"
>) {
  return (
    <form
      className="card form-card"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        void run(async () => {
          const data: any = {
            openwaEnabled: f.get("openwaEnabled") === "on",
            openwaUrl: f.get("openwaUrl"),
            publicUrl: f.get("publicUrl"),
            aiProvider: f.get("aiProvider"),
            openaiModel: f.get("openaiModel"),
            automaticOwnMessages: String(f.get("automaticOwnMessages") || "")
              .split(/\r?\n/)
              .map((text) => text.trim())
              .filter(Boolean),
          };
          for (const key of ["openwaKey", "openaiKey"])
            if (f.get(key)) data[key] = f.get(key);
          await api("/integrations/config", "PUT", data);
          setChecks({});
          for (const key of ["openwaKey", "openaiKey"])
            (form.elements.namedItem(key) as HTMLInputElement).value = "";
          await refresh();
          setNotice("Conexiones guardadas.");
        });
      }}
    >
      <h2>Respuestas con IA</h2>
      <label>
        Motor de respuestas
        <select name="aiProvider" defaultValue={config.aiProvider}>
          <option value="rules">Respuestas configuradas</option>
          <option value="openai">OpenAI</option>
        </select>
      </label>
      <label>
        Clave de OpenAI · {config.hasOpenaiKey ? "guardada" : "sin configurar"}
        <input
          name="openaiKey"
          type="password"
          autoComplete="new-password"
          placeholder="Dejá vacío para conservar la clave actual"
        />
      </label>
      <details className="settings-details">
        <summary>Configuración técnica</summary>
        <p className="muted">
          Modificá estos datos sólo si cambiás el servicio de WhatsApp o la
          dirección de Nexo.
        </p>
        <label>
          Dirección de OpenWA
          <input
            name="openwaUrl"
            type="url"
            required
            defaultValue={config.openwaUrl}
          />
        </label>
        <label>
          Clave de OpenWA ·{" "}
          {config.hasOpenwaKey ? "guardada" : "sin configurar"}
          <input
            name="openwaKey"
            type="password"
            autoComplete="new-password"
            placeholder="Dejá vacío para conservar la clave actual"
          />
        </label>
        <label className="integration-check">
          <input
            type="checkbox"
            name="openwaEnabled"
            defaultChecked={config.openwaEnabled}
          />{" "}
          Activar WhatsApp real
        </label>
        <label>
          Saludos automáticos de WhatsApp o anuncios
          <textarea
            name="automaticOwnMessages"
            rows={3}
            defaultValue={(config.automaticOwnMessages || []).join("\n")}
            placeholder="Un mensaje completo por línea"
          />
          <small>
            Estos textos exactos no pausarán al agente. Agregá sólo mensajes
            automáticos: si escribís el mismo texto manualmente, tampoco
            activará la pausa.
          </small>
        </label>
        <label>
          Dirección de Nexo
          <input
            name="publicUrl"
            type="url"
            required
            defaultValue={config.publicUrl}
          />
        </label>
        <label>
          Modelo de OpenAI
          <input
            name="openaiModel"
            required
            defaultValue={config.openaiModel}
          />
        </label>
      </details>
      <button className="primary" disabled={busy}>
        Guardar conexiones
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy || config.aiProvider !== "openai"}
        onClick={() =>
          run(async () => {
            const r = await api("/integrations/test-openai", "POST");
            setChecks((v) => ({ ...v, openai: r }));
          })
        }
      >
        Probar OpenAI
      </button>
      {checks.openai && (
        <p role="status">
          {checks.openai.ok ? "Conexión verificada" : "Prueba fallida"} ·{" "}
          {checks.openai.detail} ·{" "}
          {new Date(checks.openai.checkedAt).toLocaleTimeString()}
        </p>
      )}
      <details className="settings-details">
        <summary>Probar lectura de comprobante</summary>
        <p className="muted">
          Esta prueba lee un archivo sin aprobar pagos ni entregar cursos.
        </p>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          disabled={busy || config.aiProvider !== "openai"}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            void run(async () => {
              const form = new FormData();
              form.append("file", file);
              const result = await api<any>(
                "/integrations/test-receipt",
                "POST",
                form,
              );
              setChecks((value) => ({ ...value, receipt: result }));
            });
          }}
        />
        {checks.receipt && (
          <p role="status">
            {checks.receipt.ok
              ? `Lectura: ${checks.receipt.fields.isTransferReceipt ? "comprobante" : "otro archivo"} · ${checks.receipt.fields.status} · ${checks.receipt.fields.amount ?? "importe no visible"} ${checks.receipt.fields.currency || ""} · alias ${checks.receipt.fields.recipientAlias || "no visible"} · ID ${checks.receipt.fields.transactionId || "no visible"}`
              : checks.receipt.detail}
          </p>
        )}
      </details>
    </form>
  );
}
