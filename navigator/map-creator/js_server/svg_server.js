"use strict";

const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const https   = require("https");
const path    = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../server/openAPI/.env") });

const { Stanza, Oggetto } = require("./model");
const { buildLayout }     = require("./layout");
const { svgHeader, svgFooter, draw } = require("./svg_writer");

// ============================================================
// CONFIG DA .ENV
// ============================================================

const API_KEY          = process.env.API_KEY;
const API_CONNECT_HOST = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT         = process.env.API_PORT         || 3000;
const SVG_HOST         = process.env.SVG_HOST         || "0.0.0.0";
const SVG_PORT         = process.env.SVG_PORT         || 3001;

if (!API_KEY) { log("❌ API_KEY mancante nel .env", "FATAL"); process.exit(1); }

const JSON_SERVER       = `https://${API_CONNECT_HOST}:${API_PORT}`;
const REQUEST_TIMEOUT   = 5000;  // ms
const EDGE_MODE_DEFAULT = "path";
const EDGE_FOCUS_DEFAULT = ["", ""];

// ---- API WAIT ----
const API_HEALTH_ENDPOINT = "/musei";
const API_WAIT_TIMEOUT    = 600_000; // ms
const API_WAIT_INTERVAL   = 2000;    // ms

// Agente HTTPS per certificati self-signed
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ============================================================
// UTILS
// ============================================================

function log(msg, level = "INFO") {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

function jsonError(res, status, error, details = null, upstreamStatus = null) {
  const payload = { error };
  if (details)                 payload.details         = details;
  if (upstreamStatus !== null) payload.upstream_status = upstreamStatus;
  return res.status(status).json(payload);
}

// ============================================================
// WAIT FOR API SERVER
// ============================================================

async function waitForApiServer() {
  log(`Attendo che il server API sia ONLINE su ${JSON_SERVER}...`);
  const url     = `${JSON_SERVER}${API_HEALTH_ENDPOINT}`;
  const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };
  const start   = Date.now();

  while (true) {
    try {
      const r = await fetch(url, { headers, agent: httpsAgent, timeout: 3000 });
      if (r.status === 200) {
        log("Server API ONLINE ✅");
        return;
      }
      log(`Server API risponde ma non pronto (status=${r.status})`);
    } catch {
      log("Server API non ancora raggiungibile...");
    }

    if (Date.now() - start > API_WAIT_TIMEOUT) {
      log("Timeout: server API non disponibile", "FATAL");
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, API_WAIT_INTERVAL));
  }
}

// ============================================================
// FETCH LAYOUT DA API
// ============================================================

async function getLayoutForMuseo(nomeMuseo) {
  const url = `${JSON_SERVER}/musei/${encodeURIComponent(nomeMuseo)}/layout`;
  const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };

  let r;
  try {
    r = await fetch(url, { headers, agent: httpsAgent, timeout: REQUEST_TIMEOUT });
  } catch (e) {
    const err = new Error(`Connessione API fallita durante fetch layout: ${e.message}`);
    err.code = "API_UNREACHABLE";
    throw err;
  }

  if (r.status === 404) {
    const err = new Error(`Layout non definito per museo '${nomeMuseo}'`);
    err.code = "NOT_FOUND";
    throw err;
  }

  if (r.status !== 200) {
    const err = new Error(`Errore API layout (status=${r.status})`);
    err.code = "API_ERROR";
    throw err;
  }

  const doc = await r.json();

  if (!doc.grid || typeof doc.grid !== "object") {
    const err = new Error(`Layout di '${nomeMuseo}' non contiene una grid valida`);
    err.code = "INVALID";
    throw err;
  }

  return doc;
}

// ============================================================
// FETCH DATI MUSEO DA API
// ============================================================

async function getDatiMuseo(nomeMuseo) {
  const url     = `${JSON_SERVER}/musei/${encodeURIComponent(nomeMuseo)}`;
  const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };

  let r;
  try {
    r = await fetch(url, { headers, agent: httpsAgent, timeout: REQUEST_TIMEOUT });
  } catch (e) {
    const err = new Error(`Connessione API fallita durante fetch museo: ${e.message}`);
    err.code = "API_UNREACHABLE";
    throw err;
  }

  if (r.status !== 200) {
    const err = new Error(`Errore API museo (status=${r.status})`);
    err.code = "API_ERROR";
    err.status = r.status;
    throw err;
  }

  return r.json();
}

