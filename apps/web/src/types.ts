export type Product = {
  id: string;
  name: string;
  agentEnabled: boolean;
  priceCents: number;
  currency: string;
  description: string;
  benefits: string;
  firstMessage: string;
  firstImageId?: string | null;
  followUpMessages: string[];
  followUpImageIds?: string[];
  packs: Pack[];
  notifyApprovalByWhatsApp: boolean;
  receiptMode: "MANUAL" | "AUTO_RECEIPT";
  remarketingEnabled: boolean;
  remarketingDelayHours: number;
  remarketingMessage: string;
  hook: string;
  cta: string;
  objections: string;
  mode: string;
  activationKeyword: string;
  deliveryAssetId: string | null;
  rules: Rule[];
  documents: { id: string; name: string }[];
};
export type Pack = {
  imageId?: string | null;
  number: number;
  name: string;
  priceCents: number;
  summary: string;
  deliveryMessage: string;
};
export type PackDraft = Omit<Pack, "priceCents"> & { price: string };
export type Payment = {
  id: string;
  assetId: string;
  amountCents: number | null;
  currency: string | null;
  packNumber: number | null;
  packName: string | null;
  deliveryMessage: string | null;
  deliveryMode: "SEND" | "ALREADY_DELIVERED" | null;
  receiptCheckSummary: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reason: string | null;
  connectionName: string;
  historicalConnection: boolean;
  conversation: {
    contact: string;
    contactName: string | null;
    contactPhone: string | null;
    humanControlled: boolean;
    product: { id: string; name: string } | null;
  };
};
export type Rule = {
  question: string;
  answer: string;
  mandatory: boolean;
  imageId?: string | null;
};

export type Run = (
  task: () => Promise<unknown>,
  success?: string,
) => Promise<void>;
