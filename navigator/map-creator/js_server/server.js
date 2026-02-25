// server.js
// Equivalente JS di server.py (Flask -> Express, pymongo -> mongodb, requests -> node-fetch)

"use strict";

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const fetch = require("node-fetch");
const https = require("https");
const fs = require("fs");
const path = require("path");

const { Stanza, Oggetto } = require("./model");
const { buildLayout } = require("./layout");
const { svgHeader, svgFooter, draw } = require("./svg_writer");

// ============================================================
// CONFIG
// ============================================================

const HOST = "0.0.0.0";
const PORT = 3001;

const JSON_SERVER = "https://127.0.0.1:3000";
const REQUEST_TIMEOUT = 5000; // ms

const ENV_PATH = "../../../server/openAPI/.env";
const API_KEY_NAME = "API_KEY";

const EDGE_MODE_DEFAULT = "path";
const EDGE_FOCUS_DEFAULT = ["", ""];

// ---- NODE WAIT ----
const NODE_HEALTH_ENDPOINT = "/musei";
const NODE_WAIT_TIMEOUT = 600_000; // ms
const NODE_WAIT_INTERVAL = 2000;   // ms

// ---- MONGO ----
const MONGO_URI = "mongodb://127.0.0.1:27017";
const MONGO_DB = "musei";
const MONGO_COLLECTION = "musei_layout";

// Agente HTTPS che ignora i certificati self-signed (equivalente a verify=False)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ============================================================
// UTILS
// ============================================================

function log(msg, level = "INFO") {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

function jsonError(res, status, error, details = null, upstreamStatus = null) {
  const payload = { error };
  if (details) payload.details = details;
  if (upstreamStatus !== null) payload.upstream_status = upstreamStatus;
  return res.status(status).json(payload);
}

// ============================================================
// LOAD API KEY
// ============================================================

if (!fs.existsSync(ENV_PATH)) {
  log(`.env non trovato: ${ENV_PATH}`, "FATAL");
  process.exit(1);
}

let API_KEY = null;
const envLines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
for (const raw of envLines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  if (line.startsWith(API_KEY_NAME + "=")) {
    API_KEY = line.slice(API_KEY_NAME.length + 1).trim();
    break;
  }
}

if (!API_KEY) {
  log("API_KEY non trovata o vuota", "FATAL");
  process.exit(1);
}

log("API_KEY caricata correttamente");

// ============================================================
// WAIT FOR NODE SERVER
// ============================================================

async function waitForNodeServer() {
  log("Attendo che il server Node sia ONLINE...");
  const url = `${JSON_SERVER}${NODE_HEALTH_ENDPOINT}`;
  const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };
  const start = Date.now();

  while (true) {
    try {
      const r = await fetch(url, { headers, agent: httpsAgent, timeout: 3000 });
      if (r.status === 200) {
        log("Server Node ONLINE ✅");
        return;
      }
      log(`Node risponde ma non pronto (status=${r.status})`);
    } catch {
      log("Server Node non ancora raggiungibile...");
    }

    if (Date.now() - start > NODE_WAIT_TIMEOUT) {
      log("Timeout: server Node non disponibile", "FATAL");
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, NODE_WAIT_INTERVAL));
  }
}

// ============================================================
// MONGO CONNECTION
// ============================================================

let mongoLayouts;

async function connectMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    mongoLayouts = client.db(MONGO_DB).collection(MONGO_COLLECTION);
    log(`Connessione MongoDB OK -> DB='${MONGO_DB}', collection='${MONGO_COLLECTION}'`);
  } catch (e) {
    log(`Errore connessione MongoDB: ${e}`, "FATAL");
    process.exit(1);
  }
}

// ============================================================
// LAYOUT LOOKUP (MONGO)
// ============================================================

async function getLayoutForMuseo(nomeMuseo) {
  const doc = await mongoLayouts.findOne({ _id: nomeMuseo });

  if (!doc) {
    const err = new Error(`Layout non definito per museo '${nomeMuseo}'`);
    err.code = "NOT_FOUND";
    throw err;
  }

  if (!doc.grid || typeof doc.grid !== "object") {
    const err = new Error(`Layout di '${nomeMuseo}' non contiene una grid valida`);
    err.code = "INVALID";
    throw err;
  }

  return doc;
}

