/**
 * Supervisor dei servizi interni del BFF: lancia OpenAPI e SVG-server
 * come processi figli, attende che le porte siano pronte, fa il fan-out
 * dei log con prefisso, e li abbatte in shutdown insieme al BFF.
 *
 * Disattivabile con BFF_SPAWN_INTERNAL=false (utile in dev se OpenAPI o
 * SVG sono gia' in esecuzione separatamente).
 */
import { spawn } from "child_process";
import path from "path";
import net from "net";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

function colorize(name, color) {
  return `${color}[${name}]${ANSI.reset}`;
}

function pipeWithPrefix(stream, label, isErr = false) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const out = `${label} ${line}\n`;
      if (isErr) process.stderr.write(out);
      else process.stdout.write(out);
    }
  });
  stream.on("end", () => {
    if (buf) {
      const out = `${label} ${buf}\n`;
      if (isErr) process.stderr.write(out);
      else process.stdout.write(out);
      buf = "";
    }
  });
}

/**
 * Tenta una connessione TCP finche' la porta accetta o scade il timeout.
 */
export function waitForPort(host, port, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const attempt = () => {
      const socket = new net.Socket();
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch {}
      };
      socket.setTimeout(Math.min(intervalMs * 2, 2000));
      socket.once("connect", () => {
        cleanup();
        resolve();
      });
      socket.once("timeout", () => {
        cleanup();
        retry();
      });
      socket.once("error", () => {
        cleanup();
        retry();
      });
      socket.connect(port, host);
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(
          new Error(`Porta ${host}:${port} non risponde entro ${timeoutMs}ms`)
        );
      }
      setTimeout(attempt, intervalMs);
    };

    attempt();
  });
}

/**
 * Avvia un processo figlio Node con cwd dedicato (per node_modules locali).
 */
function spawnChild({ name, color, scriptPath, cwd, env = {}, args = [] }) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`[${name}] script non trovato: ${scriptPath}`);
  }
  const label = colorize(name, color);
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeWithPrefix(child.stdout, label, false);
  pipeWithPrefix(child.stderr, label, true);
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${label} ${ANSI.gray}terminato (signal=${signal})${ANSI.reset}`);
    } else {
      console.log(`${label} ${ANSI.gray}terminato (exit=${code})${ANSI.reset}`);
    }
  });
  return { name, child };
}

/**
 * Avvia OpenAPI e SVG come processi figli e attende che le porte siano
 * raggiungibili. L'ordine e' importante: OpenAPI per primo, perche' SVG
 * fa probe su /musei prima di aprire la propria porta.
 *
 * @param {object} opts
 * @param {string} opts.apiHost
 * @param {number} opts.apiPort
 * @param {string} opts.svgHost
 * @param {number} opts.svgPort
 * @param {string} [opts.apiBootstrap]
 * @param {() => Promise<void>} [opts.onApiReady] eseguito dopo che la porta API accetta connessioni (prima di avviare SVG)
 * @returns Array di { name, child } per il graceful shutdown.
 */
export async function startInternalServers({
  apiHost,
  apiPort,
  svgHost,
  svgPort,
  apiBootstrap = "disk-override",
  onApiReady,
} = {}) {
  const handles = [];

  // ---- 1) OpenAPI ----
  const openApiCwd = path.resolve(__dirname, "../../../../server/openAPI");
  const openApiScript = path.join(openApiCwd, "openAPI_server.js");
  const apiArgs =
    apiBootstrap === "mongo"
      ? ["--bootstrap-mode=mongo"]
      : ["--bootstrap-mode=disk-override"];

  console.log(`🚀 Spawn OpenAPI da ${openApiCwd}`);
  handles.push(
    spawnChild({
      name: "API",
      color: ANSI.green,
      scriptPath: openApiScript,
      cwd: openApiCwd,
      args: apiArgs,
    })
  );

  await waitForPort(apiHost, apiPort, { timeoutMs: 90_000 });
  console.log(`✅ OpenAPI pronto su ${apiHost}:${apiPort}`);

  if (typeof onApiReady === "function") {
    await onApiReady();
  }

  // ---- 2) SVG server ----
  const svgCwd = path.resolve(__dirname, "../../../map-creator/js_server");
  const svgScript = path.join(svgCwd, "svg_server.js");

  console.log(`🚀 Spawn SVG-server da ${svgCwd}`);
  handles.push(
    spawnChild({
      name: "SVG",
      color: ANSI.cyan,
      scriptPath: svgScript,
      cwd: svgCwd,
    })
  );

  await waitForPort(svgHost, svgPort, { timeoutMs: 90_000 });
  console.log(`✅ SVG-server pronto su ${svgHost}:${svgPort}`);

  return handles;
}

/**
 * Termina tutti i figli con SIGTERM, poi SIGKILL dopo `forceAfterMs`.
 */
export function stopInternalServers(handles, { forceAfterMs = 4000 } = {}) {
  if (!Array.isArray(handles) || handles.length === 0) return Promise.resolve();
  return Promise.all(
    handles.map(
      ({ name, child }) =>
        new Promise((resolve) => {
          if (!child || child.exitCode != null || child.killed) return resolve();
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          child.once("exit", finish);
          try {
            child.kill("SIGTERM");
          } catch {
            return finish();
          }
          setTimeout(() => {
            if (!done) {
              try { child.kill("SIGKILL"); } catch {}
              setTimeout(finish, 500);
            }
          }, forceAfterMs).unref();
          // Best-effort log dopo qualche tick.
          setTimeout(() => {
            if (!done) {
              process.stdout.write(`[${name}] ⏳ in arresto...\n`);
            }
          }, 250).unref();
        })
    )
  );
}
