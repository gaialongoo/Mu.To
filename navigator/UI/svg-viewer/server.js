/**
 * SvgViewer Backend for Frontend (BFF)
 * Node 25+ compatible
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Agent, fetch } from "undici";

// ============================================================
// PATH
// ============================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// ENV (API MUSEI)
// ============================================================
dotenv.config({
  path: path.resolve(__dirname, "../../../server/openAPI/.env"),
});

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("❌ API_KEY non trovata");
  process.exit(1);
}
console.log("✅ API_KEY caricata");

// ============================================================
// UNDICI AGENT (self-signed TLS)
// ============================================================
const dispatcher = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

// ============================================================
// CONFIG
// ============================================================

// ⬅️ QUI deve stare l'API vera (openAPI_server.js)
const API_BASE = "https://127.0.0.1:3000"; // <-- PORTA API JSON
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// ============================================================
// EXPRESS
// ============================================================
const app = express();

// Middleware per parsing JSON (se dovessi inviare POST/PUT)
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// STATIC FILES
// ============================================================
app.use(
  express.static(path.join(__dirname, "dist"), {
    index: false,
  })
);

// ============================================================
// PROXY API (ROBUSTO)
// ============================================================
app.use("/api", async (req, res) => {
  const target = API_BASE + req.originalUrl.replace("/api", "");
  console.log("➡️ PROXY:", req.method, target);

  try {
    const forwardHeaders = {
  "X-API-KEY": API_KEY,
};


    if (req.headers.accept) {
      forwardHeaders.Accept = req.headers.accept;
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      dispatcher,
    };

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
    console.error("🔥 PROXY ERROR:", e.message);
    res.status(502).json({
      error: "API unreachable",
      message: e.message,
      target,
    });
  }
});


// ============================================================
// HEALTH CHECK (utile per monitoring)
// ============================================================
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
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
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
const server = app.listen(PORT, HOST, () => {
  console.log(`✅ SvgViewer BFF attivo su http://${HOST}:${PORT}`);
  console.log(`📡 Proxy API: /api/* → ${API_BASE}/*`);
  console.log(`📁 Static files: ${path.join(__dirname, "dist")}`);
});

process.on("SIGTERM", () => {
  console.log("⚠️  SIGTERM ricevuto, chiusura graceful...");
  server.close(() => {
    console.log("✅ Server chiuso");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("⚠️  SIGINT ricevuto, chiusura graceful...");
  server.close(() => {
    console.log("✅ Server chiuso");
    process.exit(0);
  });
});