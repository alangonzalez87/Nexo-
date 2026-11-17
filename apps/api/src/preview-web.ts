import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Only serve Vite's built entry point and flat asset directory, never arbitrary paths.
export function registerPreviewWeb(app: FastifyInstance) {
  const root = resolve(process.env.NEXO_WEB_DIST || "../../apps/web/dist");
  app.get("/", async (_request, reply) => {
    const html = await readFile(resolve(root, "index.html"));
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(html);
  });
  app.get<{ Params: { name: string } }>(
    "/assets/:name",
    async (request, reply) => {
      const name = request.params.name;
      if (
        !/^[a-zA-Z0-9_-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/.test(name)
      )
        return reply.code(404).send({ error: "No encontrado." });
      const types: Record<string, string> = {
        js: "text/javascript; charset=utf-8",
        css: "text/css; charset=utf-8",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        woff: "font/woff",
        woff2: "font/woff2",
      };
      try {
        const bytes = await readFile(resolve(root, "assets", name));
        return reply
          .type(types[name.split(".").at(-1)!])
          .header("X-Content-Type-Options", "nosniff")
          .send(bytes);
      } catch {
        return reply.code(404).send({ error: "No encontrado." });
      }
    },
  );
}
