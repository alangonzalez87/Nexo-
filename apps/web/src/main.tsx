import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BellIcon as Bell } from "@solar-icons/react/linear/bell";
import { CheckIcon as Check } from "@solar-icons/react/linear/check";
import { AltArrowRightIcon as ChevronRight } from "@solar-icons/react/linear/alt-arrow-right";
import { CardIcon as CreditCard } from "@solar-icons/react/linear/card";
import { Home2Icon as LayoutDashboard } from "@solar-icons/react/linear/home-2";
import { ChatRoundCallIcon as WhatsAppIcon } from "@solar-icons/react/linear/chat-round-call";
import { Logout2Icon as LogOut } from "@solar-icons/react/linear/logout-2";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";
import { BoxMinimalisticIcon as Package } from "@solar-icons/react/linear/box-minimalistic";
import { RefreshIcon as RefreshCw } from "@solar-icons/react/linear/refresh";
import { SettingsIcon as Settings } from "@solar-icons/react/linear/settings";
import { UsersGroupRoundedIcon as Users } from "@solar-icons/react/linear/users-group-rounded";
import { CloseIcon as X } from "@solar-icons/react/linear/close";
import { BoltIcon as Zap } from "@solar-icons/react/linear/bolt";
import { credentials } from "./api";
import { ProductEditor } from "./features/products/ProductEditor";
import { AccountAdmin } from "./features/accounts/AccountAdmin";
import "./style.css";
import { Empty } from "./features/dashboard/viewHelpers";
import { OverviewPage } from "./features/dashboard/OverviewPage";
import { ProductsPage } from "./features/dashboard/ProductsPage";
import { InboxPage } from "./features/dashboard/InboxPage";
import { PaymentsPage } from "./features/dashboard/PaymentsPage";
import { ConnectionsPage } from "./features/dashboard/ConnectionsPage";
import { SettingsPage } from "./features/dashboard/SettingsPage";
import { useDashboard } from "./features/dashboard/useDashboard";
import { Login } from "./features/accounts/Login";

const nav = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "inbox", label: "Conversaciones", icon: MessageCircle },
  { id: "products", label: "Producto y agente", icon: Package },
  { id: "payments", label: "Pagos", icon: CreditCard },
  { id: "connections", label: "WhatsApp", icon: WhatsAppIcon },
  { id: "settings", label: "Configuración", icon: Settings },
];

