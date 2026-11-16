import React from "react";
import { ArrowRightUpIcon as ArrowUpRight } from "@solar-icons/react/linear/arrow-right-up";
import { ChatRoundIcon as MessageCircle } from "@solar-icons/react/linear/chat-round";

export type Conversation = {
  id: string;
  connectionId: string;
  contact: string;
  contactName?: string | null;
  contactPhone?: string | null;
  state: string;
  paused: boolean;
  humanControlled?: boolean;
  product?: { name: string };
  messages: {
    id: string;
    text: string;
    direction: string;
    status: string;
    assetId?: string;
    createdAt: string;
  }[];
  updatedAt: string;
};

export type Connection = {
  id: string;
  name: string;
  provider: string;
  status: string;
  sessionId: string;
};

export function contactTitle(
  c: Pick<Conversation, "contact" | "contactName" | "contactPhone">,
) {
  if (c.contactName) return c.contactName;
  if (c.contactPhone) return `+${c.contactPhone}`;
  const phone = /^(\d+)@(c\.us|s\.whatsapp\.net)$/.exec(c.contact);
  if (phone) return `+${phone[1]}`;
  return c.contact.endsWith("@lid")
    ? `Contacto de WhatsApp · ${c.contact.slice(0, -4).slice(-4)}`
    : c.contact;
}

export const stateNames: Record<string, string> = {
  DISCOVERY: "Por identificar",
  OUT_OF_SCOPE: "Fuera de Nexo",
  QUALIFIED: "En conversación",
  AWAITING_PAYMENT: "Esperando pago",
  REVIEW: "Pago en revisión",
  HUMAN: "Atención humana",
  WON: "Venta aprobada",
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
};

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      {stateNames[value] || value}
    </span>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <MessageCircle size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Stat({
  icon: Icon,
  label,
  value,
  note,
  accent = false,
}: {
  icon: typeof MessageCircle;
  label: string;
  value: string | number;
  note: string;
  accent?: boolean;
}) {
  return (
    <section className={`stat card ${accent ? "accent-stat" : ""}`}>
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>
        {accent && <span className="amber-dot" />}
        {note}
      </small>
    </section>
  );
}

export function ConversationTable({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Contacto</th>
            <th>Producto</th>
            <th>Estado</th>
            <th>Última actividad</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {conversations.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c.id)} className="clickable">
              <td>
                <span className="table-contact">
                  <span className="avatar small">
                    {contactTitle(c).slice(0, 2)}
                  </span>
                  <strong>{contactTitle(c)}</strong>
                </span>
              </td>
              <td>{c.product?.name || "Por identificar"}</td>
              <td>
                <Badge value={c.state} />
              </td>
              <td>
                {new Date(c.updatedAt).toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td>
                <ArrowUpRight size={17} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
