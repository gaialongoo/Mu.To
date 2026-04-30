const cors = require("cors");
const https = require("https");
const express = require("express");
const crypto = require("crypto");
const { MongoClient, ObjectId } = require("mongodb");
const { caricaMuseiDaJSON } = require("./parser_musei.js");
const { SistemaMusei } = require("./sistema_musei.js");
const { upsertMuseo, syncMuseiSuMongo } = require("./mongo_upload.js");
const { syncLayoutSuMongo } = require("./layout_upload.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: __dirname + "/.env" });
const multer = require("multer");
const sharp = require("sharp");
const pkg = require("./package.json");

// ============================================================
// CONFIG DA .ENV
// ============================================================
const API_KEY   = process.env.API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const PORT      = process.env.API_PORT || 3000;
const HOST      = process.env.API_HOST || "0.0.0.0";

if (!API_KEY)   { console.error("❌ API_KEY mancante nel .env");   process.exit(1); }
if (!MONGO_URI) { console.error("❌ MONGO_URI mancante nel .env"); process.exit(1); }

const VALID_API_KEYS = [API_KEY];

const FILE_JSON   = path.join(__dirname, "musei.json");
const LAYOUT_FILE = path.join(__dirname, "layout.json");
const DEFAULT_TEXT_PREVIEW_PATH = path.resolve(__dirname, "../../foto/pt.png");
const DB_NAME = "musei";
const MUSEI_COLLECTION = "musei_db";
const LAYOUT_COLLECTION = "musei_layout";
const USERS_DB_NAME = "utenti";
const USERS_COLLECTION = "users";
const SESSIONS_COLLECTION = "sessions";
const PROFESSOR_CODES_COLLECTION = "professor_codes";
const GUIDED_VISITS_COLLECTION = "guided_visits";
const SESSION_COOKIE_NAME = "muto_auth";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const ALLOWED_INTERESTS = [
  "storia",
  "storia_arte",
  "vita_artista",
  "tecniche_materiali",
  "estetica",
  "sensorialita",
  "filosofia_significato",
  "moda_costumi",
];
const ALLOWED_LEVELS = ["bambino", "studente", "esperto", "avanzato"];
const ALLOWED_DURATIONS = ["corto", "medio", "lungo"];

function normalizePrezzo(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function normalizePercorso(percorso = {}) {
  return {
    nome: String(percorso.nome || "").trim(),
    oggetti: Array.isArray(percorso.oggetti) ? percorso.oggetti : [],
    prezzo: normalizePrezzo(percorso.prezzo),
  };
}

function percorsoPurchaseKey(museoNome, percorsoNome) {
  return `${String(museoNome || "").trim()}::${String(percorsoNome || "").trim()}`;
}

function parseCookieHeader(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return acc;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function setAuthCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, storedHash] = String(encoded || "").split(":");
  if (!salt || !storedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hashProfessorCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim()).digest("hex");
}

async function isValidProfessorCode(code) {
  const raw = String(code || "").trim();
  if (!raw) return false;
  const hash = hashProfessorCode(raw);
  return withUsersDb(async (db) => {
    const doc = await db.collection(PROFESSOR_CODES_COLLECTION).findOne({ hash, enabled: true });
    return !!doc;
  });
}

function normalizeUserInput(body = {}) {
  const nome = String(body.nome || "").trim();
  const cognome = String(body.cognome || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const eta = Number(body.eta);
  const interessiRaw = Array.isArray(body.interessi) ? body.interessi : [];
  const interessi = interessiRaw
    .map((it) => String(it || "").trim().toLowerCase())
    .filter((it) => ALLOWED_INTERESTS.includes(it));
  const livello = String(body.livello || "").trim().toLowerCase();
  const durata = String(body.durata || "").trim().toLowerCase();
  return { nome, cognome, email, password, eta, interessi, livello, durata };
}

function userPublicView(user) {
  return {
    id: String(user._id),
    nome: user.nome,
    cognome: user.cognome,
    email: user.email,
    eta: user.eta,
    interessi: user.interessi || [],
    livello: user.livello || "",
    durata: user.durata || "",
    ruolo: user.ruolo,
    percorsiAcquistati: user.percorsiAcquistati || [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isProfessor(user) {
  return String(user?.ruolo || "").toLowerCase() === "professore";
}

function sanitizeGuidedVisitStep(step = {}, fallbackIndex = 0) {
  const type = String(step?.type || "object").trim().toLowerCase() === "text" ? "text" : "object";
  const room = String(step?.room || "").trim();
  const label = String(step?.label || "").trim();
  const customDescription = String(step?.customDescription || "").trim();
  const objectName = String(step?.objectName || "").trim();
  const text = String(step?.text || "").trim();
  return {
    id: String(step?.id || `step_${fallbackIndex + 1}`).trim(),
    type,
    room,
    label,
    objectName: type === "object" ? objectName : "",
    text: type === "text" ? text : "",
    customDescription,
    icon: type === "text" ? "?" : "object",
  };
}

function sanitizeQuiz(quiz = {}) {
  const title = String(quiz?.title || "").trim();
  const questionsRaw = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const questions = questionsRaw
    .map((q, idx) => {
      const question = String(q?.question || "").trim();
      const options = Array.isArray(q?.options)
        ? q.options.map((opt) => String(opt || "").trim()).filter(Boolean)
        : [];
      const correctIndex = Number(q?.correctIndex);
      return {
        id: String(q?.id || `q_${idx + 1}`).trim(),
        question,
        options,
        correctIndex: Number.isInteger(correctIndex) ? correctIndex : -1,
      };
    })
    .filter((q) => q.question && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length);

  const timeLimitSec = Math.max(10, Number(quiz?.timeLimitSec) || 120);
  return { title, questions, timeLimitSec };
}

function sanitizeGuidedVisitInput(body = {}) {
  const museo = String(body?.museo || "").trim();
  const nome = String(body?.nome || "").trim();
  const stepsRaw = Array.isArray(body?.steps) ? body.steps : [];
  const steps = stepsRaw
    .map((step, idx) => sanitizeGuidedVisitStep(step, idx))
    .filter((step) => (step.type === "object" ? !!step.objectName : !!step.text));
  const quiz = sanitizeQuiz(body?.quiz || {});
  return { museo, nome, steps, quiz };
}

async function withUsersDb(run) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    return await run(client.db(USERS_DB_NAME));
  } finally {
    await client.close();
  }
}

async function getSessionUser(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  return withUsersDb(async (db) => {
    const sessionsCol = db.collection(SESSIONS_COLLECTION);
    const usersCol = db.collection(USERS_COLLECTION);
    const now = new Date();
    const session = await sessionsCol.findOne({ token, expiresAt: { $gt: now } });
    if (!session) return null;
    const user = await usersCol.findOne({ _id: session.userId });
    if (!user) return null;
    return { token, user };
  });
}

async function ensureUserIndexes() {
  await withUsersDb(async (db) => {
    await db.collection(USERS_COLLECTION).createIndex({ email: 1 }, { unique: true });
    await db.collection(SESSIONS_COLLECTION).createIndex({ token: 1 }, { unique: true });
    await db.collection(SESSIONS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection(PROFESSOR_CODES_COLLECTION).createIndex({ hash: 1 }, { unique: true });
    await db.collection(PROFESSOR_CODES_COLLECTION).createIndex({ enabled: 1 });
    await db.collection(GUIDED_VISITS_COLLECTION).createIndex({ teacherId: 1, createdAt: -1 });
    await db.collection(GUIDED_VISITS_COLLECTION).createIndex({ participantsToken: 1 });
  });
}

function parseCliArgs(argv) {
  const args = { bootstrapMode: "disk-override", help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
    else if (arg === "--bootstrap-mode" && argv[i + 1]) args.bootstrapMode = argv[++i];
    else if (arg.startsWith("--bootstrap-mode=")) args.bootstrapMode = arg.split("=")[1];
  }
  return args;
}

function printHelp() {
  console.log(`Sistema Musei API v${pkg.version}

Uso:
  node openAPI_server.js [opzioni]

Opzioni:
  -h, --help                     Mostra questo help
  -v, --version                  Mostra la versione
  --bootstrap-mode <mode>        Strategia di bootstrap dati all'avvio
                                 Mode disponibili:
                                   disk-override  Carica da musei.json/layout.json e forza sync su MongoDB
                                   mongo          Carica da MongoDB e salva snapshot su musei.json/layout.json
`);
}

function readLayoutStore(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ layout.json non valido: ${err.message}`);
    return {};
  }
}

function saveLayoutStore(filePath, layoutStore) {
  fs.writeFileSync(filePath, JSON.stringify(layoutStore, null, 2), "utf-8");
}

async function loadSistemaFromMongo() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const docs = await client.db(DB_NAME).collection(MUSEI_COLLECTION).find({}).toArray();
    const sistema = new SistemaMusei();
    for (const d of docs) {
      sistema.aggiungi_museo({
        nome: d.nome,
        citta: d.citta,
        oggetti: d.oggetti || [],
        percorsi: d.percorsi || [],
      });
    }
    return sistema;
  } finally {
    await client.close();
  }
}

async function loadLayoutStoreFromMongo() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const docs = await client.db(DB_NAME).collection(LAYOUT_COLLECTION).find({}).toArray();
    const layoutStore = {};
    for (const doc of docs) {
      const { _id, ...rest } = doc;
      layoutStore[_id] = rest;
    }
    return layoutStore;
  } finally {
    await client.close();
  }
}

// ============================================================
// APP EXPRESS
// ============================================================
const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-API-Key"],
}));

app.disable("x-powered-by");
app.disable("etag");

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
  
  // Esenta i GET delle immagini (stanze e oggetti) dall'API Key
  // per permettere al browser di caricarle via <img> / <image>
  const isImageGet = req.method === "GET" && (
    req.url.includes("/immagini/") || 
    req.url.includes("/preview")
  );
  
  if (isImageGet) return next();

  const apiKey = req.header("X-API-Key");
  if (!apiKey) return res.status(401).json({ error: "API key mancante" });
  if (!VALID_API_KEYS.includes(apiKey)) return res.status(403).json({ error: "API key non valida" });
  next();
});

// ============================================================
// AVVIO ASINCRONO
// ============================================================
async function startServer(cliOptions) {

  // --- ✅ Check MongoDB ---
  console.log(`🔌 Verifica MongoDB su ${MONGO_URI}...`);
  const probe = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    await probe.connect();
    await probe.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB raggiungibile");
  } catch (err) {
    console.error("❌ MongoDB non raggiungibile:", err.message);
    console.error("   Controlla MONGO_URI nel .env e che il servizio sia attivo.");
    process.exit(1);
  } finally {
    await probe.close();
  }
  await ensureUserIndexes();
  console.log("✅ Indici utenti/sessioni pronti");

  // --- Caricamento dati bootstrap ---
  let sistema;
  let layoutStore;
  if (cliOptions.bootstrapMode === "mongo") {
    console.log("☁️ Bootstrap da MongoDB (musei + layout), con snapshot locale su disco");
    sistema = await loadSistemaFromMongo();
    layoutStore = await loadLayoutStoreFromMongo();
    sistema.salvaSuFile(FILE_JSON);
    saveLayoutStore(LAYOUT_FILE, layoutStore);
  } else {
    console.log("📂 Bootstrap da file locali (disk-override) e sync su MongoDB");
    sistema = caricaMuseiDaJSON(FILE_JSON);
    layoutStore = readLayoutStore(LAYOUT_FILE);
    syncMuseiSuMongo(sistema);
    syncLayoutSuMongo(LAYOUT_FILE);
  }
  console.log(`✅ Sistema pronto con ${sistema.musei.size} musei`);

  // ==========================================================
  // ROUTE — USERS / AUTH
  // ==========================================================

  app.post("/users/register", async (req, res) => {
    try {
      const input = normalizeUserInput(req.body);
      const codiceRuolo = String(req.body?.codiceRuolo || "");

      if (!input.nome || !input.cognome || !input.email || !input.password) {
        return res.status(400).json({ error: "nome, cognome, email e password sono obbligatori" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        return res.status(400).json({ error: "email non valida" });
      }
      if (input.password.length < 8) {
        return res.status(400).json({ error: "password troppo corta (minimo 8 caratteri)" });
      }
      if (!Number.isFinite(input.eta) || input.eta < 1 || input.eta > 120) {
        return res.status(400).json({ error: "eta non valida" });
      }
      if (input.interessi.length < 1) {
        return res.status(400).json({ error: "seleziona almeno un interesse" });
      }
      if (input.livello && !ALLOWED_LEVELS.includes(input.livello)) {
        return res.status(400).json({ error: "livello non valido" });
      }
      if (input.durata && !ALLOWED_DURATIONS.includes(input.durata)) {
        return res.status(400).json({ error: "durata non valida" });
      }

      let ruolo = "utente";
      if (codiceRuolo) {
        const ok = await isValidProfessorCode(codiceRuolo);
        if (!ok) {
          return res.status(403).json({ error: "codice professore non valido" });
        }
        ruolo = "professore";
      }

      const now = new Date();
      const userDoc = {
        nome: input.nome,
        cognome: input.cognome,
        email: input.email,
        passwordHash: hashPassword(input.password),
        interessi: input.interessi,
        livello: input.livello || "",
        durata: input.durata || "",
        eta: input.eta,
        ruolo,
        percorsiAcquistati: [],
        createdAt: now,
        updatedAt: now,
      };

      const created = await withUsersDb(async (db) => {
        const result = await db.collection(USERS_COLLECTION).insertOne(userDoc);
        return db.collection(USERS_COLLECTION).findOne({ _id: result.insertedId });
      });
      res.status(201).json({ user: userPublicView(created) });
    } catch (err) {
      if (String(err.message || "").includes("E11000")) {
        return res.status(409).json({ error: "email gia registrata" });
      }
      console.error("Errore register:", err.message);
      res.status(500).json({ error: "errore creazione utente" });
    }
  });

  app.post("/users/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) {
        return res.status(400).json({ error: "email e password obbligatorie" });
      }

      const { user, token } = await withUsersDb(async (db) => {
        const usersCol = db.collection(USERS_COLLECTION);
        const sessionsCol = db.collection(SESSIONS_COLLECTION);
        const userDoc = await usersCol.findOne({ email });
        if (!userDoc || !verifyPassword(password, userDoc.passwordHash)) return { user: null, token: null };

        const sessionToken = crypto.randomBytes(32).toString("hex");
        await sessionsCol.insertOne({
          token: sessionToken,
          userId: userDoc._id,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        return { user: userDoc, token: sessionToken };
      });

      if (!user || !token) return res.status(401).json({ error: "credenziali non valide" });
      setAuthCookie(res, token);
      res.json({ user: userPublicView(user) });
    } catch (err) {
      console.error("Errore login:", err.message);
      res.status(500).json({ error: "errore login" });
    }
  });

  app.post("/users/logout", async (req, res) => {
    try {
      const cookies = parseCookieHeader(req.headers.cookie || "");
      const token = cookies[SESSION_COOKIE_NAME];
      if (token) {
        await withUsersDb(async (db) => {
          await db.collection(SESSIONS_COLLECTION).deleteOne({ token });
        });
      }
      clearAuthCookie(res);
      res.json({ message: "logout effettuato" });
    } catch (err) {
      console.error("Errore logout:", err.message);
      res.status(500).json({ error: "errore logout" });
    }
  });

  app.get("/users/me", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      res.json({ user: userPublicView(session.user) });
    } catch (err) {
      console.error("Errore me:", err.message);
      res.status(500).json({ error: "errore recupero profilo" });
    }
  });

  app.get("/users/me/percorsi", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const museo = String(req.query?.museo || "").trim();
      const purchased = Array.isArray(session.user.percorsiAcquistati) ? session.user.percorsiAcquistati : [];
      const filtered = museo ? purchased.filter((p) => p?.museo === museo) : purchased;
      const keys = filtered.map((p) => percorsoPurchaseKey(p.museo, p.percorso));
      res.json({ percorsiAcquistati: filtered, chiaviAcquisto: keys });
    } catch (err) {
      console.error("Errore lista percorsi acquistati:", err.message);
      res.status(500).json({ error: "errore recupero percorsi acquistati" });
    }
  });

  app.post("/users/me/percorsi/acquista", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });

      const nomeMuseo = String(req.body?.museo || "").trim();
      const nomePercorso = String(req.body?.percorso || "").trim();
      if (!nomeMuseo || !nomePercorso) {
        return res.status(400).json({ error: "museo e percorso sono obbligatori" });
      }

      const museo = sistema.get_museo(nomeMuseo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      if (!museo.percorsi) museo.percorsi = [];
      const percorso = museo.percorsi.find((p) => p.nome === nomePercorso);
      if (!percorso) return res.status(404).json({ error: "Percorso non trovato" });
      const percorsoNorm = normalizePercorso(percorso);
      if (percorsoNorm.prezzo <= 0) {
        return res.status(400).json({ error: "Il percorso e gia incluso nell'account" });
      }

      const key = percorsoPurchaseKey(nomeMuseo, nomePercorso);
      const existing = Array.isArray(session.user.percorsiAcquistati) ? session.user.percorsiAcquistati : [];
      if (existing.some((p) => percorsoPurchaseKey(p.museo, p.percorso) === key)) {
        return res.json({ giaAcquistato: true, acquisto: existing.find((p) => percorsoPurchaseKey(p.museo, p.percorso) === key) });
      }

      const userId = new ObjectId(String(session.user._id));
      const acquisto = {
        museo: nomeMuseo,
        percorso: nomePercorso,
        prezzo: percorsoNorm.prezzo,
        purchasedAt: new Date(),
      };
      await withUsersDb(async (db) => {
        await db.collection(USERS_COLLECTION).updateOne(
          { _id: userId },
          { $push: { percorsiAcquistati: acquisto }, $set: { updatedAt: new Date() } }
        );
      });
      res.status(201).json({ giaAcquistato: false, acquisto });
    } catch (err) {
      console.error("Errore acquisto percorso:", err.message);
      res.status(500).json({ error: "errore acquisto percorso" });
    }
  });

  app.put("/users/me", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (req.body?.ruolo && String(req.body.ruolo).toLowerCase() !== session.user.ruolo) {
        return res.status(403).json({ error: "ruolo non modificabile via API" });
      }

      const input = normalizeUserInput({
        ...session.user,
        ...req.body,
        email: session.user.email,
      });
      if (!Number.isFinite(input.eta) || input.eta < 1 || input.eta > 120) {
        return res.status(400).json({ error: "eta non valida" });
      }
      if (input.interessi.length < 1) {
        return res.status(400).json({ error: "seleziona almeno un interesse" });
      }
      if (input.livello && !ALLOWED_LEVELS.includes(input.livello)) {
        return res.status(400).json({ error: "livello non valido" });
      }
      if (input.durata && !ALLOWED_DURATIONS.includes(input.durata)) {
        return res.status(400).json({ error: "durata non valida" });
      }

      const userId = new ObjectId(String(session.user._id));
      const updated = await withUsersDb(async (db) => {
        await db.collection(USERS_COLLECTION).updateOne(
          { _id: userId },
          {
            $set: {
              nome: input.nome,
              cognome: input.cognome,
              eta: input.eta,
              interessi: input.interessi,
              livello: input.livello || "",
              durata: input.durata || "",
              updatedAt: new Date(),
            },
          }
        );
        return db.collection(USERS_COLLECTION).findOne({ _id: userId });
      });
      res.json({ user: userPublicView(updated) });
    } catch (err) {
      console.error("Errore update profilo:", err.message);
      res.status(500).json({ error: "errore aggiornamento profilo" });
    }
  });

  // ==========================================================
  // ROUTE — GUIDED VISITS (PROFESSORI / STUDENTI)
  // ==========================================================
  app.get("/users/me/guided-visits", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visits = await withUsersDb(async (db) =>
        db
          .collection(GUIDED_VISITS_COLLECTION)
          .find({ teacherId: String(session.user._id) }, { sort: { createdAt: -1 } })
          .project({ _id: 1, museo: 1, nome: 1, steps: 1, quiz: 1, createdAt: 1, updatedAt: 1 })
          .toArray()
      );
      res.json({
        visits: visits.map((v) => ({
          id: String(v._id),
          museo: v.museo,
          nome: v.nome,
          steps: Array.isArray(v.steps) ? v.steps : [],
          quiz: v.quiz || { title: "", questions: [], timeLimitSec: 120 },
          navigationStarted: !!v.navigationStarted,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          shareToken: `gv:${String(v._id)}`,
        })),
      });
    } catch (err) {
      console.error("Errore guided visits professore:", err.message);
      res.status(500).json({ error: "errore recupero visite guidate" });
    }
  });

  app.post("/guided-visits", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono creare visite" });

      const input = sanitizeGuidedVisitInput(req.body);
      if (!input.museo || !input.nome) return res.status(400).json({ error: "museo e nome sono obbligatori" });
      if (input.steps.length < 1) return res.status(400).json({ error: "aggiungi almeno uno step" });
      const museo = sistema.get_museo(input.museo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      for (const step of input.steps) {
        if (step.type === "object" && !museo.get_oggetto(step.objectName)) {
          return res.status(404).json({ error: `Oggetto '${step.objectName}' non trovato` });
        }
      }

      const now = new Date();
      const doc = {
        teacherId: String(session.user._id),
        teacherName: `${session.user.nome || ""} ${session.user.cognome || ""}`.trim(),
        museo: input.museo,
        nome: input.nome,
        steps: input.steps,
        quiz: input.quiz,
        currentStepIndex: 0,
        navigationStarted: false,
        participants: [],
        quizState: { status: "idle", startedAt: null, endsAt: null, timeLimitSec: input.quiz.timeLimitSec || 120 },
        createdAt: now,
        updatedAt: now,
      };

      const created = await withUsersDb(async (db) => {
        const result = await db.collection(GUIDED_VISITS_COLLECTION).insertOne(doc);
        return db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: result.insertedId });
      });

      res.status(201).json({ visit: { id: String(created._id), ...doc, shareToken: `gv:${String(created._id)}` } });
    } catch (err) {
      console.error("Errore creazione guided visit:", err.message);
      res.status(500).json({ error: "errore creazione visita guidata" });
    }
  });

  app.put("/guided-visits/:id", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono modificare visite" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const input = sanitizeGuidedVisitInput(req.body);
      if (!input.museo || !input.nome) return res.status(400).json({ error: "museo e nome sono obbligatori" });
      if (input.steps.length < 1) return res.status(400).json({ error: "aggiungi almeno uno step" });
      const museo = sistema.get_museo(input.museo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      for (const step of input.steps) {
        if (step.type === "object" && !museo.get_oggetto(step.objectName)) {
          return res.status(404).json({ error: `Oggetto '${step.objectName}' non trovato` });
        }
      }

      const updated = await withUsersDb(async (db) => {
        const col = db.collection(GUIDED_VISITS_COLLECTION);
        const current = await col.findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) });
        if (!current) return null;
        if (current.navigationStarted) return { _locked: true };
        await col.updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          {
            $set: {
              museo: input.museo,
              nome: input.nome,
              steps: input.steps,
              quiz: input.quiz,
              "quizState.timeLimitSec": input.quiz.timeLimitSec || 120,
              updatedAt: new Date(),
            },
          }
        );
        return col.findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) });
      });
      if (updated?._locked) {
        return res.status(409).json({ error: "visita gia avviata: non piu modificabile" });
      }
      if (!updated) return res.status(404).json({ error: "visita guidata non trovata" });
      res.json({ visit: { id: String(updated._id), ...updated, shareToken: `gv:${String(updated._id)}` } });
    } catch (err) {
      console.error("Errore update guided visit:", err.message);
      res.status(500).json({ error: "errore aggiornamento visita guidata" });
    }
  });

  app.get("/guided-visits/:id/public", async (req, res) => {
    try {
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const visit = await withUsersDb(async (db) => db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId) }));
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      res.json({
        visit: {
          id: String(visit._id),
          museo: visit.museo,
          nome: visit.nome,
          teacherName: visit.teacherName || "Professore",
          stepsCount: Array.isArray(visit.steps) ? visit.steps.length : 0,
          virtualObjects: Array.isArray(visit.steps)
            ? visit.steps.reduce((acc, step, idx) => {
                if (!step || step.type !== "text") return acc;
                const nodeName = `__text__${idx + 1}`;
                const room = String(step.room || "").trim();
                if (!room) return acc;
                acc[nodeName] = {
                  room,
                  label: "?",
                  text: String(step.text || ""),
                  descrizioni: [[String(step.text || "")]],
                };
                return acc;
              }, {})
            : {},
        },
      });
    } catch (err) {
      console.error("Errore public guided visit:", err.message);
      res.status(500).json({ error: "errore recupero visita guidata" });
    }
  });

  app.post("/guided-visits/:id/join", async (req, res) => {
    try {
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const displayName = String(req.body?.displayName || "").trim();
      if (!displayName) return res.status(400).json({ error: "nome studente obbligatorio" });
      const token = crypto.randomBytes(24).toString("hex");
      const participant = {
        id: crypto.randomBytes(12).toString("hex"),
        token,
        displayName,
        status: "waiting",
        joinedAt: new Date(),
        answers: [],
        grade: null,
      };

      const updated = await withUsersDb(async (db) => {
        const col = db.collection(GUIDED_VISITS_COLLECTION);
        await col.updateOne(
          { _id: new ObjectId(visitId) },
          { $push: { participants: participant }, $set: { updatedAt: new Date() } }
        );
        return col.findOne({ _id: new ObjectId(visitId) });
      });
      if (!updated) return res.status(404).json({ error: "visita guidata non trovata" });
      res.status(201).json({ participantToken: token, participantId: participant.id, status: participant.status });
    } catch (err) {
      console.error("Errore join guided visit:", err.message);
      res.status(500).json({ error: "errore ingresso visita guidata" });
    }
  });

  app.get("/guided-visits/:id/teacher-state", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      res.json({
        visit: {
          id: String(visit._id),
          museo: visit.museo,
          nome: visit.nome,
          steps: visit.steps || [],
          currentStepIndex: visit.currentStepIndex || 0,
          navigationStarted: !!visit.navigationStarted,
          participants: Array.isArray(visit.participants) ? visit.participants.map((p) => ({
            id: p.id, displayName: p.displayName, status: p.status, grade: p.grade ?? null, joinedAt: p.joinedAt,
          })) : [],
          quiz: visit.quiz || { title: "", questions: [], timeLimitSec: 120 },
          quizState: visit.quizState || { status: "idle", startedAt: null, endsAt: null, timeLimitSec: 120 },
        },
      });
    } catch (err) {
      console.error("Errore teacher state guided visit:", err.message);
      res.status(500).json({ error: "errore stato visita guidata" });
    }
  });

  app.post("/guided-visits/:id/participants/:participantId/accept", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      const participantId = String(req.params.participantId || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      await withUsersDb(async (db) => {
        const col = db.collection(GUIDED_VISITS_COLLECTION);
        const visit = await col.findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) });
        if (!visit) return;
        const steps = Array.isArray(visit.steps) ? visit.steps : [];
        const firstObjectStep = steps.find((s) => s.type === "object" && s.objectName);
        const firstObjectName = String(firstObjectStep?.objectName || "").trim();
        const firstStepIndex = Math.max(0, steps.findIndex((s) => s.type === "object" && String(s.objectName || "").trim() === firstObjectName));
        const setData = { "participants.$.status": "accepted", updatedAt: new Date() };
        if (!visit.navigationStarted && firstObjectName) {
          setData.navigationStarted = true;
          setData.currentStepIndex = firstStepIndex;
          setData.navigationNode = firstObjectName;
        }
        await col.updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id), "participants.id": participantId },
          { $set: setData }
        );
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("Errore accept participant:", err.message);
      res.status(500).json({ error: "errore accettazione studente" });
    }
  });

  app.post("/guided-visits/:id/participants/accept-all", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const visit = await withUsersDb(async (db) => {
        const col = db.collection(GUIDED_VISITS_COLLECTION);
        const current = await col.findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) });
        if (!current) return null;
        const participants = Array.isArray(current.participants) ? current.participants : [];
        const nextParticipants = participants.map((p) => (p.status === "waiting" ? { ...p, status: "accepted" } : p));
        const steps = Array.isArray(current.steps) ? current.steps : [];
        const firstObjectStep = steps.find((s) => s.type === "object" && s.objectName);
        const firstObjectName = String(firstObjectStep?.objectName || "").trim();
        const firstStepIndex = Math.max(0, steps.findIndex((s) => s.type === "object" && String(s.objectName || "").trim() === firstObjectName));
        const setData = { participants: nextParticipants, updatedAt: new Date() };
        if (!current.navigationStarted && firstObjectName && nextParticipants.some((p) => p.status === "accepted")) {
          setData.navigationStarted = true;
          setData.currentStepIndex = firstStepIndex;
          setData.navigationNode = firstObjectName;
        }
        await col.updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          { $set: setData }
        );
        return true;
      });
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      res.json({ ok: true });
    } catch (err) {
      console.error("Errore accept all participants:", err.message);
      res.status(500).json({ error: "errore accettazione studenti" });
    }
  });

  app.post("/guided-visits/:id/participants/:participantId/remove", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      const participantId = String(req.params.participantId || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      await withUsersDb(async (db) => {
        await db.collection(GUIDED_VISITS_COLLECTION).updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id), "participants.id": participantId },
          { $set: { "participants.$.status": "removed", updatedAt: new Date() } }
        );
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("Errore remove participant:", err.message);
      res.status(500).json({ error: "errore rimozione studente" });
    }
  });

  app.post("/guided-visits/:id/navigation", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const stepIndex = Math.max(0, Number(req.body?.stepIndex) || 0);
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const steps = Array.isArray(visit.steps) ? visit.steps : [];
      if (stepIndex >= steps.length) return res.status(400).json({ error: "stepIndex non valido" });
      await withUsersDb(async (db) => {
        await db.collection(GUIDED_VISITS_COLLECTION).updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          {
            $set: {
              currentStepIndex: stepIndex,
              navigationNode:
                String(steps?.[stepIndex]?.type || "") === "text"
                  ? `__text__${stepIndex + 1}`
                  : String((steps[stepIndex] && steps[stepIndex].objectName) || ""),
              navigationStarted: true,
              updatedAt: new Date(),
            },
          }
        );
      });
      res.json({ ok: true, stepIndex });
    } catch (err) {
      console.error("Errore navigation guided visit:", err.message);
      res.status(500).json({ error: "errore aggiornamento navigazione" });
    }
  });

  app.post("/guided-visits/:id/navigation/by-object", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      const objectName = String(req.body?.objectName || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      if (!objectName) return res.status(400).json({ error: "objectName obbligatorio" });
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const steps = Array.isArray(visit.steps) ? visit.steps : [];
      const stepIndex = steps.findIndex((s) => s.type === "object" && String(s.objectName || "").trim() === objectName);
      if (stepIndex < 0) return res.status(404).json({ error: "oggetto non trovato nella visita" });
      await withUsersDb(async (db) => {
        await db.collection(GUIDED_VISITS_COLLECTION).updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          {
            $set: {
              currentStepIndex: stepIndex,
              navigationNode: objectName,
              navigationStarted: true,
              updatedAt: new Date(),
            },
          }
        );
      });
      res.json({ ok: true, stepIndex });
    } catch (err) {
      console.error("Errore navigation by object guided visit:", err.message);
      res.status(500).json({ error: "errore aggiornamento navigazione oggetto" });
    }
  });

  app.post("/guided-visits/:id/navigation/by-node", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      const nodeName = String(req.body?.nodeName || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      if (!nodeName) return res.status(400).json({ error: "nodeName obbligatorio" });
      const allowedSpecial = ["IN", "OUT", "SHOP", "WC"];
      const upperNode = nodeName.toUpperCase();
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const steps = Array.isArray(visit.steps) ? visit.steps : [];
      const objectSteps = steps.filter((s) => s.type === "object" && s.objectName);
      const objectNames = objectSteps.map((s) => String(s.objectName || "").trim()).filter(Boolean);
      const isSpecial = allowedSpecial.includes(upperNode);
      const isKnownObject = objectNames.includes(nodeName);
      if (!isSpecial && !isKnownObject) return res.status(404).json({ error: "nodo non presente nella visita" });
      const stepIndex = isKnownObject
        ? steps.findIndex((s) => s.type === "object" && String(s.objectName || "").trim() === nodeName)
        : Math.max(0, steps.length - 1);
      await withUsersDb(async (db) => {
        await db.collection(GUIDED_VISITS_COLLECTION).updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          {
            $set: {
              currentStepIndex: stepIndex,
              navigationNode: isSpecial ? upperNode : nodeName,
              navigationStarted: true,
              updatedAt: new Date(),
            },
          }
        );
      });
      res.json({ ok: true, stepIndex, navigationNode: isSpecial ? upperNode : nodeName });
    } catch (err) {
      console.error("Errore navigation by node guided visit:", err.message);
      res.status(500).json({ error: "errore aggiornamento navigazione nodo" });
    }
  });

  app.post("/guided-visits/:id/quiz/start", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const now = Date.now();
      const customSec = Number(req.body?.timeLimitSec);
      const sec = Math.max(10, Number.isFinite(customSec) ? customSec : 0);
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const q = visit.quiz || {};
      const defaultSec = Math.max(10, Number(q.timeLimitSec) || 120);
      const finalSec = Number.isFinite(customSec) ? sec : defaultSec;
      await withUsersDb(async (db) => {
        await db.collection(GUIDED_VISITS_COLLECTION).updateOne(
          { _id: new ObjectId(visitId), teacherId: String(session.user._id) },
          {
            $set: {
              quizState: {
                status: "running",
                startedAt: new Date(now),
                endsAt: new Date(now + finalSec * 1000),
                timeLimitSec: finalSec,
              },
              updatedAt: new Date(),
            },
          }
        );
      });
      res.json({ ok: true, timeLimitSec: finalSec });
    } catch (err) {
      console.error("Errore start quiz guided visit:", err.message);
      res.status(500).json({ error: "errore avvio quiz" });
    }
  });

  app.get("/guided-visits/:id/student-state", async (req, res) => {
    try {
      const visitId = String(req.params.id || "").trim();
      const participantToken = String(req.query?.participantToken || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      if (!participantToken) return res.status(400).json({ error: "participantToken obbligatorio" });
      const visit = await withUsersDb(async (db) => db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId) }));
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const participants = Array.isArray(visit.participants) ? visit.participants : [];
      const participant = participants.find((p) => p.token === participantToken);
      if (!participant) return res.status(404).json({ error: "partecipante non trovato" });

      const steps = Array.isArray(visit.steps) ? visit.steps : [];
      const currentStepIndex = Math.max(0, Math.min(Number(visit.currentStepIndex) || 0, Math.max(steps.length - 1, 0)));
      const currentStep = steps[currentStepIndex] || null;
      const objectSteps = steps.filter((s) => s.type === "object" && s.objectName);
      const textSteps = steps.filter((s) => s.type === "text" && s.room && s.text);
      const percorso = ["IN", ...objectSteps.map((s) => s.objectName), "OUT"];
      const flowNodes = steps
        .map((s, idx) => (s.type === "object" && s.objectName ? String(s.objectName) : (s.type === "text" ? `__text__${idx + 1}` : "")))
        .filter(Boolean);
      const virtualObjects = {};
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s?.type !== "text") continue;
        const nodeName = `__text__${i + 1}`;
        const text = String(s.text || "").trim();
        const label = String(s.label || "").trim();
        virtualObjects[nodeName] = {
          room: String(s.room || "").trim(),
          label: label || "?",
          descrizioni: Array.from({ length: 4 }, () => [text, text, text]),
        };
      }
      const customDescriptions = objectSteps.reduce((acc, s) => {
        const key = String(s.objectName || "").trim();
        if (!key) return acc;
        acc[key] = String(s.customDescription || "").trim();
        return acc;
      }, {});
      const quizState = visit.quizState || { status: "idle", startedAt: null, endsAt: null, timeLimitSec: 120 };
      const objectStepsOrdered = steps.filter((s) => s.type === "object" && s.objectName);
      const objectNamesOrdered = objectStepsOrdered.map((s) => String(s.objectName || "").trim()).filter(Boolean);
      const objectCountUntilCurrent = steps.slice(0, currentStepIndex + 1).filter((s) => s.type === "object" && s.objectName).length;
      const currentObjectPos = Math.max(0, Math.min(objectCountUntilCurrent - 1, Math.max(objectNamesOrdered.length - 1, 0)));
      const navigationNode = String(visit.navigationNode || "").trim();
      const isSpecialNode = ["IN", "OUT", "SHOP", "WC"].includes(navigationNode.toUpperCase());
      const specialNode = navigationNode.toUpperCase();
      let currentObjectName = objectNamesOrdered[currentObjectPos] || null;
      let previousObjectName = currentObjectPos <= 0 ? "IN" : objectNamesOrdered[currentObjectPos - 1] || "IN";
      let nextObjectName = objectNamesOrdered[currentObjectPos + 1] || null;
      let currentRoom = "";
      if (isSpecialNode && specialNode === "OUT") {
        previousObjectName = objectNamesOrdered.length > 0 ? objectNamesOrdered[objectNamesOrdered.length - 1] : "IN";
        currentObjectName = "OUT";
        nextObjectName = null;
      } else if (!isSpecialNode && navigationNode && objectNamesOrdered.includes(navigationNode)) {
        const pos = objectNamesOrdered.indexOf(navigationNode);
        currentObjectName = objectNamesOrdered[pos];
        previousObjectName = pos <= 0 ? "IN" : objectNamesOrdered[pos - 1] || "IN";
        nextObjectName = objectNamesOrdered[pos + 1] || null;
      } else if (navigationNode && virtualObjects[navigationNode]) {
        const idx = flowNodes.indexOf(navigationNode);
        const prevNode = idx > 0 ? flowNodes[idx - 1] : "IN";
        const nextNode = idx >= 0 && idx < flowNodes.length - 1 ? flowNodes[idx + 1] : null;
        currentObjectName = navigationNode;
        previousObjectName = prevNode || "IN";
        nextObjectName = nextNode || null;
        currentRoom = String(virtualObjects[navigationNode]?.room || "");
      }

      res.json({
        status: participant.status,
        navigationStarted: !!visit.navigationStarted,
        currentStepIndex,
        currentStep,
        currentObjectName,
        previousObjectName,
        nextObjectName,
        currentRoom,
        percorso,
        flowNodes,
        customDescriptions,
        virtualObjects,
        textSteps: textSteps.map((s) => ({ id: s.id, room: s.room, text: s.text })),
        museo: visit.museo,
        quiz: visit.quiz || { title: "", questions: [], timeLimitSec: 120 },
        quizState,
        grade: participant.grade ?? null,
      });
    } catch (err) {
      console.error("Errore student state guided visit:", err.message);
      res.status(500).json({ error: "errore stato studente" });
    }
  });

  app.post("/guided-visits/:id/quiz/submit", async (req, res) => {
    try {
      const visitId = String(req.params.id || "").trim();
      const participantToken = String(req.body?.participantToken || "").trim();
      const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      if (!participantToken) return res.status(400).json({ error: "participantToken obbligatorio" });

      const result = await withUsersDb(async (db) => {
        const col = db.collection(GUIDED_VISITS_COLLECTION);
        const visit = await col.findOne({ _id: new ObjectId(visitId) });
        if (!visit) return { error: "not_found" };
        const participants = Array.isArray(visit.participants) ? visit.participants : [];
        const idx = participants.findIndex((p) => p.token === participantToken);
        if (idx < 0) return { error: "participant_not_found" };
        const participant = participants[idx];
        if (participant.status !== "accepted") return { error: "participant_not_accepted" };
        if (participant.quizSubmittedAt) return { error: "already_submitted" };
        const questions = Array.isArray(visit.quiz?.questions) ? visit.quiz.questions : [];
        const cleanAnswers = answers.map((a) => Number(a));
        let score = 0;
        for (let i = 0; i < questions.length; i++) {
          if (Number(questions[i]?.correctIndex) === cleanAnswers[i]) score += 1;
        }
        const grade = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
        participants[idx] = {
          ...participants[idx],
          answers: cleanAnswers,
          grade,
          quizSubmittedAt: new Date(),
        };
        await col.updateOne({ _id: new ObjectId(visitId) }, { $set: { participants, updatedAt: new Date() } });
        return { grade, score, total: questions.length };
      });
      if (result.error === "not_found") return res.status(404).json({ error: "visita guidata non trovata" });
      if (result.error === "participant_not_found") return res.status(404).json({ error: "partecipante non trovato" });
      if (result.error === "participant_not_accepted") return res.status(403).json({ error: "partecipante non autorizzato" });
      if (result.error === "already_submitted") return res.status(409).json({ error: "quiz gia inviato da questo studente" });
      res.json(result);
    } catch (err) {
      console.error("Errore submit quiz guided visit:", err.message);
      res.status(500).json({ error: "errore invio quiz" });
    }
  });

  app.delete("/guided-visits/:id", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const result = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).deleteOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!result.deletedCount) return res.status(404).json({ error: "visita guidata non trovata" });
      res.json({ ok: true });
    } catch (err) {
      console.error("Errore delete guided visit:", err.message);
      res.status(500).json({ error: "errore eliminazione visita guidata" });
    }
  });

  app.get("/guided-visits/:id/results", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isProfessor(session.user)) return res.status(403).json({ error: "solo i professori possono accedere" });
      const visitId = String(req.params.id || "").trim();
      if (!ObjectId.isValid(visitId)) return res.status(400).json({ error: "id visita non valido" });
      const visit = await withUsersDb(async (db) =>
        db.collection(GUIDED_VISITS_COLLECTION).findOne({ _id: new ObjectId(visitId), teacherId: String(session.user._id) })
      );
      if (!visit) return res.status(404).json({ error: "visita guidata non trovata" });
      const participants = Array.isArray(visit.participants) ? visit.participants : [];
      res.json({
        results: participants
          .filter((p) => p.status === "accepted" || p.status === "removed")
          .map((p) => ({ id: p.id, displayName: p.displayName, status: p.status, grade: p.grade ?? null, quizSubmittedAt: p.quizSubmittedAt || null })),
      });
    } catch (err) {
      console.error("Errore risultati guided visit:", err.message);
      res.status(500).json({ error: "errore recupero risultati" });
    }
  });

  // ==========================================================
  // ROUTE — GET
  // ==========================================================

  // 1️⃣ Lista musei
  app.get("/musei", (req, res) => {
    const musei = Array.from(sistema.musei.keys());
    console.log(`Restituisco ${musei.length} musei`);
    res.json({ musei });
  });

  // 2️⃣ JSON completo di un museo
  app.get("/musei/:nome_museo", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    console.log(`Restituisco dati museo '${museo.nome}'`);
    res.json({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values()),
      percorsi: museo.percorsi || [],
    });
  });

  // 3️⃣ Singolo oggetto
  app.get("/musei/:nome_museo/oggetti/:oggetto", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const oggetto = museo.get_oggetto(req.params.oggetto);
    if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });

    console.log(`Restituisco oggetto '${oggetto.nome}' del museo '${museo.nome}'`);
    res.json(oggetto);
  });

  // 4️⃣ Percorso BFS tra oggetti
  app.get("/musei/:nome_museo/percorso", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const oggettiQuery = req.query.oggetti;
    if (!oggettiQuery) return res.status(400).json({ error: "Parametro oggetti mancante" });

    const lista = oggettiQuery.split(",");
    console.log(`Calcolo BFS: ${lista.join(" → ")}`);

    let percorsoCompleto = [];
    for (let i = 0; i < lista.length - 1; i++) {
      const tratto = museo.BFS_oggetti(lista[i], lista[i + 1]);
      if (!tratto) return res.status(404).json({ error: `Percorso non trovato tra '${lista[i]}' e '${lista[i + 1]}'` });
      percorsoCompleto = percorsoCompleto.length === 0
        ? tratto
        : percorsoCompleto.concat(tratto.slice(1));
    }

    console.log(`Percorso: ${percorsoCompleto.join(" → ")}`);
    res.json({ percorso: percorsoCompleto.map(n => museo.get_oggetto(n)) });
  });

  // 5️⃣ Lista percorsi di un museo
  app.get("/musei/:nome_museo/percorsi", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    if (!museo.percorsi) museo.percorsi = [];
    console.log(`Restituisco ${museo.percorsi.length} percorsi di '${museo.nome}'`);
    res.json({ percorsi: museo.percorsi.map(normalizePercorso) });
  });

  // 6️⃣ Dettagli percorso specifico
  app.get("/musei/:nome_museo/percorsi/:nome_percorso", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    if (!museo.percorsi) museo.percorsi = [];
    const percorso = museo.percorsi.find(p => p.nome === req.params.nome_percorso);
    if (!percorso) return res.status(404).json({ error: "Percorso non trovato" });

    console.log(`Restituisco percorso '${percorso.nome}' di '${museo.nome}'`);
    res.json(normalizePercorso(percorso));
  });

  // 9️⃣ Layout grafico — GET
  app.get("/musei/:nome_museo/layout", async (req, res) => {
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const layout = await client.db("musei").collection("musei_layout")
        .findOne({ _id: req.params.nome_museo });

      if (!layout) {
        console.log(`Layout '${req.params.nome_museo}' non trovato`);
        return res.status(404).json({ error: "Layout non trovato" });
      }

      console.log(`Restituisco layout '${req.params.nome_museo}'`);
      res.json(layout);
    } catch (err) {
      console.error("Errore MongoDB layout GET:", err.message);
      res.status(500).json({ error: "Errore recupero layout" });
    } finally {
      await client.close();
    }
  });

  // 🔟 Layout grafico — PUT (aggiorna o crea)
  app.put("/musei/:nome_museo/layout", async (req, res) => {
    const nuovoLayout = req.body;
    if (!nuovoLayout || Object.keys(nuovoLayout).length === 0)
      return res.status(400).json({ error: "Body del layout non può essere vuoto" });

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("musei_layout");

      await col.updateOne(
        { _id: req.params.nome_museo },
        { $set: nuovoLayout },
        { upsert: true }
      );
      layoutStore[req.params.nome_museo] = {
        ...(layoutStore[req.params.nome_museo] || {}),
        ...nuovoLayout,
      };
      saveLayoutStore(LAYOUT_FILE, layoutStore);

      console.log(`Layout '${req.params.nome_museo}' aggiornato`);
      res.json({ message: `Layout '${req.params.nome_museo}' aggiornato con successo` });
    } catch (err) {
      console.error("Errore MongoDB layout PUT:", err.message);
      res.status(500).json({ error: "Errore aggiornamento layout" });
    } finally {
      await client.close();
    }
  });

  // 1️⃣1️⃣ Layout grafico — DELETE
  app.delete("/musei/:nome_museo/layout", async (req, res) => {
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("musei_layout");

      const risultato = await col.deleteOne({ _id: req.params.nome_museo });

      if (risultato.deletedCount === 0) {
        console.log(`Layout '${req.params.nome_museo}' non trovato per eliminazione`);
        return res.status(404).json({ error: "Layout non trovato" });
      }
      delete layoutStore[req.params.nome_museo];
      saveLayoutStore(LAYOUT_FILE, layoutStore);

      console.log(`Layout '${req.params.nome_museo}' eliminato`);
      res.json({ message: `Layout '${req.params.nome_museo}' eliminato con successo` });
    } catch (err) {
      console.error("Errore MongoDB layout DELETE:", err.message);
      res.status(500).json({ error: "Errore eliminazione layout" });
    } finally {
      await client.close();
    }
  });

  // ==========================================================
  // ROUTE — POST
  // ==========================================================

  // Crea museo
  app.post("/musei", async (req, res) => {
    const { nome, citta, oggetti } = req.body;
    if (!nome || !citta) return res.status(400).json({ error: "Nome e città obbligatori" });
    if (sistema.get_museo(nome)) return res.status(400).json({ error: "Museo già esistente" });

    const museo = { nome, citta, oggetti: oggetti || [], percorsi: [] };
    sistema.aggiungi_museo(museo);
    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo(museo);
      console.log(`Museo '${nome}' creato e sincronizzato`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.status(201).json({ message: `Museo '${nome}' creato con successo` });
  });

  // Aggiungi oggetto a museo
  app.post("/musei/:nome_museo/oggetti", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const oggetto = req.body;
    if (!oggetto.nome) return res.status(400).json({ error: "Nome oggetto obbligatorio" });
    if (museo.get_oggetto(oggetto.nome)) return res.status(400).json({ error: "Oggetto già esistente" });

    // default posizione (centrata) se non fornita
    if (!oggetto.pos || typeof oggetto.pos !== "object") oggetto.pos = { x: 0.5, y: 0.5 };

    museo.aggiungi_oggetto(oggetto);
    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi || [] });
      console.log(`Oggetto '${oggetto.nome}' aggiunto a '${museo.nome}'`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.status(201).json({ message: `Oggetto '${oggetto.nome}' aggiunto` });
  });

  // 7️⃣ Crea percorso
  app.post("/musei/:nome_museo/percorsi", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const { nome, oggetti } = req.body;
    const prezzo = normalizePrezzo(req.body?.prezzo);
    if (!nome) return res.status(400).json({ error: "Nome percorso obbligatorio" });
    if (!Array.isArray(oggetti) || oggetti.length === 0)
      return res.status(400).json({ error: "Array oggetti obbligatorio e non vuoto" });

    if (!museo.percorsi) museo.percorsi = [];
    if (museo.percorsi.find(p => p.nome === nome))
      return res.status(400).json({ error: "Percorso già esistente" });

    for (const nomeOggetto of oggetti) {
      if (!museo.get_oggetto(nomeOggetto))
        return res.status(404).json({ error: `Oggetto '${nomeOggetto}' non trovato` });
    }

    const nuovoPercorso = { nome, oggetti, prezzo };
    museo.percorsi.push(nuovoPercorso);
    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi });
      console.log(`Percorso '${nome}' creato in '${museo.nome}'`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.status(201).json({ message: `Percorso '${nome}' creato`, percorso: nuovoPercorso });
  });

  // ==========================================================
  // ROUTE — PUT
  // ==========================================================

  // Modifica museo
  app.put("/musei/:nome_museo", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const { nome, citta } = req.body;
    if (nome && nome !== req.params.nome_museo) {
      sistema.musei.delete(req.params.nome_museo);
      museo.nome = nome;
      sistema.musei.set(nome, museo);
    }
    if (citta) museo.citta = citta;

    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi || [] });
      console.log(`Museo '${museo.nome}' aggiornato`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.json({ message: `Museo '${museo.nome}' aggiornato` });
  });

  // Modifica oggetto
  app.put("/musei/:nome_museo/oggetti/:oggetto", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const oggetto = museo.get_oggetto(req.params.oggetto);
    if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });

    const { nome, stanza, connessi, descrizioni, pos, objectType, textTitle, textBody } = req.body;
    if (nome && nome !== oggetto.nome) {
      museo.oggetti.delete(oggetto.nome);
      oggetto.nome = nome;
      museo.oggetti.set(nome, oggetto);
    }
    if (stanza)      oggetto.stanza = stanza;
    if (pos && typeof pos === "object") oggetto.pos = pos;
    if (connessi) {
      oggetto.connessi = connessi;
      oggetto.connessi.forEach(c => museo.collega_oggetti(oggetto.nome, c));
    }
    if (descrizioni) oggetto.descrizioni = descrizioni;
    if (objectType != null) oggetto.objectType = String(objectType || "").trim() || "normal";
    if (textTitle != null) oggetto.textTitle = String(textTitle || "").trim();
    if (textBody != null) oggetto.textBody = String(textBody || "").trim();

    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi || [] });
      console.log(`Oggetto '${oggetto.nome}' aggiornato`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.json({ message: `Oggetto '${oggetto.nome}' aggiornato` });
  });

  // ==========================================================
  // ROUTE — DELETE
  // ==========================================================

  // 8️⃣ Elimina percorso
  app.delete("/musei/:nome_museo/percorsi/:nome_percorso", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    if (!museo.percorsi) museo.percorsi = [];
    const indice = museo.percorsi.findIndex(p => p.nome === req.params.nome_percorso);
    if (indice === -1) return res.status(404).json({ error: "Percorso non trovato" });

    museo.percorsi.splice(indice, 1);
    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi });
      console.log(`Percorso '${req.params.nome_percorso}' eliminato da '${museo.nome}'`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.json({ message: `Percorso '${req.params.nome_percorso}' eliminato` });
  });

  // Elimina museo
  app.delete("/musei/:nome_museo", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    sistema.musei.delete(req.params.nome_museo);
    sistema.salvaSuFile(FILE_JSON);

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      await client.db(DB_NAME).collection(MUSEI_COLLECTION).deleteOne({ nome: req.params.nome_museo });
      await client.db(DB_NAME).collection(LAYOUT_COLLECTION).deleteOne({ _id: req.params.nome_museo });
      delete layoutStore[req.params.nome_museo];
      saveLayoutStore(LAYOUT_FILE, layoutStore);
      console.log(`Museo '${req.params.nome_museo}' eliminato`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    } finally {
      await client.close();
    }

    res.json({ message: `Museo '${req.params.nome_museo}' eliminato` });
  });

  // Elimina oggetto
  app.delete("/musei/:nome_museo/oggetti/:oggetto", async (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const oggetto = museo.get_oggetto(req.params.oggetto);
    if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });

    museo.oggetti.delete(oggetto.nome);
    museo.mappa_oggetti.adj.delete(oggetto.nome);
    for (const [key, neighbors] of museo.mappa_oggetti.adj.entries()) {
      museo.mappa_oggetti.adj.set(key, neighbors.filter(n => n !== oggetto.nome));
    }

    sistema.salvaSuFile(FILE_JSON);

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      await client.db(DB_NAME).collection(MUSEI_COLLECTION)
        .updateOne({ nome: museo.nome }, { $pull: { oggetti: { nome: oggetto.nome } } });
      console.log(`Oggetto '${oggetto.nome}' eliminato da '${museo.nome}'`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    } finally {
      await client.close();
    }

    res.json({ message: `Oggetto '${oggetto.nome}' eliminato` });
  });

  // ==========================================================
  // AVVIO HTTPS
  // ==========================================================
  const certPath = path.join(__dirname, "cert", "server.crt");
  const keyPath  = path.join(__dirname, "cert", "server.key");

  let tlsOptions;
  try {
    tlsOptions = {
      key:  fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    console.log("✅ Certificati TLS caricati");
  } catch (err) {
    console.error("❌ Errore certificati TLS:", err.message);
    process.exit(1);
  }

  https.createServer(tlsOptions, app).listen(PORT, HOST, () => {
    console.log(`✅ Server API in ascolto su https://${HOST}:${PORT}`);
    console.log(`   API key richiesta`);
  });

  
  const imgUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // max 10 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Solo file immagine accettati"), false);
    },
  });

  // Funzione per generare l'_id del documento immagine
  function imgDocId(museo, oggetto, tipo) {
    return `${museo}_${oggetto}_${tipo}`;
  }

  function stanzaImgDocId(museo, stanza, tipo) {
    return `${museo}_${stanza}_${tipo}`;
  }

  function stanzaExistsInLayout(nomeMuseo, stanzaNome) {
    const layout = layoutStore?.[nomeMuseo];
    if (!layout) return false;
    const rooms = layout.rooms && typeof layout.rooms === "object" ? layout.rooms : null;
    if (rooms) return Object.prototype.hasOwnProperty.call(rooms, stanzaNome);
    const grid = layout.grid && typeof layout.grid === "object" ? layout.grid : null;
    if (grid) return Object.prototype.hasOwnProperty.call(grid, stanzaNome);
    return false;
  }

  // ==========================================================
  // POST /musei/:nome_museo/oggetti/:oggetto/immagini/:tipo
  // Upload o sostituzione immagine
  // ==========================================================
  app.post(
    "/musei/:nome_museo/oggetti/:oggetto/immagini/:tipo",
    imgUpload.single("immagine"),
    async (req, res) => {
      const { nome_museo, oggetto, tipo } = req.params;

      const museo = sistema.get_museo(nome_museo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      if (!museo.get_oggetto(oggetto)) return res.status(404).json({ error: "Oggetto non trovato" });
      if (!req.file) return res.status(400).json({ error: "Nessun file ricevuto (campo: 'immagine')" });
      if (tipo !== "preview" && !/^\d+$/.test(tipo))
        return res.status(400).json({ error: "Tipo non valido: usa 'preview' o un numero (1, 2, 3…)" });

      const client = new MongoClient(MONGO_URI);
      try {
        await client.connect();
        const col = client.db("musei").collection("oggetti_immagini");

        let buffer = req.file.buffer;
        let mimeType = req.file.mimetype;
        let size = req.file.size;
        
        if (mimeType !== 'image/webp' && !mimeType.startsWith('image/svg')) {
            try {
               buffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
               mimeType = 'image/webp';
               size = buffer.length;
            } catch (e) {
               console.error("Errore conversione in webp durante upload:", e);
            }
        }

        await col.replaceOne(
          { _id: imgDocId(nome_museo, oggetto, tipo) },
          {
            _id:       imgDocId(nome_museo, oggetto, tipo),
            museo:     nome_museo,
            oggetto,
            tipo,
            mimeType:  mimeType,
            data:      buffer,
            size:      size,
            updatedAt: new Date(),
          },
          { upsert: true }
        );

        console.log(`✅ Immagine '${imgDocId(nome_museo, oggetto, tipo)}' salvata (${size} B)`);
        res.status(201).json({ id: imgDocId(nome_museo, oggetto, tipo) });
      } catch (err) {
        console.error("Errore immagine POST:", err.message);
        res.status(500).json({ error: "Errore salvataggio immagine" });
      } finally {
        await client.close();
      }
    }
  );

  // ==========================================================
  // GET /musei/:nome_museo/oggetti/:oggetto/immagini
  // Lista tipi disponibili per quell'oggetto
  // ==========================================================
  app.get("/musei/:nome_museo/oggetti/:oggetto/immagini", async (req, res) => {
    const { nome_museo, oggetto } = req.params;

    const museo = sistema.get_museo(nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });
    if (!museo.get_oggetto(oggetto)) return res.status(404).json({ error: "Oggetto non trovato" });

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("oggetti_immagini");

      const docs = await col
        .find({ museo: nome_museo, oggetto }, { projection: { tipo: 1, size: 1, updatedAt: 1 } })
        .toArray();

      // Ordina: preview prima, poi 1, 2, 3…
      docs.sort((a, b) => {
        if (a.tipo === "preview") return -1;
        if (b.tipo === "preview") return 1;
        return parseInt(a.tipo) - parseInt(b.tipo);
      });

      res.json({
        oggetto,
        immagini: docs.map(d => ({
          tipo:      d.tipo,
          url:       `/musei/${encodeURIComponent(nome_museo)}/oggetti/${encodeURIComponent(oggetto)}/immagini/${d.tipo}`,
          size:      d.size,
          updatedAt: d.updatedAt,
        })),
      });
    } catch (err) {
      console.error("Errore immagini GET list:", err.message);
      res.status(500).json({ error: "Errore recupero lista immagini" });
    } finally {
      await client.close();
    }
  });

  // ==========================================================
  // GET /musei/:nome_museo/oggetti/:oggetto/immagini/:tipo
  // Restituisce i byte dell'immagine
  // ==========================================================
  app.get("/musei/:nome_museo/oggetti/:oggetto/immagini/:tipo", async (req, res) => {
    const { nome_museo, oggetto, tipo } = req.params;
    const museo = sistema.get_museo(nome_museo);
    const oggettoDoc = museo?.get_oggetto(oggetto);
    const isTextObject = String(oggettoDoc?.objectType || "").toLowerCase() === "text";

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("oggetti_immagini");

      const doc = await col.findOne({ _id: imgDocId(nome_museo, oggetto, tipo) });
      if (!doc) {
        if (tipo === "preview" && isTextObject && fs.existsSync(DEFAULT_TEXT_PREVIEW_PATH)) {
          const data = fs.readFileSync(DEFAULT_TEXT_PREVIEW_PATH);
          res.set("Content-Type", "image/png");
          res.set("Cache-Control", "public, max-age=300");
          return res.send(data);
        }
        return res.status(404).json({ error: "Immagine non trovata" });
      }

      let data = doc.data.buffer ?? doc.data;
      let mimeType = doc.mimeType;

      if (mimeType !== 'image/webp' && !mimeType.startsWith('image/svg')) {
          try {
             data = await sharp(data).webp({ quality: 80 }).toBuffer();
             mimeType = 'image/webp';
             await col.updateOne(
                 { _id: doc._id },
                 { $set: { data: data, mimeType: mimeType, size: data.length } }
             );
          } catch(e) {
             console.error("Errore conversione lazy API image a webp:", e);
          }
      }

      res.set("Content-Type", mimeType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(data);
    } catch (err) {
      console.error("Errore immagine GET:", err.message);
      res.status(500).json({ error: "Errore recupero immagine" });
    } finally {
      await client.close();
    }
  });

  // ==========================================================
  // DELETE /musei/:nome_museo/oggetti/:oggetto/immagini/:tipo
  // ==========================================================
  app.delete("/musei/:nome_museo/oggetti/:oggetto/immagini/:tipo", async (req, res) => {
    const { nome_museo, oggetto, tipo } = req.params;

    const museo = sistema.get_museo(nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("oggetti_immagini");

      const result = await col.deleteOne({ _id: imgDocId(nome_museo, oggetto, tipo) });
      if (result.deletedCount === 0)
        return res.status(404).json({ error: "Immagine non trovata" });

      console.log(`🗑️  Immagine '${imgDocId(nome_museo, oggetto, tipo)}' eliminata`);
      res.json({ message: `Immagine '${tipo}' eliminata da '${oggetto}'` });
    } catch (err) {
      console.error("Errore immagine DELETE:", err.message);
      res.status(500).json({ error: "Errore eliminazione immagine" });
    } finally {
      await client.close();
    }
});

  // ==========================================================
  // STANZE IMMAGINI (stesso schema degli oggetti)
  // ==========================================================

  app.post(
    "/musei/:nome_museo/stanze/:stanza/immagini/:tipo",
    imgUpload.single("immagine"),
    async (req, res) => {
      const { nome_museo, stanza, tipo } = req.params;
      const museo = sistema.get_museo(nome_museo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      if (!stanzaExistsInLayout(nome_museo, stanza)) {
        return res.status(404).json({ error: "Stanza non trovata nel layout" });
      }
      if (!req.file) return res.status(400).json({ error: "Nessun file ricevuto (campo: 'immagine')" });
      if (tipo !== "preview" && !/^\d+$/.test(tipo)) {
        return res.status(400).json({ error: "Tipo non valido: usa 'preview' o un numero (1, 2, 3…)" });
      }

      const client = new MongoClient(MONGO_URI);
      try {
        await client.connect();
        const col = client.db("musei").collection("stanze_immagini");

        let buffer = req.file.buffer;
        let mimeType = req.file.mimetype;
        let size = req.file.size;

        if (mimeType !== "image/webp" && !mimeType.startsWith("image/svg")) {
          try {
            buffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
            mimeType = "image/webp";
            size = buffer.length;
          } catch (e) {
            console.error("Errore conversione in webp durante upload stanza:", e);
          }
        }

        await col.replaceOne(
          { _id: stanzaImgDocId(nome_museo, stanza, tipo) },
          {
            _id: stanzaImgDocId(nome_museo, stanza, tipo),
            museo: nome_museo,
            stanza,
            tipo,
            mimeType,
            data: buffer,
            size,
            updatedAt: new Date(),
          },
          { upsert: true }
        );

        res.status(201).json({ id: stanzaImgDocId(nome_museo, stanza, tipo) });
      } catch (err) {
        console.error("Errore immagine stanza POST:", err.message);
        res.status(500).json({ error: "Errore salvataggio immagine stanza" });
      } finally {
        await client.close();
      }
    }
  );

  app.get("/musei/:nome_museo/stanze/:stanza/immagini", async (req, res) => {
    const { nome_museo, stanza } = req.params;
    const museo = sistema.get_museo(nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });
    if (!stanzaExistsInLayout(nome_museo, stanza)) {
      return res.status(404).json({ error: "Stanza non trovata nel layout" });
    }

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("stanze_immagini");
      const docs = await col
        .find({ museo: nome_museo, stanza }, { projection: { tipo: 1, size: 1, updatedAt: 1 } })
        .toArray();

      docs.sort((a, b) => {
        if (a.tipo === "preview") return -1;
        if (b.tipo === "preview") return 1;
        return parseInt(a.tipo) - parseInt(b.tipo);
      });

      res.json({
        stanza,
        immagini: docs.map((d) => ({
          tipo: d.tipo,
          url: `/musei/${encodeURIComponent(nome_museo)}/stanze/${encodeURIComponent(stanza)}/immagini/${d.tipo}`,
          size: d.size,
          updatedAt: d.updatedAt,
        })),
      });
    } catch (err) {
      console.error("Errore immagini stanza GET list:", err.message);
      res.status(500).json({ error: "Errore recupero lista immagini stanza" });
    } finally {
      await client.close();
    }
  });

  app.get("/musei/:nome_museo/stanze/:stanza/immagini/:tipo", async (req, res) => {
    const { nome_museo, stanza, tipo } = req.params;
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("stanze_immagini");
      const doc = await col.findOne({ _id: stanzaImgDocId(nome_museo, stanza, tipo) });
      if (!doc) return res.status(404).json({ error: "Immagine stanza non trovata" });

      let data = doc.data.buffer ?? doc.data;
      let mimeType = doc.mimeType;
      if (mimeType !== "image/webp" && !mimeType.startsWith("image/svg")) {
        try {
          data = await sharp(data).webp({ quality: 80 }).toBuffer();
          mimeType = "image/webp";
          await col.updateOne(
            { _id: doc._id },
            { $set: { data, mimeType, size: data.length } }
          );
        } catch (e) {
          console.error("Errore conversione lazy API image stanza a webp:", e);
        }
      }

      res.set("Content-Type", mimeType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(data);
    } catch (err) {
      console.error("Errore immagine stanza GET:", err.message);
      res.status(500).json({ error: "Errore recupero immagine stanza" });
    } finally {
      await client.close();
    }
  });

  app.delete("/musei/:nome_museo/stanze/:stanza/immagini/:tipo", async (req, res) => {
    const { nome_museo, stanza, tipo } = req.params;
    const museo = sistema.get_museo(nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const col = client.db("musei").collection("stanze_immagini");
      const result = await col.deleteOne({ _id: stanzaImgDocId(nome_museo, stanza, tipo) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Immagine stanza non trovata" });
      }
      res.json({ message: `Immagine '${tipo}' eliminata da stanza '${stanza}'` });
    } catch (err) {
      console.error("Errore immagine stanza DELETE:", err.message);
      res.status(500).json({ error: "Errore eliminazione immagine stanza" });
    } finally {
      await client.close();
    }
  });
}

// ============================================================
// ENTRY POINT
// ============================================================
const cliOptions = parseCliArgs(process.argv.slice(2));
if (cliOptions.help) {
  printHelp();
  process.exit(0);
}
if (cliOptions.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (!["disk-override", "mongo"].includes(cliOptions.bootstrapMode)) {
  console.error(`❌ bootstrap mode non valido: ${cliOptions.bootstrapMode}`);
  printHelp();
  process.exit(1);
}

startServer(cliOptions).catch(err => {
  console.error("💥 Errore fatale avvio server:", err);
  process.exit(1);
});
