import { useState } from "react";
import type { PackDraft, Product, Rule } from "../../types";
import { emptyProduct } from "./productDefaults";

export function useProductEditor(product: Product) {
  const [agentEnabled, setAgentEnabled] = useState(
    product.agentEnabled !== false,
  );
  const [rules, setRules] = useState<Rule[]>(product.rules),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const [firstMessage, setFirstMessage] = useState(product.firstMessage || "");
  const [firstImageId, setFirstImageId] = useState(
    product.firstImageId || null,
  );
  const [followUpImageIds, setFollowUpImageIds] = useState<string[]>(
    product.followUpImageIds || [],
  );
  const [followUpMessages, setFollowUpMessages] = useState<string[]>(
    product.followUpMessages || [],
  );
  const [packs, setPacks] = useState<PackDraft[]>(
    (product.packs || []).map((pack) => ({
      number: pack.number,
      name: pack.name,
      price: String(pack.priceCents / 100),
      summary: pack.summary,
      imageId: pack.imageId,
      deliveryMessage: pack.deliveryMessage,
    })),
  );
  const [previewPack, setPreviewPack] = useState(0);
  const [keyword, setKeyword] = useState(product.activationKeyword || "");
  const [notifyApprovalByWhatsApp, setNotifyApprovalByWhatsApp] = useState(
    product.notifyApprovalByWhatsApp !== false,
  );
  const [receiptMode, setReceiptMode] = useState<"MANUAL" | "AUTO_RECEIPT">(
    product.receiptMode || "MANUAL",
  );
  const [remarketingEnabled, setRemarketingEnabled] = useState(
    product.remarketingEnabled || false,
  );
  const [remarketingDelayHours, setRemarketingDelayHours] = useState(
    product.remarketingDelayHours || 6,
  );
  const [remarketingMessage, setRemarketingMessage] = useState(
    product.remarketingMessage || emptyProduct.remarketingMessage,
  );
  function updatePack(index: number, patch: Partial<PackDraft>) {
    setPacks((current) =>
      current.map((pack, i) => (i === index ? { ...pack, ...patch } : pack)),
    );
  }
  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }
  return {
    firstImageId,
    setFirstImageId,
    followUpImageIds,
    setFollowUpImageIds,
    agentEnabled,
    setAgentEnabled,
    rules,
    setRules,
    deleteConfirm,
    setDeleteConfirm,
    firstMessage,
    setFirstMessage,
    followUpMessages,
    setFollowUpMessages,
    packs,
    setPacks,
    previewPack,
    setPreviewPack,
    keyword,
    setKeyword,
    notifyApprovalByWhatsApp,
    setNotifyApprovalByWhatsApp,
    receiptMode,
    setReceiptMode,
    remarketingEnabled,
    setRemarketingEnabled,
    remarketingDelayHours,
    setRemarketingDelayHours,
    remarketingMessage,
    setRemarketingMessage,
    updatePack,
    updateRule,
  };
}
