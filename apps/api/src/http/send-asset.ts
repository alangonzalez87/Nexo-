import { createReadStream } from "node:fs";
import type { FastifyReply } from "fastify";

/** Send an asset whose access has already been authorized by the route. */
export function sendAssetAttachment(
  reply: FastifyReply,
  asset: { path: string; mime: string; originalName: string },
  options: { noReferrer?: boolean } = {},
) {
  if (options.noReferrer) reply.header("Referrer-Policy", "no-referrer");
  return reply
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`)
    .type(asset.mime)
    .send(createReadStream(asset.path));
}
