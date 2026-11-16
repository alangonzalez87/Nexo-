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
