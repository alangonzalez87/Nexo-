import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:net";
export async function startLocalDb(port: number, dataDir?: string) {
  const db = await PGlite.create(dataDir);
  const exists = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='Workspace')`,
  );
  if (!exists.rows[0].exists)
    await db.exec(
      await readFile(
        resolve(
          "packages/database/prisma/migrations/202610200001_init/migration.sql",
        ),
        "utf8",
      ),
    );
  // Track additive migrations, including pre-existing demo databases. Never reset user data.
  await db.exec(
    'CREATE TABLE IF NOT EXISTS "_NexoLocalMigrations" (name TEXT PRIMARY KEY)',
  );
  const root = resolve("packages/database/prisma/migrations");
  for (const entry of (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "202610200001_init") continue;
    const applied = await db.query(
      'SELECT name FROM "_NexoLocalMigrations" WHERE name=$1',
      [entry.name],
    );
    if (!applied.rows.length)
      await db.transaction(async (tx) => {
        await tx.exec(
          await readFile(resolve(root, entry.name, "migration.sql"), "utf8"),
        );
        await tx.query(
          'INSERT INTO "_NexoLocalMigrations" (name) VALUES ($1)',
          [entry.name],
        );
      });
  }
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port });
  await server.start();
  // pglite-socket installs its socket error listener on the next event-loop turn.
  // A client that connects and immediately closes can otherwise crash this
  // development server with an unhandled ECONNRESET.
  const tcpServer = (server as unknown as { server: Server }).server;
  tcpServer.on("connection", (socket) => {
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ECONNRESET") console.error("PGlite socket:", error);
    });
  });
  return {
    db,
    server,
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable`,
    close: async () => {
      await server.stop();
      await db.close();
    },
  };
}
