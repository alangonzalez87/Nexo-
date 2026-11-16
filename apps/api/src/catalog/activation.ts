import type { Prisma } from "@nexo/database";
import { normalize } from "../seller/text.js";
import { HttpError } from "../security.js";

export const activationCode = (value: string) => normalize(value).toUpperCase();

export async function assertActivationAvailable(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  code: string,
  exceptId?: string,
) {
  const campaigns = await tx.campaign.findMany({
    where: { workspaceId },
    select: { id: true, code: true },
  });
  if (
    campaigns.some(
      (campaign) =>
        campaign.id !== exceptId && activationCode(campaign.code) === code,
    )
  )
    throw new HttpError(
      409,
      "Esa frase de activación ya está asignada. Elegí una diferente.",
    );
}
