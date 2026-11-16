import { useState } from "react";
import { ArrowRightIcon as ArrowRight } from "@solar-icons/react/linear/arrow-right";
import { QuestionCircleIcon as CircleHelp } from "@solar-icons/react/linear/question-circle";
import { ShieldCheckIcon as ShieldCheck } from "@solar-icons/react/linear/shield-check";
import { BoltIcon as Zap } from "@solar-icons/react/linear/bolt";
import { api, credentials } from "../../api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState(credentials.notice),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Zap size={24} fill="currentColor" />
          </span>
          nexo.
        </div>
        <div>
          <span className="eyebrow">MÁS CERCA DE TU PRÓXIMA VENTA</span>
          <h1>
            Conversaciones
            <br />
            que hacen crecer
            <br />
            tu negocio<span>.</span>
          </h1>
          <p>
            Tu catálogo, tu conocimiento y tu forma de vender.
            <br />
            Un asistente que trabaja con vos.
          </p>
          <span className="login-note">
            <ShieldCheck size={18} /> Vos tenés el control de cada pago.
          </span>
        </div>
        <small>NEXO · PLATAFORMA DE VENTAS CONVERSACIONALES</small>
      </section>
      <section className="login-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = await api(
                "/auth/login",
                "POST",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
              credentials.setToken(data.token);
              onLogin();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">BIENVENIDO A TU ESPACIO</span>
          <h2>Volvamos a conectar.</h2>
          <p>Ingresá para gestionar tu negocio.</p>
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          <label>
            Correo electrónico
            <input
              name="email"
              type="email"
              placeholder="admin@nexo.local"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Tu contraseña"
            />
          </label>
          <button className="primary full" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar a mi negocio"}
            <ArrowRight size={17} />
          </button>
          <div className="login-help">
            <CircleHelp size={17} />
            <span>
              Usá las credenciales de tu archivo .env. En la demo, se muestran
              en la terminal al iniciar.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
