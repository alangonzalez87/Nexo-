import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { networkInterfaces } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gateway = resolve(root, ".data/openwa");
const portable = resolve(root, ".data/tools/node-v22.23.3-win-x64/node.exe");
mkdirSync(resolve(root, ".data"), { recursive: true });
function occupied(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.end();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });
}
async function launch(name, port, exe, args, cwd) {
  const ready = name === "nexo-db" ? databaseReady : () => occupied(port);
  if (await ready()) {
    console.log(`${name}: ya está encendido (puerto ${port}).`);
    return;
  }
  const pidPath = resolve(root, `.data/${name}-pid.json`);
  if (existsSync(pidPath)) {
    try {
      const previous = JSON.parse(readFileSync(pidPath, "utf8"));
      process.kill(previous.pid, 0);
      console.log(`${name}: esperando al proceso existente.`);
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await ready()) {
          console.log(`${name}: listo.`);
          return;
        }
      }
      process.kill(previous.pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      // The saved process no longer exists; start a replacement below.
    }
  }
  const out = openSync(resolve(root, `.data/${name}-stdout.log`), "a");
  const err = openSync(resolve(root, `.data/${name}-stderr.log`), "a");
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: resolve(root, ".data/tools/puppeteer"),
    },
  });
  child.on("error", (error) => console.error(`${name}: ${error.message}`));
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(pidPath, JSON.stringify({ pid: child.pid, exe, args, cwd }));
  // OpenWA can take longer on Windows while it scans persisted browser profiles.
  const startupWaitSeconds = name === "openwa" ? 120 : 60;
  for (let i = 0; i < startupWaitSeconds; i++) {
    if (await ready()) {
      console.log(`${name}: listo.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} no inició. Revisar .data/${name}-stderr.log.`);
}
async function databaseReady() {
  // A bare TCP probe crashes pglite-socket; a Prisma probe leaves prepared
  // statements in its single shared backend. Check the worker process instead.
  try {
    const worker = JSON.parse(
      readFileSync(resolve(root, ".data/nexo-db-worker-pid.json"), "utf8"),
    );
    process.kill(worker.pid, 0);
    return true;
  } catch {
    return false;
  }
}
try {
  if (!existsSync(portable) || !existsSync(resolve(gateway, "dist/main.js")))
    throw new Error("Falta la instalación local de OpenWA.");
  await launch(
    "nexo-db",
    55432,
    process.execPath,
    [resolve(root, "scripts/pglite-supervisor.mjs")],
    root,
  );
  await launch(
    "nexo",
    3001,
    process.execPath,
    [
      "--import",
      "tsx",
      "--env-file-if-exists=.env",
      "scripts/demo.ts",
      "--integrations",
      "--lan",
    ],
    root,
  );
  await launch("openwa", 2785, portable, ["dist/main.js"], gateway);
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find(
      (address) => address?.family === "IPv4" && !address.internal,
    )?.address;
  console.log(
    `\nAbrí Nexo: http://localhost:5173${lanAddress ? `\nDesde otra computadora: http://${lanAddress}:5173` : ""}\nOpenWA: http://localhost:2785\nEl teléfono se vincula únicamente cuando vos escaneás el QR.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