// ============================================================
// SVG GENERATOR
// ============================================================

function generaSvg(data, layout, edgeMode, edgeFocus) {
  const stanzeMap   = {};
  const oggettiList = [];

  for (const [nome, info] of Object.entries(layout.grid)) {
    const s  = new Stanza(nome);
    s.row    = info.row;
    s.col    = info.col;
    s.tipo   = info.tipo || "normale";
    stanzeMap[nome] = s;
  }

  for (const o of data.oggetti || []) {
    if (!stanzeMap[o.stanza]) {
      throw new Error(`Stanza '${o.stanza}' non definita nel layout`);
    }
    const s   = stanzeMap[o.stanza];
    const obj = new Oggetto(o.nome, s, o.connessi || []);
    obj.visibile = o.visibile !== undefined ? o.visibile : true;
    s.oggetti.push(obj);
    oggettiList.push(obj);
  }

  const specialTipi = ["ingresso", "uscita", "bagno", "servizio"];
  for (const s of Object.values(stanzeMap)) {
    if (specialTipi.includes(s.tipo)) {
      const obj    = new Oggetto(s.nome, s, []);
      obj.visibile = false;
      s.oggetti.push(obj);
      oggettiList.push(obj);
    }
  }

  const stanzeList = Object.values(stanzeMap);
  const corridoi   = buildLayout(stanzeList, layout.corridoi || []);

  for (const o of oggettiList) {
    if (specialTipi.includes(o.stanza.tipo)) {
      const s = o.stanza;
      o.pos   = [s.x + s.w / 2, s.y + s.h / 2];
    }
  }

  const w = Math.max(...stanzeList.map((s) => s.x + s.w)) + 200;
  const h = Math.max(...stanzeList.map((s) => s.y + s.h)) + 200;

  let svg = svgHeader(data.nome || "Museo", w, h);
  svg     = draw(svg, stanzeList, corridoi, oggettiList, edgeMode, edgeFocus);
  svg    += svgFooter();

  return svg;
}

// ============================================================
// APP EXPRESS
// ============================================================

const app = express();
app.use(cors({
  origin: "*",
  allowedHeaders: ["Content-Type", "X-API-KEY"],
  methods: ["GET", "OPTIONS"],
}));

// ============================================================
// ROUTES
// ============================================================

app.get("/favicon.ico", (_req, res) => res.status(204).end());

// /<nomeMuseo>
// /<nomeMuseo>/<edgeMode>
// /<nomeMuseo>/<edgeMode>/<f1>/<f2>
app.get("/:nomeMuseo/:edgeMode?/:f1?/:f2?", async (req, res) => {
  const { nomeMuseo, edgeMode: edgeModeParam, f1, f2 } = req.params;

  const edgeMode  = edgeModeParam || EDGE_MODE_DEFAULT;
  const edgeFocus = f1 && f2 ? [f1, f2] : EDGE_FOCUS_DEFAULT;

  log(`Richiesta SVG: museo='${nomeMuseo}' edgeMode='${edgeMode}' focus=[${edgeFocus}]`);

  // 1. Recupera layout via API
  let layoutMuseo;
  try {
    layoutMuseo = await getLayoutForMuseo(nomeMuseo);
  } catch (e) {
    const status = e.code === "NOT_FOUND" ? 404 : 502;
    return jsonError(res, status, "Layout museo non trovato", e.message);
  }

  // 2. Recupera dati museo via API
  let data;
  try {
    data = await getDatiMuseo(nomeMuseo);
  } catch (e) {
    const status = e.status || 502;
    return jsonError(res, status, "Errore recupero dati museo", e.message);
  }

  // 3. Genera SVG
  let svg;
  try {
    svg = generaSvg(data, layoutMuseo, edgeMode, edgeFocus);
  } catch (e) {
    log(`Errore generazione SVG: ${e.message}`, "ERROR");
    return jsonError(res, 500, "Errore generazione SVG", e.message);
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ============================================================
// MAIN
// ============================================================

(async () => {
  await waitForApiServer();

  app.listen(SVG_PORT, SVG_HOST, () => {
    log(`✅ SVG Server in ascolto su http://${SVG_HOST}:${SVG_PORT}`);
    log(`   API Server → ${JSON_SERVER}`);
  });
})();
