/**
 * SvgViewer + MuseoEditor Backend for Frontend (BFF)
 * Node 25+ compatible
 *
 * Routes:
 *   /              → Viewer SPA       (viewer/dist/)
 *   /editor        → Editor SPA       (editor/dist/)
 *   /marketplace   → Marketplace SPA  (marketplace/dist/)
 *   /api/*         → Proxy → openAPI_server (HTTPS + X-API-KEY)
 *   /svg/*         → Proxy → svg_server (HTTP)
 *   /health        → Health check
 */
import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Agent, fetch } from "undici";
import { startInternalServers, stopInternalServers } from "./lib/childServers.js";
import { runQrBootstrapAllMuseums } from "./lib/qrBootstrap.js";

// ============================================================
// PATH
// ============================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// ENV
// ============================================================
dotenv.config({
  path: path.resolve(__dirname, "../../../server/openAPI/.env"),
});

const API_KEY          = process.env.API_KEY;
const API_CONNECT_HOST = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT         = process.env.API_PORT         || 3000;
const SVG_CONNECT_HOST = process.env.SVG_HOST         || "127.0.0.1";
const SVG_PORT         = process.env.SVG_PORT         || 3001;
const BFF_PORT         = process.env.BFF_PORT         || 8080;
const BFF_HOST         = process.env.BFF_HOST         || "0.0.0.0";

if (!API_KEY) {
  console.error("❌ API_KEY mancante nel .env");
  process.exit(1);
}

const API_BASE = `https://${API_CONNECT_HOST}:${API_PORT}`;
const SVG_BASE = `http://${SVG_CONNECT_HOST}:${SVG_PORT}`;

// ============================================================
// CHECK DIST — VIEWER (obbligatorio)
// ============================================================
const distViewerIndex = path.join(__dirname, "viewer/dist/index.html");
if (!fs.existsSync(distViewerIndex)) {
  console.error("❌ viewer/dist/index.html non trovato.");
  console.error("   Esegui prima: npm run build:viewer");
  process.exit(1);
}

// ============================================================
// CHECK DIST — EDITOR (opzionale: warning, non blocca il boot)
// ============================================================
const distEditorIndex = path.join(__dirname, "editor/dist/index.html");
const editorAvailable = fs.existsSync(distEditorIndex);
if (!editorAvailable) {
  console.warn("⚠️  editor/dist/index.html non trovato — /editor non disponibile.");
  console.warn("   Esegui: npm run build:editor");
} else {
  console.log("✅ Editor dist trovato");
}

// ============================================================
// CHECK DIST — MARKETPLACE (opzionale: warning, non blocca il boot)
// ============================================================
const distMarketplaceIndex = path.join(__dirname, "marketplace/dist/index.html");
const marketplaceAvailable = fs.existsSync(distMarketplaceIndex);
if (!marketplaceAvailable) {
  console.warn("⚠️  marketplace/dist/index.html non trovato — /marketplace non disponibile.");
  console.warn("   Esegui: npm run build:marketplace");
} else {
  console.log("✅ Marketplace dist trovato");
}

console.log("✅ Config caricata");
console.log(`   API         → ${API_BASE}`);
console.log(`   SVG         → ${SVG_BASE}`);
console.log(`   BFF         → http://${BFF_HOST}:${BFF_PORT}`);
console.log(`   Viewer      → ${path.join(__dirname, "viewer/dist")}`);
console.log(`   Editor      → ${path.join(__dirname, "editor/dist")} ${editorAvailable ? "✅" : "⚠️  non compilato"}`);
console.log(`   Marketplace → ${path.join(__dirname, "marketplace/dist")} ${marketplaceAvailable ? "✅" : "⚠️  non compilato"}`);

// ============================================================
// UNDICI AGENT (self-signed TLS)
// ============================================================
const dispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

// ============================================================
// EXPRESS
// ============================================================
const app = express();

