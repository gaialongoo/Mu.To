/**
 * Se `ADMIN_BOOTSTRAP_EMAIL` e `ADMIN_BOOTSTRAP_PASSWORD` sono nel `.env`
 * (tipicamente `server/openAPI/.env`, gia' caricato dal BFF), dopo che OpenAPI
 * accetta connessioni viene eseguito `bootstrap_admin_if_missing.js`.
 *
 * Salta creazione se l'email esiste gia'. Disattiva con `BFF_SKIP_ADMIN_BOOTSTRAP=true`.
 */
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runAdminBootstrapIfConfigured() {
  const skip =
    String(process.env.BFF_SKIP_ADMIN_BOOTSTRAP || "").trim().toLowerCase() === "true";
  if (skip) {
    return Promise.resolve();
  }

  const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
  if (!email || !password) {
    return Promise.resolve();
  }

  const openApiCwd = path.resolve(__dirname, "../../../../server/openAPI");
  const scriptPath = path.join(openApiCwd, "scripts/bootstrap_admin_if_missing.js");

  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error(`Script bootstrap admin non trovato: ${scriptPath}`));
  }

  console.log(`👤 Bootstrap admin: verifica / creazione "${email}"…`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: openApiCwd,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `bootstrap_admin_if_missing.js terminato con exit=${code}${signal ? ` signal=${signal}` : ""}`
          )
        );
      }
    });
  });
}
