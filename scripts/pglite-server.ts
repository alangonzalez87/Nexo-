import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { startLocalDb } from "./local-db.js";

const dataDir = resolve(".data/demo-db");
// PGlite uses a simulated PostgreSQL PID. After an abrupt WASM exit these
// runtime locks can remain even though no database process exists.
for (const file of [
  "postmaster.pid",
  ".s.PGSQL.5432.lock",
  ".s.PGSQL.5432.lock.out",
])
  await rm(resolve(dataDir, file), { force: true });

const local = await startLocalDb(55432, dataDir);
console.log("PGlite listo en 127.0.0.1:55432");

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await local.close();
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
