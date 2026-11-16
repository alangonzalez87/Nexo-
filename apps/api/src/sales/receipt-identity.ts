import { readFile } from "node:fs/promises";
import type { Prisma } from "@nexo/database";
import { HttpError, sha256 } from "../security.js";

export async function receiptFingerprint(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  assetId: string,
) {
  const asset = await tx.asset.findFirst({
    where: { workspaceId, id: assetId, purpose: "RECEIPT" },
  });
  if (!asset) throw new HttpError(409, "El comprobante ya no está disponible.");
  return sha256(await readFile(asset.path));
}

/** Called under the workspace lock, including immediately before final approval. */
export async function receiptWasUsed(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  paymentId: string,
  fingerprint: string,
  reference?: string | null,
) {
  const recorded = await tx.payment.findFirst({
    where: {
      workspaceId,
      id: { not: paymentId },
      OR: [
        { receiptFingerprint: fingerprint },
        ...(reference ? [{ receiptReference: reference }] : []),
      ],
    },
    select: { id: true },
  });
  if (recorded) return true;
  // Older manual approvals may predate fingerprints. Compare their original files
  // as well, without rewriting historical payments or accepting an unreadable history.
  const legacy = await tx.payment.findMany({
    where: {
      workspaceId,
      id: { not: paymentId },
      status: "APPROVED",
      receiptFingerprint: null,
    },
    select: { assetId: true },
  });
  for (const payment of legacy) {
    if (
      (await receiptFingerprint(tx, workspaceId, payment.assetId)) ===
      fingerprint
    )
      return true;
  }
  return false;
}
