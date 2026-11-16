import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";
import { z } from "zod";
import {
  activationCode,
  assertActivationAvailable,
} from "../catalog/activation.js";
import { idParam } from "./context.js";

export function registerCampaignRoutes(
  app: FastifyInstance,
  { db, sales, scope }: Pick<RouteContext, "db" | "sales" | "scope">,
) {
  app.get("/api/campaigns", async (req) =>
    db.campaign.findMany({
      where: { workspaceId: await scope(req) },
      include: { product: { select: { name: true } } },
    }),
  );
  app.post("/api/campaigns", async (req) => {
    const workspaceId = await scope(req, true);
    const data = z
      .object({
        name: z.string().min(2).max(80),
        code: z
          .string()
          .trim()
          .max(200)
          .transform(activationCode)
          .pipe(z.string().min(3).max(200)),
        productId: z.string(),
        adId: z.string().max(200).nullable().optional(),
      })
      .parse(req.body);
    return sales.locked(workspaceId, async (tx) => {
      await tx.product.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: data.productId } },
      });
      await assertActivationAvailable(tx, workspaceId, data.code);
      return tx.campaign.create({ data: { ...data, workspaceId } });
    });
  });
  app.delete("/api/campaigns/:id", async (req) =>
    db.campaign.deleteMany({
      where: { workspaceId: await scope(req, true), id: idParam(req) },
    }),
  );
}
