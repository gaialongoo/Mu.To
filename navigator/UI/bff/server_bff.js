/**
 * SvgViewer + MuseoEditor Backend for Frontend (BFF)
 * Node 25+ compatible
 *
 * Routes:
 *   /          → Viewer SPA  (viewer/dist/)
 *   /editor    → Editor SPA  (editor/dist/)
 *   /marketplace → Marketplace static (marketplace/)
 *   /api/*     → Proxy → openAPI_server (HTTPS + X-API-KEY)
 *   /svg/*     → Proxy → svg_server (HTTP)
 *   /health    → Health check
 */
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Agent, fetch } from "undici";

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
// CHECK — MARKETPLACE (opzionale: warning, non blocca il boot)
// ============================================================
const marketplacePath  = path.join(__dirname, "marketplace");
const marketplaceIndex = path.join(marketplacePath, "indexMarketplace.html");
const marketplaceAvailable = fs.existsSync(marketplaceIndex);
if (!marketplaceAvailable) {
  console.warn("⚠️  marketplace/indexMarketplace.html non trovato — /marketplace non disponibile.");
} else {
  console.log("✅ Marketplace trovato");
}

console.log("✅ Config caricata");
console.log(`   API         → ${API_BASE}`);
console.log(`   SVG         → ${SVG_BASE}`);
console.log(`   BFF         → http://${BFF_HOST}:${BFF_PORT}`);
console.log(`   Viewer      → ${path.join(__dirname, "viewer/dist")}`);
console.log(`   Editor      → ${path.join(__dirname, "editor/dist")} ${editorAvailable ? "✅" : "⚠️  non compilato"}`);
console.log(`   Marketplace → ${marketplacePath} ${marketplaceAvailable ? "✅" : "⚠️  non trovato"}`);

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

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// STATIC — EDITOR  (/editor/assets/*, ecc.)
// Deve stare PRIMA dello static del viewer per evitare collisioni
// ============================================================
app.use(
  "/editor",
  express.static(path.join(__dirname, "editor/dist"), { index: false })
);

// ============================================================
// SPA FALLBACK — EDITOR  (/editor  e  /editor/*)
// ============================================================
app.get(["/editor", "/editor/*"], (req, res) => {
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

// ============================================================
// STATIC — MARKETPLACE  (/marketplace/*)
// ============================================================
app.use(
  "/marketplace",
  express.static(marketplacePath)
);

// ============================================================
// STATIC — VIEWER  (/assets/*, /vite.svg, ecc.)
// ============================================================
app.use(
  express.static(path.join(__dirname, "viewer/dist"), { index: false })
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
    editor: editorAvailable ? "available" : "not built",
    marketplace: marketplaceAvailable ? "available" : "not found",
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
// ============================================================
const server = app.listen(BFF_PORT, BFF_HOST, () => {
  console.log(`\n✅ BFF in ascolto su http://${BFF_HOST}:${BFF_PORT}`);
  console.log(`   🗺️  Viewer:      http://${BFF_HOST}:${BFF_PORT}/`);
  console.log(`   ✏️  Editor:      http://${BFF_HOST}:${BFF_PORT}/editor`);
  console.log(`   🛒 Marketplace: http://${BFF_HOST}:${BFF_PORT}/marketplace/indexMarketplace.html`);
  console.log(`   📡 Proxy API:   /api/* → ${API_BASE}/*`);
  console.log(`   🖼️  Proxy SVG:   /svg/* → ${SVG_BASE}/*\n`);
});

const shutdown = (signal) => {
  console.log(`⚠️  ${signal} ricevuto, chiusura graceful...`);
  server.close(() => {
    console.log("✅ Server chiuso");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));