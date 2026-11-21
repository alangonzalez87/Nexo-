import { useEffect, useState } from "react";
import { api, credentials } from "../../api";
import type { Payment, Product } from "../../types";
import { useConnectionStatuses } from "../../hooks/useConnectionStatuses";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { isConnectionActive } from "../../connectionStatus";
import type { Conversation } from "./viewHelpers";
import type { Connection } from "./viewHelpers";

export function useDashboard() {
  const [signed, setSigned] = useState(!!credentials.token),
    [page, setPage] = useState("overview"),
    [workspaces, setWorkspaces] = useState<any[]>([]),
    [workspace, setWorkspace] = useState(credentials.workspace);
  const [profile, setProfile] = useState<{
    email: string;
    platformAdmin: boolean;
  } | null>(null);
  const [overview, setOverview] = useState<any>(null),
    [products, setProducts] = useState<Product[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [channelFilter, setChannelFilter] = useState("active"),
    [payments, setPayments] = useState<Payment[] | null>(null),
    [settings, setSettings] = useState<any>(null);
  const connectionStatuses = useConnectionStatuses(
    signed && !!workspace,
    workspace,
  );
  const { liveStatuses, statusLoaded, refreshLiveStatuses, setLiveStatuses } =
    connectionStatuses;
  const { busy, error, setError, run: runAction } = useAsyncAction();
  const [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<Product | null>(null),
    [editorTab, setEditorTab] = useState("general"),
    [selected, setSelected] = useState<Conversation | null>(null),
    [search, setSearch] = useState(""),
    [showNotifications, setShowNotifications] = useState(false),
    [settingsTab, setSettingsTab] = useState<
      "business" | "payments" | "advanced"
    >("business");
  async function refresh() {
    if (!credentials.workspace) return;
    const data = await Promise.all([
      api("/overview"),
      api<Product[]>("/products"),
      api<Conversation[]>("/conversations"),
      api<Connection[]>("/connections"),
      api<Payment[]>("/payments?provider=OPENWA"),
      api("/settings"),
    ]);
    setOverview(data[0]);
    setProducts(data[1]);
    setConversations(data[2]);
    setConnections(data[3]);
    setPayments(data[4]);
    setSettings(data[5]);
  }
  async function loadWorkspaces() {
    const [memberships, me] = await Promise.all([
      api<any[]>("/workspaces"),
      api<{ email: string; platformAdmin: boolean }>("/auth/me"),
    ]);
    setProfile(me);
    setWorkspaces(memberships);
    const next =
      memberships.find((m) => m.workspaceId === credentials.workspace)
        ?.workspaceId ||
      memberships[0]?.workspaceId ||
      "";
    credentials.setWorkspace(next);
    setWorkspace(next);
    await refresh();
  }
  useEffect(() => {
    if (signed) loadWorkspaces().catch((e) => setError(e.message));
  }, [signed]);
  useEffect(() => {
    if (!signed || !workspace) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
      if (selected)
        api<Conversation>(`/conversations/${selected.id}`)
          .then((updated) =>
            setSelected((current) =>
              current?.id === updated.id ? updated : current,
            ),
          )
          .catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [signed, workspace, selected?.id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  async function action(
    task: () => Promise<unknown>,
    success = "Cambios guardados",
  ) {
    await runAction(task, {
      onSuccess: async () => {
        await refresh();
        if (success) setNotice(success);
      },
    });
  }
  const openChat = async (id: string, focusChannel = true) => {
    await action(async () => {
      const conversation = await api<Conversation>(`/conversations/${id}`);
      setSelected(conversation);
      if (focusChannel) setChannelFilter(conversation.connectionId);
      setPage("inbox");
    }, "");
  };
  const current = workspaces.find(
    (m) => m.workspaceId === workspace,
  )?.workspace;
  const realConversations = conversations.filter(
    (c) =>
      connections.find((connection) => connection.id === c.connectionId)
        ?.provider === "OPENWA",
  );
  const openwaConnections = connections.filter(
    (connection) => connection.provider === "OPENWA",
  );
  const statusFor = (id: string) =>
    liveStatuses[id]?.status || (statusLoaded ? "UNAVAILABLE" : "CHECKING");
  const activeConnectionIds = new Set(
    openwaConnections
      .filter((connection) => isConnectionActive(statusFor(connection.id)))
      .map((connection) => connection.id),
  );
  return {
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
    openwaConnections,
    statusFor,
    activeConnectionIds,
  };
}

export type DashboardState = ReturnType<typeof useDashboard>;
