import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, ".data/pglite-supervisor.lock");
let lockFd;
function acquireLock() {
  try {
    lockFd = openSync(lockPath, "wx");
    writeFileSync(lockFd, String(process.pid));
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const owner = Number(readFileSync(lockPath, "utf8"));
      process.kill(owner, 0);
      console.log(`El supervisor de PGlite ya está activo (${owner}).`);
      process.exit(0);
    } catch {
      unlinkSync(lockPath);
      acquireLock();
    }
  }
}
function releaseLock() {
  try {
    if (lockFd !== undefined) closeSync(lockFd);
  } catch {}
  try {
    unlinkSync(lockPath);
  } catch {}
}
acquireLock();
let worker;
let stopping = false;
let restartTimer;

function start() {
  worker = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/pglite-server.ts"],
    {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
    },
  );
  writeFileSync(
    resolve(root, ".data/nexo-db-worker-pid.json"),
    JSON.stringify({ pid: worker.pid }),
  );
  worker.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `PGlite se reiniciará porque terminó (${signal || code || "error"}).`,
    );
    restartTimer = setTimeout(start, 1500);
  });
}

function close() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (worker && !worker.killed) worker.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("exit", releaseLock);
start();
