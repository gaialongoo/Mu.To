/**
 * SvgViewer Backend for Frontend (BFF)
 * Node 25+ compatible
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

const API_KEY           = process.env.API_KEY;
const API_CONNECT_HOST  = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT          = process.env.API_PORT         || 3000;
const SVG_CONNECT_HOST  = process.env.SVG_HOST         || "127.0.0.1";
const SVG_PORT          = process.env.SVG_PORT         || 3001;
const BFF_PORT          = process.env.BFF_PORT         || 8080;
const BFF_HOST          = process.env.BFF_HOST         || "0.0.0.0";

if (!API_KEY) {
  console.error("❌ API_KEY mancante nel .env");
  process.exit(1);
}

const API_BASE = `https://${API_CONNECT_HOST}:${API_PORT}`;
const SVG_BASE = `http://${SVG_CONNECT_HOST}:${SVG_PORT}`;

// ============================================================
// CHECK DIST
// ============================================================
const distIndex = path.join(__dirname, "dist/index.html");
if (!fs.existsSync(distIndex)) {
  console.error("❌ dist/index.html non trovato.");
  console.error("   Esegui prima: npm run build");
  process.exit(1);
}

console.log("✅ Config caricata");
console.log(`   API → ${API_BASE}`);
console.log(`   SVG → ${SVG_BASE}`);
console.log(`   BFF → http://${BFF_HOST}:${BFF_PORT}`);

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

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// STATIC FILES
// ============================================================
app.use(
  express.static(path.join(__dirname, "dist"), { index: false })
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
app.use("/api", async (req, res) => {
  const target = API_BASE + req.originalUrl.replace("/api", "");
  console.log("➡️  API PROXY:", req.method, target);

  try {
    const forwardHeaders = { "X-API-KEY": API_KEY };
    if (req.headers.accept) forwardHeaders.Accept = req.headers.accept;

    const fetchOptions = { method: req.method, headers: forwardHeaders, dispatcher };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
      fetchOptions.headers["Content-Type"] = "application/json";
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
  res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ============================================================
// SPA FALLBACK
// ============================================================
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "dist/index.html"));
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
  console.log(`✅ BFF in ascolto su http://${BFF_HOST}:${BFF_PORT}`);
  console.log(`📡 Proxy API: /api/* → ${API_BASE}/*`);
  console.log(`🗺️  Proxy SVG: /svg/* → ${SVG_BASE}/*`);
  console.log(`📁 Static:    ${path.join(__dirname, "dist")}`);
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