function App() {
  const dashboard = useDashboard();
  const {
    signed,
    setSigned,
    page,
    setPage,
    workspaces,
    setWorkspaces,
    workspace,
    setWorkspace,
    profile,
    setProfile,
    overview,
    setOverview,
    products,
    setProducts,
    conversations,
    setConversations,
    connections,
    setConnections,
    channelFilter,
    setChannelFilter,
    payments,
    setPayments,
    settings,
    setSettings,
    connectionStatuses,
    liveStatuses,
    statusLoaded,
    refreshLiveStatuses,
    setLiveStatuses,
    busy,
    error,
    setError,
    runAction,
    notice,
    setNotice,
    editing,
    setEditing,
    editorTab,
    setEditorTab,
    selected,
    setSelected,
    search,
    setSearch,
    showNotifications,
    setShowNotifications,
    settingsTab,
    setSettingsTab,
    refresh,
    loadWorkspaces,
    action,
    openChat,
    current,
    realConversations,
    realPayments,
    openwaConnections,
    statusFor,
    activeConnectionIds,
    visibleConversations,
  } = dashboard;
  if (!signed) return <Login onLogin={() => setSigned(true)} />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-icon">
            <Zap fill="currentColor" size={24} />
          </span>
          nexo<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">
            {current?.name?.slice(0, 1) || "N"}
          </span>
          <div>
            <small>ESPACIO DE TRABAJO</small>
            {workspaces.length > 1 ? (
              <select
                aria-label="Negocio"
                value={workspace}
                onChange={(e) => {
                  credentials.setWorkspace(e.target.value);
                  setWorkspace(e.target.value);
                  setSelected(null);
                  action(refresh, "");
                }}
              >
                {workspaces.map((m) => (
                  <option key={m.workspaceId} value={m.workspaceId}>
                    {m.workspace.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong className="workspace-name">{current?.name}</strong>
            )}
          </div>
        </div>
        <div className="nav-caption">TU NEGOCIO</div>
        <nav>
          {[
            ...nav,
            ...(profile?.platformAdmin
              ? [{ id: "accounts", label: "Cuentas", icon: Users }]
              : []),
          ].map((item) => (
            <button
              key={item.id}
              title={item.label}
              aria-label={item.label}
              className={page === item.id ? "active" : ""}
              onClick={() => {
                setPage(item.id);
                setSearch("");
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "payments" && overview?.pending > 0 && (
                <b className="nav-count">{overview.pending}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="profile"
            onClick={() => {
              credentials.setToken("");
              credentials.setWorkspace("");
              setProfile(null);
              setPage("overview");
              setSigned(false);
            }}
          >
            <span className="avatar">AD</span>
            <span>
              <strong>
                {profile?.platformAdmin
                  ? "Administrador de Nexo"
                  : profile?.email || "Mi cuenta"}
              </strong>
              <small>Cerrar sesión</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Mi negocio <ChevronRight size={14} />{" "}
            <strong>
              {page === "accounts"
                ? "Cuentas"
                : nav.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <div className="top-actions">
            <span className="environment">
              <span className="pulse" />{" "}
              {!statusLoaded
                ? "Comprobando WhatsApp"
                : activeConnectionIds.size
                  ? `${activeConnectionIds.size} WhatsApp ${activeConnectionIds.size === 1 ? "conectado" : "conectados"}`
                  : "Sin WhatsApp activo"}
            </span>
            <button
              className="icon-button"
              title="Actualizar datos"
              onClick={() => action(refresh, "Datos actualizados")}
            >
              <RefreshCw size={18} className={busy ? "spin" : ""} />
            </button>
            <button
              className="icon-button notification-button"
              title="Notificaciones"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <Bell size={19} />
              {overview?.pending > 0 && <i />}
            </button>
            <span className="avatar small">AD</span>
          </div>
        </header>
        <div className="content">
          <div className="mobile-account">
            {workspaces.length > 1 ? (
              <select
                aria-label="Negocio"
                value={workspace}
                onChange={(e) => {
                  credentials.setWorkspace(e.target.value);
                  setWorkspace(e.target.value);
                  setSelected(null);
                  action(refresh, "");
                }}
              >
                {workspaces.map((m) => (
                  <option key={m.workspaceId} value={m.workspaceId}>
                    {m.workspace.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{current?.name}</strong>
            )}
            <button
              className="secondary"
              onClick={() => {
                credentials.setToken("");
                credentials.setWorkspace("");
                setProfile(null);
                setPage("overview");
                setSigned(false);
              }}
            >
              Salir
            </button>
          </div>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button onClick={() => setError("")} aria-label="Cerrar error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <Check size={17} />
              {notice}
            </div>
          )}
          {showNotifications && (
            <section className="notification-panel">
              <div className="section-title">
                <h3>Notificaciones</h3>
                <button
                  className="icon-button"
                  onClick={() => setShowNotifications(false)}
                >
                  <X size={17} />
                </button>
              </div>
              {overview?.notifications?.length ? (
                overview.notifications.map((n: any) => (
                  <p key={n.id}>
                    {n.text}
                    <small>
                      {new Date(n.createdAt).toLocaleString("es-AR")}
                    </small>
                  </p>
                ))
              ) : (
                <p>No hay notificaciones.</p>
              )}
            </section>
          )}
          {page === "accounts" && profile?.platformAdmin && (
            <AccountAdmin onCreated={loadWorkspaces} />
          )}
          {page === "overview" && <OverviewPage {...dashboard} />}
          {page === "products" && <ProductsPage {...dashboard} />}
          {page === "inbox" && <InboxPage {...dashboard} />}
          {page === "payments" && <PaymentsPage {...dashboard} />}
          {page === "connections" && <ConnectionsPage {...dashboard} />}
          {page === "settings" && settings && <SettingsPage {...dashboard} />}
          {!workspace && (
            <Empty title="No hay un negocio disponible">
              Volvé a iniciar sesión o revisá tu acceso con el administrador.
            </Empty>
          )}
        </div>
      </main>
      {editing && (
        <ProductEditor
          product={editing}
          tab={editorTab}
          setTab={setEditorTab}
          close={() => setEditing(null)}
          busy={busy}
          run={action}
          update={setEditing}
        />
      )}
    </div>
  );
}

function SessionBoundary() {
  const revision = useSyncExternalStore(
    credentials.subscribe,
    credentials.getSnapshot,
  );
  return <App key={revision} />;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionBoundary />
  </React.StrictMode>,
);