// ------------------------------------------------------------
// COOP/COEP headers for WASM workers (Chrome STT)
// ------------------------------------------------------------
app.use((req, res, next) => {
  const p = req.path || req.originalUrl || "";
  // Non applicare a proxy o altre SPA per evitare side effects inutili.
  const skip =
    p.startsWith("/api") ||
    p.startsWith("/svg") ||
    p.startsWith("/editor") ||
    p.startsWith("/marketplace") ||
    p.startsWith("/health");
  if (!skip) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

async function requireAdminForEditor(req, res, next) {
  const cookie = req.headers.cookie || "";
  if (!cookie) return res.redirect(302, "/");

  try {
    const meUrl = `${API_BASE}/users/me`;
    const r = await fetch(meUrl, {
      method: "GET",
      headers: {
        "X-API-KEY": API_KEY,
        cookie,
        accept: "application/json",
      },
      dispatcher,
    });

    if (!r.ok) return res.redirect(302, "/");
    const data = await r.json().catch(() => ({}));
    const role = String(data?.user?.ruolo || "").toLowerCase();
    if (role !== "admin") return res.redirect(302, "/");

    next();
  } catch (e) {
    console.error("🔥 EDITOR AUTH ERROR:", e.message);
    return res.redirect(302, "/");
  }
}

// ============================================================
// STATIC — EDITOR  (/editor/assets/*, ecc.)
// Deve stare PRIMA dello static del viewer per evitare collisioni
// ============================================================
app.use(
  "/editor",
  requireAdminForEditor,
  express.static(path.join(__dirname, "editor/dist"), { index: false })
);

// ============================================================
// SPA FALLBACK — EDITOR  (/editor  e  /editor/*)
// ============================================================
app.get(["/editor", "/editor/*"], (req, res) => {
  return requireAdminForEditor(req, res, () => {
  if (!editorAvailable) {
    return res
      .status(503)
      .send(
        `<h2>Editor non ancora compilato</h2>` +
        `<p>Esegui <code>npm run build:editor</code> nella cartella <code>editor/</code>.</p>`
      );
  }
  res.sendFile(distEditorIndex);
  });
});

// ============================================================
// STATIC — MARKETPLACE  (/marketplace/assets/*, ecc.)
// Deve stare PRIMA dello static del viewer per evitare collisioni
// ============================================================
app.get("/marketplace/indexMarketplace.html", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return res.redirect(302, `/marketplace/${qs}`);
});

app.use(
  "/marketplace",
  express.static(path.join(__dirname, "marketplace/dist"), { index: false })
);

// ============================================================
// SPA FALLBACK — MARKETPLACE  (/marketplace  e  /marketplace/*)
// ============================================================
app.get(["/marketplace", "/marketplace/*"], (req, res) => {
  if (!marketplaceAvailable) {
    return res
      .status(503)
      .send(
        `<h2>Marketplace non ancora compilato</h2>` +
        `<p>Esegui <code>npm run build:marketplace</code>.</p>`
      );
  }
  res.sendFile(distMarketplaceIndex);
});

// ============================================================
// STATIC — VIEWER  (/assets/*, /vite.svg, ecc.)
// ============================================================
app.use(
  "/img",
  express.static(path.join(__dirname, "img"), { index: false })
);

app.use(
  "/foto",
  express.static(path.resolve(__dirname, "../../..", "foto"), { index: false })
);

app.use(
  express.static(path.join(__dirname, "viewer/dist"), {
    index: false,
    setHeaders: (res, filePath) => {
      // Cache aggressiva per modelli STT (file grandi) e asset fingerprintati.
      if (filePath.endsWith(".tar.gz") && filePath.includes("vosk-model-")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      if (filePath.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

// ============================================================
// PROXY SVG → svg_server
// ============================================================
app.use("/svg", async (req, res) => {
  const target = SVG_BASE + req.originalUrl.replace("/svg", "");
  console.log("➡️  SVG PROXY:", req.method, target);

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { Accept: "image/svg+xml" },
    });

    const buffer = Buffer.from(await r.arrayBuffer());
    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.set("Content-Type", ct);
    res.send(buffer);
  } catch (e) {
    console.error("🔥 SVG PROXY ERROR:", e.message);
    res.status(502).json({ error: "SVG server unreachable", message: e.message, target });
  }
});

// ============================================================
// PROXY API → openAPI_server
// ============================================================
app.use("/api", (req, res, next) => {
  const ct = req.headers["content-type"] ?? "";
  if (ct.includes("multipart/form-data")) {
    next();
  } else {
    express.json()(req, res, next);
  }
}, async (req, res) => {
  const target = API_BASE + req.originalUrl.replace("/api", "");
  console.log("➡️  API PROXY:", req.method, target);

  try {
    const forwardHeaders = { "X-API-KEY": API_KEY };
    if (req.headers.accept) forwardHeaders["accept"] = req.headers.accept;
    if (req.headers["content-type"]) forwardHeaders["content-type"] = req.headers["content-type"];
    if (req.headers.cookie) forwardHeaders["cookie"] = req.headers.cookie;

    const fetchOptions = { method: req.method, headers: forwardHeaders, dispatcher };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const ct = req.headers["content-type"] ?? "";
      if (ct.includes("multipart/form-data")) {
        fetchOptions.body = req;
        fetchOptions.duplex = "half";
        delete forwardHeaders["content-length"];
      } else if (req.body && Object.keys(req.body).length > 0) {
        fetchOptions.body = JSON.stringify(req.body);
        forwardHeaders["content-type"] = "application/json";
      }
    }

    const r = await fetch(target, fetchOptions);
    const buffer = Buffer.from(await r.arrayBuffer());

    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.set("Content-Type", ct);
    const cc = r.headers.get("cache-control");
    if (cc) res.set("Cache-Control", cc);
    const setCookie = r.headers.getSetCookie?.() || [];
    if (setCookie.length > 0) {
      res.setHeader("Set-Cookie", setCookie);
    }
    res.send(buffer);
  } catch (e) {
    console.error("🔥 API PROXY ERROR:", e.message);
    res.status(502).json({ error: "API unreachable", message: e.message, target });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    editor:      editorAvailable      ? "available" : "not built",
    marketplace: marketplaceAvailable ? "available" : "not built",
  });
});

// ============================================================
// SPA FALLBACK — VIEWER  (tutto il resto → viewer/dist/index.html)
// ============================================================
app.use((req, res) => {
  res.sendFile(distViewerIndex);
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// ============================================================
// AVVIO + GRACEFUL SHUTDOWN
//
// Cert dedicato al BFF in cert/bff.{crt,key}: serve a far funzionare la
// fotocamera (QR-gate) da iPhone Safari, che richiede HTTPS valido. Il
// cert dell'OpenAPI (server/openAPI/cert/) NON viene toccato.
//
// Override via .env:
//   BFF_TLS_CERT, BFF_TLS_KEY  → path espliciti
//   BFF_FORCE_HTTP=true        → forza HTTP anche se i cert ci sono
// ============================================================
function loadTlsOptions() {
  if (String(process.env.BFF_FORCE_HTTP || "").trim().toLowerCase() === "true") {
    return null;
  }
  const candidates = [];
  const certEnv = String(process.env.BFF_TLS_CERT || "").trim();
  const keyEnv  = String(process.env.BFF_TLS_KEY  || "").trim();
  if (certEnv && keyEnv) {
    candidates.push({ cert: certEnv, key: keyEnv });
  }
  candidates.push({
    cert: path.resolve(__dirname, "cert/bff.crt"),
    key:  path.resolve(__dirname, "cert/bff.key"),
  });
  for (const c of candidates) {
    try {
      if (fs.existsSync(c.cert) && fs.existsSync(c.key)) {
        return {
          cert: fs.readFileSync(c.cert),
          key:  fs.readFileSync(c.key),
        };
      }
    } catch (_) { /* prova il prossimo */ }
  }
  return null;
}

const tlsOptions = loadTlsOptions();
const useTls = !!tlsOptions;
const proto = useTls ? "https" : "http";
const server = useTls
  ? https.createServer(tlsOptions, app)
  : http.createServer(app);

// ============================================================
// Avvio orchestrato: prima i servizi interni (OpenAPI + SVG),
// poi apriamo la porta del BFF. Disattivabile con
// BFF_SPAWN_INTERNAL=false (es. quando li avvii a mano in dev).
// ============================================================
const spawnInternal =
  String(process.env.BFF_SPAWN_INTERNAL || "true").trim().toLowerCase() !== "false";

let internalHandles = [];

async function bootstrap() {
  if (spawnInternal) {
    try {
      const skipQrBootstrap =
        String(process.env.BFF_SKIP_QR_BOOTSTRAP || "").trim().toLowerCase() === "true";

      internalHandles = await startInternalServers({
        apiHost: API_CONNECT_HOST,
        apiPort: Number(API_PORT),
        svgHost: SVG_CONNECT_HOST,
        svgPort: Number(SVG_PORT),
        apiBootstrap: process.env.BFF_API_BOOTSTRAP || "disk-override",
        onApiReady: skipQrBootstrap
          ? undefined
          : async () => {
              console.log(
                "🖼️  Bootstrap QR: tutti i musei da musei.json (skip se gia' su MongoDB)…"
              );
              try {
                await runQrBootstrapAllMuseums();
                console.log("✅ Bootstrap QR completato.");
              } catch (e) {
                console.warn("⚠️  Bootstrap QR fallito (il BFF continua):", e?.message || e);
              }
            },
      });
    } catch (err) {
      console.error("💥 Avvio servizi interni fallito:", err?.message || err);
      await stopInternalServers(internalHandles).catch(() => {});
      process.exit(1);
    }
  } else {
    console.log("ℹ️  BFF_SPAWN_INTERNAL=false: OpenAPI e SVG NON vengono avviati dal BFF.");
  }

  server.listen(BFF_PORT, BFF_HOST, () => {
    console.log(`\n✅ BFF in ascolto su ${proto}://${BFF_HOST}:${BFF_PORT}${useTls ? " (TLS)" : ""}`);
    console.log(`   🗺️  Viewer:      ${proto}://${BFF_HOST}:${BFF_PORT}/`);
    console.log(`   ✏️  Editor:      ${proto}://${BFF_HOST}:${BFF_PORT}/editor`);
    console.log(`   🛒 Marketplace: ${proto}://${BFF_HOST}:${BFF_PORT}/marketplace`);
    console.log(`   📡 Proxy API:   /api/* → ${API_BASE}/*`);
    console.log(`   🖼️  Proxy SVG:   /svg/* → ${SVG_BASE}/*`);
    if (spawnInternal) {
      console.log(`   🧩 Servizi interni: OpenAPI + SVG-server gestiti dal BFF`);
    }
    if (!useTls) {
      console.log("   ⚠️  TLS disattivato: la fotocamera (QR-gate) non funziona su iPhone via http://");
      console.log("       Genera cert/bff.{crt,key} oppure imposta BFF_TLS_CERT / BFF_TLS_KEY in .env.");
    }
    console.log("");
  });
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`⚠️  ${signal} ricevuto, chiusura graceful...`);
  // Chiusura BFF
  await new Promise((resolve) => {
    server.close(() => resolve());
    // safety net se ci sono connessioni keep-alive che non si chiudono
    setTimeout(resolve, 3500).unref();
  });
  console.log("✅ BFF chiuso");
  // Chiusura figli
  await stopInternalServers(internalHandles).catch(() => {});
  console.log("✅ Servizi interni terminati");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err);
  shutdown("uncaughtException");
});

bootstrap().catch((err) => {
  console.error("💥 Bootstrap fallito:", err);
  process.exit(1);
});