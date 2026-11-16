import { useEffect, useState } from "react";
import { ChatRoundCallIcon as WhatsAppIcon } from "@solar-icons/react/linear/chat-round-call";
import { AddIcon as Plus } from "@solar-icons/react/linear/add";
import { MagnifierIcon as Search } from "@solar-icons/react/linear/magnifier";
import { SettingsIcon as Settings } from "@solar-icons/react/linear/settings";
import { UsersGroupRoundedIcon as Users } from "@solar-icons/react/linear/users-group-rounded";
import { UserPlusRoundedIcon as UserPlus } from "@solar-icons/react/linear/user-plus-rounded";
import { ShopIcon as Shop } from "@solar-icons/react/linear/shop";
import { RocketIcon as Rocket } from "@solar-icons/react/linear/rocket";
import { LetterIcon as Letter } from "@solar-icons/react/linear/letter";
import { LockKeyholeIcon as Lock } from "@solar-icons/react/linear/lock-keyhole";
import { EyeIcon as Eye } from "@solar-icons/react/linear/eye";
import { EyeClosedIcon as EyeClosed } from "@solar-icons/react/linear/eye-closed";
import { api } from "../../api";

export function AccountAdmin({ onCreated }: { onCreated: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const load = async () => {
    setAccounts(await api<any[]>("/admin/accounts"));
    setLoaded(true);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cuentas</h1>
          <p>Gestioná los espacios de trabajo de tu negocio.</p>
        </div>
      </div>
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
      <div className="accounts-summary card">
        <span className="accounts-icon">
          <Users size={25} />
        </span>
        <div>
          <span>Cuentas creadas</span>
          <strong>
            {loaded ? String(accounts.length).padStart(2, "0") : "—"}
          </strong>
          <small>personas con su propio acceso</small>
        </div>
      </div>
      <div className="accounts-layout">
        <form
          className="card form-card accounts-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const created = await api<{ whatsappPrepared: boolean }>(
                "/admin/accounts",
                "POST",
                data,
              );
              form.reset();
              setNotice(
                created.whatsappPrepared
                  ? "Cuenta creada y WhatsApp preparado. Compartí el correo y la contraseña de forma privada."
                  : "Cuenta creada. WhatsApp no pudo prepararse todavía; podés reintentarlo desde Configuración.",
              );
              await Promise.all([load(), onCreated()]);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="accounts-card-heading">
            <span className="accounts-icon">
              <UserPlus size={24} />
            </span>
            <div>
              <h2>Crear nueva cuenta</h2>
              <p>
                La persona podrá configurar sus productos y WhatsApp en su
                propio espacio. Vos también podrás acceder desde el selector de
                negocios.
              </p>
            </div>
          </div>
          <label>
            Nombre del negocio
            <span className="accounts-input">
              <Shop size={19} />
              <input
                name="name"
                placeholder="Ej. Tienda Central"
                required
                minLength={2}
                maxLength={100}
              />
            </span>
          </label>
          <label>
            Correo de acceso
            <span className="accounts-input">
              <Letter size={19} />
              <input
                name="email"
                type="email"
                placeholder="nombre@mi-negocio.com"
                required
                maxLength={254}
                autoComplete="off"
              />
            </span>
          </label>
          <label>
            Contraseña inicial
            <span className="accounts-input">
              <Lock size={19} />
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 12 caracteres"
                required
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="accounts-eye"
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeClosed size={19} /> : <Eye size={19} />}
              </button>
            </span>
            <small>Al menos 12 caracteres.</small>
          </label>
          <button className="primary" disabled={busy}>
            <Plus size={17} /> Crear cuenta
          </button>
        </form>
        <section className="card accounts-guide">
          <div className="accounts-card-heading">
            <span className="accounts-icon">
              <Settings size={24} />
            </span>
            <div>
              <h2>Configuración inicial</h2>
              <p>Después de crear la cuenta, la persona podrá:</p>
            </div>
          </div>
          <ol className="accounts-steps">
            <li>
              <span>1</span>
              <span className="accounts-icon">
                <Shop size={24} />
              </span>
              <div>
                <strong>Configurar su negocio</strong>
                <p>Completar la información y los productos.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <span className="accounts-icon">
                <WhatsAppIcon size={24} />
              </span>
              <div>
                <strong>Conectar WhatsApp</strong>
                <p>Vincular su número y configurar las respuestas.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <span className="accounts-icon">
                <Rocket size={24} />
              </span>
              <div>
                <strong>Empezar a conversar</strong>
                <p>Atender a sus clientes desde su espacio.</p>
              </div>
            </li>
          </ol>
        </section>
      </div>
      <section className="card accounts-list">
        <div className="accounts-list-header">
          <div className="accounts-card-heading">
            <span className="accounts-icon">
              <Users size={22} />
            </span>
            <div>
              <h2>Cuentas creadas</h2>
              <p>Espacios de trabajo de tu negocio.</p>
            </div>
          </div>
          <label className="accounts-search">
            <Search size={18} />
            <input
              aria-label="Buscar cuentas"
              placeholder="Buscar cuentas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {!loaded ? (
          <p>
            {error ? "No se pudieron cargar las cuentas." : "Cargando cuentas…"}
          </p>
        ) : accounts.length ? (
          <div className="accounts-table-wrap">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Nombre del negocio</th>
                  <th>Correo de acceso</th>
                </tr>
              </thead>
              <tbody>
                {accounts
                  .filter((account) =>
                    `${account.email} ${account.memberships.map((m: any) => m.workspace.name).join(" ")}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((account) => (
                    <tr key={account.id}>
                      <td>
                        {account.memberships
                          .map((m: any) => m.workspace.name)
                          .join(", ") || "Sin negocio"}
                      </td>
                      <td>{account.email}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!accounts.some((account) =>
              `${account.email} ${account.memberships.map((m: any) => m.workspace.name).join(" ")}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ) && <p>No encontramos cuentas con esa búsqueda.</p>}
          </div>
        ) : (
          <p>Todavía no hay otras cuentas.</p>
        )}
      </section>
    </>
  );
}