// ============================================================
// SVG GENERATOR
// ============================================================

function generaSvg(data, layout, edgeMode, edgeFocus) {
  const stanzeMap = {};
  const oggettiList = [];

  for (const [nome, info] of Object.entries(layout.grid)) {
    const s = new Stanza(nome);
    s.row = info.row;
    s.col = info.col;
    s.tipo = info.tipo || "normale";
    stanzeMap[nome] = s;
  }

  for (const o of data.oggetti || []) {
    if (!stanzeMap[o.stanza]) {
      throw new Error(`Stanza '${o.stanza}' non definita nel layout`);
    }
    const s = stanzeMap[o.stanza];
    const obj = new Oggetto(o.nome, s, o.connessi || []);
    obj.visibile = o.visibile !== undefined ? o.visibile : true;
    s.oggetti.push(obj);
    oggettiList.push(obj);
  }

  const specialTipi = ["ingresso", "uscita", "bagno", "servizio"];
  for (const s of Object.values(stanzeMap)) {
    if (specialTipi.includes(s.tipo)) {
      const obj = new Oggetto(s.nome, s, []);
      obj.visibile = false;
      s.oggetti.push(obj);
      oggettiList.push(obj);
    }
  }

  const stanzeList = Object.values(stanzeMap);
  const corridoi = buildLayout(stanzeList);

  for (const o of oggettiList) {
    if (specialTipi.includes(o.stanza.tipo)) {
      const s = o.stanza;
      o.pos = [s.x + s.w / 2, s.y + s.h / 2];
    }
  }

  const w = Math.max(...stanzeList.map((s) => s.x + s.w)) + 200;
  const h = Math.max(...stanzeList.map((s) => s.y + s.h)) + 200;

  let svg = svgHeader(data.nome || "Museo", w, h);
  svg = draw(svg, stanzeList, corridoi, oggettiList, edgeMode, edgeFocus);
  svg += svgFooter();

  return svg;
}

// ============================================================
// APP
// ============================================================

const app = express();
app.use(cors({ origin: "*", allowedHeaders: ["Content-Type", "X-API-KEY"], methods: ["GET", "OPTIONS"] }));

log(`SVG SERVER avviato su http://${HOST}:${PORT}`);
log(`JSON SERVER -> ${JSON_SERVER}`);

// ============================================================
// ROUTES
// ============================================================

app.get("/favicon.ico", (_req, res) => res.status(204).end());

// /<nomeMuseo>
// /<nomeMuseo>/<edgeMode>
// /<nomeMuseo>/<edgeMode>/<f1>/<f2>
app.get("/:nomeMuseo/:edgeMode?/:f1?/:f2?", async (req, res) => {
  const { nomeMuseo, edgeMode: edgeModeParam, f1, f2 } = req.params;

  const edgeMode = edgeModeParam || EDGE_MODE_DEFAULT;
  const edgeFocus = f1 && f2 ? [f1, f2] : EDGE_FOCUS_DEFAULT;

  // Recupera layout da Mongo
  let layoutMuseo;
  try {
    layoutMuseo = await getLayoutForMuseo(nomeMuseo);
  } catch (e) {
    return jsonError(res, 404, "Layout museo non trovato", e.message);
  }

  // Chiama il server JSON
  const url = `${JSON_SERVER}/musei/${nomeMuseo}`;
  const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };

  let r;
  try {
    r = await fetch(url, { headers, agent: httpsAgent, timeout: REQUEST_TIMEOUT });
  } catch {
    return jsonError(res, 502, "Connessione al server JSON fallita");
  }

  if (r.status !== 200) {
    return jsonError(res, r.status, "Errore server JSON", null, r.status);
  }

  let data;
  try {
    data = await r.json();
  } catch {
    return jsonError(res, 502, "JSON non valido dal server JSON");
  }

  // Genera SVG
  let svg;
  try {
    svg = generaSvg(data, layoutMuseo, edgeMode, edgeFocus);
  } catch (e) {
    console.error(e);
    return jsonError(res, 500, "Errore generazione SVG", e.message);
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ============================================================
// MAIN
// ============================================================

(async () => {
  await connectMongo();
  await waitForNodeServer();
  app.listen(PORT, HOST, () => {
    log(`Server in ascolto su http://${HOST}:${PORT}`);
  });
})();
