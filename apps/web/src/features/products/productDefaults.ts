import type { Product } from "../../types";

export const emptyProduct: Product = {
  id: "",
  name: "",
  agentEnabled: true,
  priceCents: 0,
  currency: "ARS",
  description: "",
  benefits: "",
  firstMessage: "",
  followUpMessages: [],
  packs: [],
  notifyApprovalByWhatsApp: true,
  receiptMode: "MANUAL",
  remarketingEnabled: false,
  remarketingDelayHours: 6,
  remarketingMessage:
    "Hola, ¿pudiste ver los datos de pago? Si querés continuar con el curso, estoy acá para ayudarte. Si ya pagaste, enviame el comprobante.",
  hook: "",
  cta: "",
  objections: "",
  mode: "STRICT",
  activationKeyword: "",
  deliveryAssetId: null,
  rules: [],
  documents: [],
};
