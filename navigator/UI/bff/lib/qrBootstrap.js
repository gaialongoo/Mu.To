/**
 * Dopo l'avvio dell'API interna, genera i QR per tutti i musei in musei.json,
 * saltando le coppie (museo, oggetto) per cui MongoDB ha gia' un QR attivo
 * **e** il file PNG esiste in `qr_dump/` (se manca il PNG, rigenera).
 *
 * Richiede `server/openAPI/.env` con `MONGO_URI` valido (come per OpenAPI).
 * Disattiva con `BFF_SKIP_QR_BOOTSTRAP=true`.
 */
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runQrBootstrapAllMuseums() {
  const openApiCwd = path.resolve(__dirname, "../../../../server/openAPI");
  const scriptPath = path.join(openApiCwd, "scripts/generate_qr_codes.js");

  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error(`Script QR non trovato: ${scriptPath}`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, "--all-museums", "--skip-existing"],
      {
        cwd: openApiCwd,
        env: process.env,
        stdio: "inherit",
      }
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `generate_qr_codes.js terminato con exit=${code}${signal ? ` signal=${signal}` : ""}`
          )
        );
      }
    });
  });
}
