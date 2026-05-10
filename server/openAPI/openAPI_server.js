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
const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_ALLOW_NO_AUTH = String(process.env.AI_ALLOW_NO_AUTH || "").trim().toLowerCase() === "true";
/** Se true, le route AI falliscono (5xx) invece di degradare a fallback locale */
const AI_STRICT = String(process.env.AI_STRICT || "").trim().toLowerCase() === "true";
const AI_BASE_URL = String(
  process.env.AI_BASE_URL ||
  (AI_PROVIDER === "openai"
    ? "https://api.openai.com/v1"
    : AI_PROVIDER === "groq"
      ? "https://api.groq.com/openai/v1"
      : "")
).trim().replace(/\/+$/, "");
/** Base URL opzionale (es. https://miodominio.it) per prefissare path immagini nel contesto IA */
const PUBLIC_API_BASE = String(process.env.PUBLIC_API_BASE || process.env.API_PUBLIC_URL || "").trim().replace(/\/+$/, "");

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
const MARKETPLACE_OBJECT_REQUESTS_COLLECTION = "marketplace_object_requests";
const QR_CODES_COLLECTION = "qr_codes";
const SESSION_COOKIE_NAME = "muto_auth";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MARKETPLACE_OBJECT_FIXED_PRICE = normalizePrezzo(process.env.MARKETPLACE_OBJECT_FIXED_PRICE || 25);
const PERSONAL_ROUTE_AI_RATE_MS = 1000 * 20;
const personalRouteRateMap = new Map();

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
const ALLOWED_DURATIONS = ["corto", "medio", "lungo", "esteso"];
const PERSONAL_ROUTE_LENGTH_PRESETS = {
  breve: 0.2,
  medio: 0.5,
  lungo: 0.8,
};
/** Lingua UI navigatore / traduzione risposte AI (default it) */
const ALLOWED_NAV_LANGS = ["it", "en", "fr"];

function normalizeNavLang(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "it";
  return ALLOWED_NAV_LANGS.includes(s) ? s : "it";
}

function normalizePrezzo(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueStrings(list = []) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizePersonalRouteLengthPreset(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PERSONAL_ROUTE_LENGTH_PRESETS, key) ? key : "medio";
}

function personalRouteTargetCount(totalObjects, lengthPreset) {
  const ratio = PERSONAL_ROUTE_LENGTH_PRESETS[normalizePersonalRouteLengthPreset(lengthPreset)] || 0.5;
  return clampInt(Math.round(totalObjects * ratio), 1, Math.max(1, totalObjects));
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

function hashQrCode(code) {
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
  const navLang = normalizeNavLang(body.navLang ?? body.nav_lang);
  return { nome, cognome, email, password, eta, interessi, livello, durata, navLang };
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
    navLang: normalizeNavLang(user.navLang),
    ruolo: user.ruolo,
    percorsiAcquistati: user.percorsiAcquistati || [],
    percorsiPersonalizzati: user.percorsiPersonalizzati || [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isProfessor(user) {
  return String(user?.ruolo || "").toLowerCase() === "professore";
}

function isAdmin(user) {
  return String(user?.ruolo || "").toLowerCase() === "admin";
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

function levelToIndexForDescriptions(livello) {
  const key = String(livello || "").trim().toLowerCase();
  if (key === "bambino") return 0;
  if (key === "studente") return 1;
  if (key === "esperto") return 2;
  if (key === "avanzato") return 3;
  return 1;
}

function durationToIndexForDescriptions(durata) {
  const key = String(durata || "").trim().toLowerCase();
  if (key === "corto") return 0;
  if (key === "medio") return 1;
  if (key === "lungo") return 2;
  if (key === "esteso") return 3;
  return 1;
}

const LEVEL_LABELS = ["bambino", "studente", "esperto", "avanzato"];
const DURATION_LABELS = ["corto", "medio", "lungo"];

/** Secondi di lettura ad alta voce dal profilo utente: corto→3, medio→6, lungo→9, esteso→15 */
function targetReadingSecondsFromDurata(durata) {
  const key = String(durata || "").trim().toLowerCase();
  if (key === "corto") return 3;
  if (key === "medio") return 6;
  if (key === "lungo") return 9;
  if (key === "esteso") return 15;
  return 6;
}

function normalizeQuestionKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Moltiplicatore sui secondi “durata profilo”: esperto/avanzato richiedono risposte molto più sostenute. */
function moltiplicatoreSecondiPerLivello(livello) {
  const k = String(livello || "").trim().toLowerCase();
  if (k === "bambino") return 0.95;
  if (k === "studente") return 1;
  if (k === "esperto") return 2.15;
  if (k === "avanzato") return 2.65;
  return 1;
}

function approximateWordBudget(seconds, livello) {
  const k = String(livello || "").trim().toLowerCase();
  const parolePerSec =
    k === "bambino" ? 2.1 : k === "studente" ? 2.55 : k === "esperto" ? 3.25 : k === "avanzato" ? 3.6 : 2.55;
  const minimo =
    k === "bambino" ? 10 : k === "studente" ? 15 : k === "esperto" ? 38 : k === "avanzato" ? 48 : 15;
  return Math.max(minimo, Math.round(Number(seconds) * parolePerSec));
}

/** Domande su significato, storia, contesto: servono più parole anche senza “dimmi di più”. */
function isDomandaAnalitica(raw) {
  const q = normalizeQuestionKey(raw);
  if (q.length < 4) return false;
  return (
    /\b(significat|storic|storia|contest|contestual|perche|perché|per che|motiv|implicaz|rilevanz|rappresent|simbol|iconograf|funerar|ritual|funzion)\b/.test(
      q
    ) || /\bcos[a']? (significa|rappresent)\b/.test(q)
  );
}

/** Domande che chiedono più dettaglio: si alza il budget (sempre solo dati nel contesto). */
function isApprofondimentoRichiesto(raw) {
  const q = normalizeQuestionKey(raw);
  if (q.length < 2) return false;
  return (
    /\b(di piu|ancora di piu|piu in generale|piu dettagli|piu lungo|non basta)\b/.test(q) ||
    /\b(approfond|elabora|espandi|dettagli|spiegami meglio|racconta di piu|dimmi di piu|dimmi altro|ancora|continua|vai oltre)\b/.test(q) ||
    /dimmi (ancora|altro|di piu)\b/.test(q) ||
    /\b(cosa c[eè] di piu|che altro)\b/.test(q)
  );
}

function pickOurDescription(descrizioni, userPrefs) {
  if (!Array.isArray(descrizioni) || descrizioni.length === 0) return "";
  const preferredLevel = levelToIndexForDescriptions(userPrefs?.livello);
  const preferredDuration = durationToIndexForDescriptions(userPrefs?.durata);
  const levelGroupRaw = descrizioni[preferredLevel] ?? descrizioni[Math.min(preferredLevel, descrizioni.length - 1)];
  if (!Array.isArray(levelGroupRaw) || levelGroupRaw.length === 0) return "";
  const durIdx = Math.min(preferredDuration, levelGroupRaw.length - 1);
  const text = levelGroupRaw[durIdx];
  if (typeof text === "string" && text.trim().length > 0) return text.trim();

  for (const candidate of levelGroupRaw) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  for (const group of descrizioni) {
    if (!Array.isArray(group)) continue;
    for (const candidate of group) {
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
    }
  }
  return "";
}

function descrizioniMatrixForAI(descrizioni) {
  if (!Array.isArray(descrizioni)) return [];
  const out = [];
  for (let li = 0; li < descrizioni.length; li++) {
    const group = descrizioni[li];
    if (!Array.isArray(group)) continue;
    const livello = LEVEL_LABELS[li] || `livello_${li}`;
    for (let di = 0; di < group.length; di++) {
      const testo = typeof group[di] === "string" ? group[di].trim() : "";
      if (!testo) continue;
      out.push({
        livello,
        durata: DURATION_LABELS[di] || `col_${di}`,
        testo,
      });
    }
  }
  return out;
}

/** Matrice descrizioni da mostrare in base a navLang (fallback italiano). */
function descrizioniMatrixForNavLang(oggetto, navLangRaw) {
  const navLang = normalizeNavLang(navLangRaw);
  const it = Array.isArray(oggetto?.descrizioni) ? oggetto.descrizioni : [];
  if (navLang === "it") return it;
  const alt = oggetto?.descrizioniI18n?.[navLang];
  if (Array.isArray(alt) && alt.length > 0) return alt;
  return it;
}

function alignDescrizioniMatrixToSource(translated, source) {
  const out = [];
  const nRows = Array.isArray(source) && source.length > 0 ? source.length : 4;
  for (let i = 0; i < nRows; i++) {
    const srcRow = Array.isArray(source?.[i]) ? source[i] : [];
    const nCols = srcRow.length > 0 ? srcRow.length : 3;
    const trRow = Array.isArray(translated?.[i]) ? translated[i] : [];
    const row = [];
    for (let j = 0; j < nCols; j++) {
      const s = typeof srcRow[j] === "string" ? srcRow[j] : "";
      const t = typeof trRow[j] === "string" ? trRow[j] : "";
      row.push(String(s).trim() === "" ? "" : (t || s));
    }
    out.push(row);
  }
  return out;
}

async function aiCompleteJsonObject({ system, user, maxTokens = 3500, temperature = 0.2 }) {
  if (!aiUpstreamReady()) throw new Error("AI non configurata");

  const authHeader = resolveAiAuthHeader();
  const payload = {
    model: AI_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (AI_PROVIDER === "openai") {
    payload.response_format = { type: "json_object" };
  }

  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`AI upstream error (${response.status}): ${errText || "unknown"}`);
  }

  const data = await response.json();
  const raw = String(data?.choices?.[0]?.message?.content || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Risposta AI non è JSON valido");
  }
}

async function withTimeout(promise, ms, label = "operation") {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function aiTranslateDescrizioniMatrixFromIt(matrixIt, targetLang) {
  const langName = targetLang === "en" ? "English" : "French";
  const system = [
    `You translate museum exhibit description matrices from Italian to ${langName}.`,
    "Rules: Keep the exact same JSON shape: a key \"matrix\" whose value is an array of rows; each row is an array of strings.",
    "The input matrix dimensions must match the output. Preserve empty strings (do not invent text for empty cells).",
    "Translate only non-empty Italian cells. Keep well-known artist/work names recognizable.",
    'Output only JSON: {"matrix":[["row0col0",...], ...]}.',
  ].join(" ");
  const user = `Italian matrix:\n${JSON.stringify(matrixIt)}`;
  const out = await aiCompleteJsonObject({ system, user, maxTokens: 3800, temperature: 0.15 });
  const m = out?.matrix;
  if (!Array.isArray(m)) throw new Error('Risposta AI senza "matrix"');
  return alignDescrizioniMatrixToSource(m, matrixIt);
}

async function aiTranslateLayoutLabels({ stanzeNomi, percorsiNomi }) {
  const system = [
    "You translate Italian museum UI labels to English and French.",
    'Return JSON only: {"stanze":{"<italian_name>":{"en":"...","fr":"..."}},"percorsi":{"<italian_name>":{"en":"...","fr":"..."}}}.',
    "Keys in stanze and percorsi MUST be exactly the Italian strings from the input lists (same spelling).",
    "If a name is exactly one of: out, shop, wc, home — set en and fr to the same lowercase string as the key (do not translate).",
    "Short natural museum-style labels; no long explanations.",
  ].join(" ");
  const user = JSON.stringify({ stanze: stanzeNomi, percorsi: percorsiNomi });
  const out = await aiCompleteJsonObject({ system, user, maxTokens: 2000, temperature: 0.2 });
  const stanze = out?.stanze && typeof out.stanze === "object" ? out.stanze : {};
  const percorsi = out?.percorsi && typeof out.percorsi === "object" ? out.percorsi : {};
  return { stanze, percorsi };
}

function normalizePersonalRouteStorage(route = {}, fallbackMuseo = "") {
  const id = String(route.id || new ObjectId().toString()).trim();
  const museo = String(route.museo || fallbackMuseo || "").trim();
  const nome = String(route.nome || "Percorso personalizzato").trim();
  const lengthPreset = normalizePersonalRouteLengthPreset(route.lengthPreset);
  const targetRatio = Number(PERSONAL_ROUTE_LENGTH_PRESETS[lengthPreset] || 0.5);
  const flowNodes = uniqueStrings(Array.isArray(route.flowNodes) ? route.flowNodes : []);
  const objectNodes = uniqueStrings(Array.isArray(route.objectNodes) ? route.objectNodes : flowNodes.filter((n) => !String(n).startsWith("__text__")));
  const textSteps = (Array.isArray(route.textSteps) ? route.textSteps : [])
    .map((step, idx) => ({
      id: String(step?.id || `txt_${idx + 1}`).trim(),
      room: String(step?.room || "").trim(),
      label: String(step?.label || "").trim(),
      text: String(step?.text || "").trim(),
      insertAfterObject: String(step?.insertAfterObject || "").trim(),
    }))
    .filter((step) => !!step.id && !!step.room && !!step.text);
  const customDescriptionsByObject = Object.fromEntries(
    Object.entries(route.customDescriptionsByObject && typeof route.customDescriptionsByObject === "object" ? route.customDescriptionsByObject : {})
      .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
      .filter(([k, v]) => !!k && !!v)
  );
  const customDescriptionsByObjectI18nRaw =
    route.customDescriptionsByObjectI18n && typeof route.customDescriptionsByObjectI18n === "object"
      ? route.customDescriptionsByObjectI18n
      : {};
  const customDescriptionsByObjectI18n = {};
  for (const lang of ALLOWED_NAV_LANGS) {
    const row = customDescriptionsByObjectI18nRaw[lang];
    if (!row || typeof row !== "object") continue;
    const normalizedRow = Object.fromEntries(
      Object.entries(row)
        .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
        .filter(([k, v]) => !!k && !!v)
    );
    if (Object.keys(normalizedRow).length > 0) customDescriptionsByObjectI18n[lang] = normalizedRow;
  }
  const generatedFrom = route.generatedFrom && typeof route.generatedFrom === "object" ? route.generatedFrom : {};
  return {
    id,
    museo,
    nome,
    source: "ai_personalized",
    lengthPreset,
    targetRatio,
    flowNodes,
    objectNodes,
    textSteps,
    customDescriptionsByObject,
    customDescriptionsByObjectI18n,
    generatedFrom: {
      interessi: Array.isArray(generatedFrom.interessi) ? generatedFrom.interessi : [],
      livello: String(generatedFrom.livello || "").trim(),
      durata: String(generatedFrom.durata || "").trim(),
      navLang: normalizeNavLang(generatedFrom.navLang),
    },
    createdAt: route.createdAt ? new Date(route.createdAt) : new Date(),
    updatedAt: route.updatedAt ? new Date(route.updatedAt) : new Date(),
  };
}

function buildMuseumObjectDocs(museo) {
  return Array.from((museo?.oggetti instanceof Map ? museo.oggetti.values() : [])).map((o) => ({
    nome: String(o?.nome || "").trim(),
    stanza: String(o?.stanza || "").trim(),
    objectType: String(o?.objectType || "").trim().toLowerCase() || "normal",
    autore: String(o?.autore || "").trim(),
    anno: String(o?.anno || "").trim(),
    correnteArtistica: String(o?.correnteArtistica || "").trim(),
    connessi: uniqueStrings(Array.isArray(o?.connessi) ? o.connessi : []),
    descrizioni: Array.isArray(o?.descrizioni) ? o.descrizioni : [],
    descrizioniI18n: o?.descrizioniI18n && typeof o.descrizioniI18n === "object" ? o.descrizioniI18n : {},
  })).filter((o) => !!o.nome);
}

function fallbackPersonalizedRoute({ objectDocs, targetCount, userPrefs }) {
  const interests = Array.isArray(userPrefs?.interessi) ? userPrefs.interessi.map((x) => String(x || "").toLowerCase()) : [];
  const scoreObject = (obj) => {
    const hay = `${obj.nome} ${obj.autore} ${obj.correnteArtistica}`.toLowerCase();
    let score = 1;
    for (const interest of interests) {
      if (!interest) continue;
      if (hay.includes(interest.replaceAll("_", " "))) score += 4;
    }
    if (obj.autore) score += 1;
    if (obj.correnteArtistica) score += 1;
    return score;
  };
  const selectedObjects = objectDocs
    .slice()
    .sort((a, b) => scoreObject(b) - scoreObject(a))
    .slice(0, targetCount)
    .map((o) => o.nome);
  const byName = new Map(objectDocs.map((o) => [o.nome, o]));
  const textObjectByRoom = new Map(
    objectDocs
      .filter((o) => String(o?.objectType || "").toLowerCase() === "text" && o?.stanza && o?.nome)
      .map((o) => [String(o.stanza).trim().toLowerCase(), o.nome])
  );
  const usedRooms = new Set();
  const textSteps = [];
  const textDescriptionsByObject = {};
  for (const objName of selectedObjects) {
    const obj = byName.get(objName);
    if (!obj) continue;
    const room = String(obj.stanza || "").trim();
    if (!room || usedRooms.has(room)) continue;
    usedRooms.add(room);
    const tema = interests.length > 0 ? interests.join(", ") : "la tua sensibilita culturale";
    const autore = obj.autore ? `, attribuita a ${obj.autore}` : "";
    const corrente = obj.correnteArtistica ? ` legata a ${obj.correnteArtistica}` : "";
    const anno = obj.anno ? ` e datata ${obj.anno}` : "";
    const text = `Entrando in questa sala, ${objName}${autore}${anno}${corrente} diventa un ottimo punto di partenza per leggere un tema vicino ai tuoi interessi (${tema}). Nota una curiosita: dettagli simbolici e scelte stilistiche simili compaiono anche in altre collezioni europee dedicate al potere e al rito, spesso legate a figure storiche molto note. Prova a confrontare materiali, gesto e funzione dell'opera: capirai meglio perche questa stanza e strategica nel tuo percorso personalizzato.`;
    const mappedTextObject = textObjectByRoom.get(room.toLowerCase());
    if (mappedTextObject) {
      textDescriptionsByObject[mappedTextObject] = text;
    }
    textSteps.push({
      id: `txt_${textSteps.length + 1}`,
      room,
      label: `Focus ${textSteps.length + 1}`,
      text,
      insertAfterObject: objName,
    });
    if (textSteps.length >= 2) break;
  }
  return { selectedObjects, textSteps, textDescriptionsByObject };
}

async function aiGeneratePersonalRoute({ museoNome, objectDocs, targetCount, userPrefs }) {
  if (!aiUpstreamReady()) {
    return fallbackPersonalizedRoute({ objectDocs, targetCount, userPrefs });
  }
  const system = [
    "Sei un curatore museale che produce JSON valido per un percorso personalizzato.",
    "Rispondi SOLO con JSON, nessun testo extra.",
    "Schema richiesto: {\"selectedObjects\":[\"...\"],\"textSteps\":[{\"room\":\"...\",\"label\":\"...\",\"text\":\"...\",\"insertAfterObject\":\"...\"}],\"rationaleShort\":\"...\"}.",
    "Vincoli: selectedObjects deve contenere SOLO nomi presenti in input, senza duplicati, lunghezza vicina a targetCount.",
    "Vincoli textSteps: max 3, room e insertAfterObject devono essere coerenti con selectedObjects.",
    "Inserisci textSteps in stanze significative per interessi utente.",
    "Ogni textStep deve essere scritto come mini-racconto curatoriale di stanza, non come scheda tecnica.",
    "Ogni textStep deve includere: 1) un gancio narrativo, 2) almeno una curiosita concreta, 3) un collegamento a personaggi/eventi/opere celebri anche esterni al museo (esplicitando che e un confronto culturale), 4) una piccola domanda o spunto di osservazione personalizzato.",
    "Evita formule generiche ripetitive come 'In questa stanza trovi...'.",
  ].join(" ");
  const user = JSON.stringify({
    museo: museoNome,
    targetCount,
    userPreferences: {
      interessi: userPrefs?.interessi || [],
      livello: userPrefs?.livello || "",
      durata: userPrefs?.durata || "",
      navLang: normalizeNavLang(userPrefs?.navLang),
    },
    objects: objectDocs.map((o) => ({
      nome: o.nome,
      stanza: o.stanza,
      autore: o.autore,
      anno: o.anno,
      correnteArtistica: o.correnteArtistica,
      connessi: o.connessi,
    })),
  });
  const out = await aiCompleteJsonObject({ system, user, maxTokens: 3200, temperature: 0.25 });
  return {
    selectedObjects: uniqueStrings(Array.isArray(out?.selectedObjects) ? out.selectedObjects : []),
    textSteps: Array.isArray(out?.textSteps) ? out.textSteps : [],
  };
}

function validateAndRepairPersonalRoute({ objectDocs, aiRoute, targetCount }) {
  const byName = new Map(objectDocs.map((o) => [o.nome, o]));
  const textObjectByRoom = new Map(
    objectDocs
      .filter((o) => String(o?.objectType || "").toLowerCase() === "text" && o?.stanza && o?.nome)
      .map((o) => [String(o.stanza).trim().toLowerCase(), o.nome])
  );
  let selectedObjects = uniqueStrings(Array.isArray(aiRoute?.selectedObjects) ? aiRoute.selectedObjects : [])
    .filter((name) => byName.has(name));
  if (selectedObjects.length < 1) {
    selectedObjects = objectDocs.slice(0, targetCount).map((o) => o.nome);
  }
  if (selectedObjects.length > targetCount) selectedObjects = selectedObjects.slice(0, targetCount);
  if (selectedObjects.length < targetCount) {
    for (const obj of objectDocs) {
      if (selectedObjects.includes(obj.nome)) continue;
      selectedObjects.push(obj.nome);
      if (selectedObjects.length >= targetCount) break;
    }
  }
  const selectedSet = new Set(selectedObjects);
  const usedTextIds = new Set();
  const roomTextObjectUsed = new Set();
  const roomVirtualTextUsed = new Set();
  const textDescriptionsByObject = {};
  const textSteps = (Array.isArray(aiRoute?.textSteps) ? aiRoute.textSteps : [])
    .map((s, idx) => ({
      id: String(s?.id || `txt_${idx + 1}`).trim(),
      room: String(s?.room || "").trim(),
      label: String(s?.label || "").trim() || `Focus ${idx + 1}`,
      text: String(s?.text || "").trim(),
      insertAfterObject: String(s?.insertAfterObject || "").trim(),
    }))
    .filter((s) => s.text && s.room && s.insertAfterObject && selectedSet.has(s.insertAfterObject))
    .filter((s) => {
      if (!s.id || usedTextIds.has(s.id)) return false;
      const roomKey = String(s.room || "").trim().toLowerCase();
      const mappedTextObject = textObjectByRoom.get(roomKey);
      if (mappedTextObject) {
        if (roomTextObjectUsed.has(mappedTextObject)) return false;
        roomTextObjectUsed.add(mappedTextObject);
        textDescriptionsByObject[mappedTextObject] = s.text;
      } else {
        if (roomVirtualTextUsed.has(roomKey)) return false;
        roomVirtualTextUsed.add(roomKey);
        textDescriptionsByObject[`__text__${s.id}`] = s.text;
      }
      usedTextIds.add(s.id);
      return true;
    })
    .slice(0, 3);

  const flowNodes = [];
  const objectNodesWithText = [];
  for (const objectName of selectedObjects) {
    flowNodes.push(objectName);
    objectNodesWithText.push(objectName);
    const inlineTexts = textSteps.filter((t) => t.insertAfterObject === objectName && String(t.room || "").trim());
    for (const t of inlineTexts) {
      const mappedTextObject = textObjectByRoom.get(String(t.room || "").trim().toLowerCase());
      if (mappedTextObject) {
        flowNodes.push(mappedTextObject);
        objectNodesWithText.push(mappedTextObject);
        continue;
      }
      // Fallback: se la stanza non ha item testo reale, mantieni un focus virtuale custom.
      flowNodes.push(`__text__${t.id}`);
    }
  }
  return {
    selectedObjects: uniqueStrings(selectedObjects),
    objectNodes: uniqueStrings(objectNodesWithText),
    textSteps,
    flowNodes: uniqueStrings(flowNodes),
    textDescriptionsByObject,
  };
}

async function aiGeneratePersonalDescriptions({ museoNome, objectDocs, selectedObjects, userPrefs, navLangOverride }) {
  const byName = new Map(objectDocs.map((o) => [o.nome, o]));
  const navLang = normalizeNavLang(navLangOverride ?? userPrefs?.navLang);
  if (!aiUpstreamReady()) {
    return Object.fromEntries(
      selectedObjects.map((name) => {
        const o = byName.get(name);
        const localizedMatrix = descrizioniMatrixForNavLang({
          descrizioni: o?.descrizioni || [],
          descrizioniI18n: o?.descrizioniI18n || {},
        }, navLang);
        const bestBase = pickOurDescription(localizedMatrix, userPrefs) || "";
        const interesse = Array.isArray(userPrefs?.interessi) ? userPrefs.interessi.map((x) => String(x || "").trim()).filter(Boolean).join(", ") : "";
        const autore = String(o?.autore || "").trim();
        const anno = String(o?.anno || "").trim();
        const corrente = String(o?.correnteArtistica || "").trim();
        const context = [
          autore ? `Autore: ${autore}.` : "",
          anno ? `Periodo: ${anno}.` : "",
          corrente ? `Corrente: ${corrente}.` : "",
        ].filter(Boolean).join(" ");
        const richer = [
          bestBase || `Questa opera (${name}) e significativa nel percorso personalizzato.`,
          context,
          interesse ? `Collegamento ai tuoi interessi: ${interesse}.` : "",
          "Osserva un dettaglio formale (materiale, gesto, composizione) e chiediti che funzione comunicativa avesse nel suo contesto originario.",
        ].filter(Boolean).join(" ");
        const best = richer || `Descrizione personalizzata non disponibile per ${name}.`;
        return [name, best];
      })
    );
  }
  const system = [
    "Sei una guida museale personalizzata.",
    "Produci SOLO JSON valido con schema {\"objectDescriptions\":[{\"objectName\":\"...\",\"text\":\"...\"}]}",
    "Per ogni objectName in input deve esserci una descrizione.",
    "Adatta tono e complessita a livello/durata/interessi del profilo utente.",
    "Usa solo i dati disponibili nel contesto oggetti; non inventare fatti.",
    "Stile richiesto: descrizioni vive, interessanti e narrative, non didascaliche.",
    "Per ogni oggetto includi: 1) un gancio interpretativo, 2) almeno una curiosita o confronto culturale pertinente, 3) un aggancio esplicito agli interessi dell'utente, 4) uno spunto di osservazione finale.",
    "I confronti con artisti/opere/eventi famosi sono consentiti solo come parallelismi culturali plausibili, senza attribuire dati storici non presenti nel contesto.",
    "Evita frasi template ripetitive; ogni oggetto deve avere una voce distinta ma coerente ai dati.",
  ].join(" ");
  const user = JSON.stringify({
    museo: museoNome,
    userPreferences: {
      interessi: userPrefs?.interessi || [],
      livello: userPrefs?.livello || "",
      durata: userPrefs?.durata || "",
      navLang,
    },
    objects: selectedObjects.map((name) => {
      const o = byName.get(name);
      return {
        objectName: name,
        stanza: o?.stanza || "",
        autore: o?.autore || "",
        anno: o?.anno || "",
        correnteArtistica: o?.correnteArtistica || "",
        descrizioni: descrizioniMatrixForNavLang({
          descrizioni: o?.descrizioni || [],
          descrizioniI18n: o?.descrizioniI18n || {},
        }, navLang),
      };
    }),
  });
  const out = await aiCompleteJsonObject({ system, user, maxTokens: 4200, temperature: 0.35 });
  const rows = Array.isArray(out?.objectDescriptions) ? out.objectDescriptions : [];
  const mapped = {};
  for (const row of rows) {
    const objectName = String(row?.objectName || "").trim();
    const text = String(row?.text || "").trim();
    if (!objectName || !text) continue;
    mapped[objectName] = text;
  }
  return mapped;
}

async function aiTranslateCustomTextMap({ textMap, targetLang }) {
  const lang = normalizeNavLang(targetLang);
  const normalized = Object.fromEntries(
    Object.entries(textMap && typeof textMap === "object" ? textMap : {})
      .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
      .filter(([k, v]) => !!k && !!v)
  );
  if (lang === "it" || Object.keys(normalized).length < 1) return normalized;
  if (!aiUpstreamReady()) {
    console.warn(`AI translate textSteps skipped (${lang}): upstream non configurato`);
    return normalized;
  }
  const makePrompt = (strict = false) => ({
    system: [
      `Traduci i testi di focus museale in ${lang === "en" ? "inglese" : "francese"}.`,
      "Rispondi SOLO con JSON valido schema: {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}]}",
      "Mantieni tono da guida museale, naturale e scorrevole.",
      "Non inventare fatti; traduci fedelmente il contenuto.",
      strict
        ? "OBBLIGATORIO: il testo finale deve essere interamente nella lingua target (non lasciare frasi in italiano)."
        : "Preferisci una traduzione naturale, con lessico accessibile.",
    ].join(" "),
    user: JSON.stringify({
      targetLang: lang,
      strictLanguage: strict,
      items: Object.entries(normalized).map(([id, text]) => ({ id, text })),
    }),
  });
  try {
    const parseRows = (out) => {
      const rows = Array.isArray(out?.translations) ? out.translations : [];
      const mapped = {};
      for (const row of rows) {
        const id = String(row?.id || "").trim();
        const text = String(row?.text || "").trim();
        if (!id || !text) continue;
        mapped[id] = text;
      }
      return mapped;
    };
    const firstPrompt = makePrompt(false);
    const out = await aiCompleteJsonObject({
      system: firstPrompt.system,
      user: firstPrompt.user,
      maxTokens: 2400,
      temperature: 0.2,
    });
    let mapped = parseRows(out);
    const unchanged = Object.keys(mapped).filter((k) => String(mapped[k] || "").trim() === String(normalized[k] || "").trim());
    if (unchanged.length > 0) {
      const retryPrompt = makePrompt(true);
      const retry = await aiCompleteJsonObject({
        system: retryPrompt.system,
        user: retryPrompt.user,
        maxTokens: 2400,
        temperature: 0.1,
      });
      const strictMapped = parseRows(retry);
      mapped = { ...mapped, ...strictMapped };
    }
    return Object.keys(mapped).length > 0 ? { ...normalized, ...mapped } : normalized;
  } catch (err) {
    console.warn(`AI translate textSteps fallback ${lang}:`, err?.message || err);
    return normalized;
  }
}

function fallbackFocusTextByLang({ lang, room, objectName, interests }) {
  const safeLang = normalizeNavLang(lang);
  const roomText = String(room || "").trim();
  const objText = String(objectName || "").trim();
  const interestsText = Array.isArray(interests) && interests.length > 0
    ? interests.map((x) => String(x || "").trim()).filter(Boolean).join(", ")
    : "";
  if (safeLang === "en") {
    return `At this stop${roomText ? ` in room ${roomText}` : ""}, ${objText || "the featured work"} opens a richer thread linked to your interests${interestsText ? ` (${interestsText})` : ""}. Curatorial curiosity: similar symbols of authority and ritual appear in well-known collections far beyond this museum, often discussed alongside iconic historical figures. Use this as a cultural comparison rather than a direct attribution, and look closely at gesture, material, and display context: what makes this object feel ceremonial, political, or intimate to you?`;
  }
  if (safeLang === "fr") {
    return `A cette etape${roomText ? ` dans la salle ${roomText}` : ""}, ${objText || "l'oeuvre mise en avant"} ouvre une lecture plus riche de vos interets${interestsText ? ` (${interestsText})` : ""}. Curiosite curatoriale: des symboles similaires de pouvoir et de rituel apparaissent aussi dans des collections celebres hors de ce musee, souvent rapproches de personnages historiques connus. Prenez cela comme comparaison culturelle (pas comme attribution directe) et observez geste, matiere et mise en scene: qu'est-ce qui vous semble le plus solennel ou le plus humain?`;
  }
  return `In questa tappa${roomText ? `, nella sala ${roomText}` : ""}, ${objText || "l'opera selezionata"} apre un filo narrativo piu ricco legato ai tuoi interessi${interestsText ? ` (${interestsText})` : ""}. Curiosita curatoriale: simboli simili di potere, rito e identita compaiono anche in collezioni molto note fuori da questo museo, spesso accostate a personaggi storici famosi. Prendilo come confronto culturale (non come attribuzione diretta) e osserva gesto, materiale e funzione: quale dettaglio ti fa leggere l'opera come oggetto di prestigio, memoria o propaganda?`;
}

async function ensureCustomDescriptionsI18n(route) {
  const normalizedRoute = normalizePersonalRouteStorage(route);
  const current = normalizedRoute.customDescriptionsByObjectI18n && typeof normalizedRoute.customDescriptionsByObjectI18n === "object"
    ? normalizedRoute.customDescriptionsByObjectI18n
    : {};
  const baseMapFromRoute = Object.fromEntries(
    Object.entries(normalizedRoute.customDescriptionsByObject && typeof normalizedRoute.customDescriptionsByObject === "object"
      ? normalizedRoute.customDescriptionsByObject
      : {})
      .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
      .filter(([k, v]) => !!k && !!v)
  );
  const baseMapFromTextSteps = Object.fromEntries(
    (Array.isArray(normalizedRoute.textSteps) ? normalizedRoute.textSteps : [])
      .map((step) => {
        const id = String(step?.id || "").trim();
        const text = String(step?.text || "").trim();
        return [`__text__${id}`, text];
      })
      .filter(([k, v]) => !!k && !!v)
  );
  const baseMap = {
    ...baseMapFromTextSteps,
    ...baseMapFromRoute,
  };
  const requiredKeys = new Set(
    uniqueStrings([
      ...Object.keys(baseMap),
      ...(Array.isArray(normalizedRoute.flowNodes) ? normalizedRoute.flowNodes : []),
    ])
  );
  const hasAllLangs = ALLOWED_NAV_LANGS.every((lang) => {
    const row = current[lang];
    if (!row || typeof row !== "object") return false;
    for (const k of requiredKeys) {
      if (!k) continue;
      if (!String(row[k] || "").trim()) return false;
    }
    return true;
  });
  if (hasAllLangs) return { route: normalizedRoute, changed: false };

  const i18n = {};
  const textStepByNode = new Map(
    (Array.isArray(normalizedRoute.textSteps) ? normalizedRoute.textSteps : [])
      .map((s) => [`__text__${String(s?.id || "").trim()}`, s])
  );
  const interests =
    Array.isArray(normalizedRoute?.generatedFrom?.interessi)
      ? normalizedRoute.generatedFrom.interessi
      : [];
  for (const lang of ALLOWED_NAV_LANGS) {
    const existingRow = current[lang] && typeof current[lang] === "object" ? current[lang] : {};
    const missingKeys = Array.from(requiredKeys).filter((k) => !String(existingRow[k] || "").trim());
    if (missingKeys.length < 1) {
      i18n[lang] = existingRow;
      continue;
    }
    const translated = await withTimeout(
      aiTranslateCustomTextMap({
        textMap: Object.fromEntries(missingKeys.map((k) => [k, baseMap[k] || ""])),
        targetLang: lang,
      }),
      12000,
      `route_i18n_backfill_${lang}`
    ).catch(() => Object.fromEntries(missingKeys.map((k) => [k, baseMap[k] || ""])));
    const merged = {
      ...existingRow,
      ...translated,
    };
    if (lang !== "it") {
      for (const key of requiredKeys) {
        const base = String(baseMap[key] || "").trim();
        const value = String(merged[key] || "").trim();
        if (!key || !base) continue;
        if (!value || value === base) {
          const step = textStepByNode.get(key);
          merged[key] = fallbackFocusTextByLang({
            lang,
            room: step?.room || "",
            objectName: step?.insertAfterObject || "",
            interests,
          });
        }
      }
    }
    i18n[lang] = merged;
  }
  return {
    changed: true,
    route: {
      ...normalizedRoute,
      customDescriptionsByObjectI18n: i18n,
      customDescriptionsByObject: i18n.it && typeof i18n.it === "object" ? i18n.it : baseMap,
      updatedAt: new Date(),
    },
  };
}

async function listOggettoImmagineMetas(nomeMuseo, nomeOggetto) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const col = client.db("musei").collection("oggetti_immagini");
    const docs = await col
      .find({ museo: nomeMuseo, oggetto: nomeOggetto }, { projection: { tipo: 1 } })
      .toArray();
    docs.sort((a, b) => {
      if (a.tipo === "preview") return -1;
      if (b.tipo === "preview") return 1;
      const na = parseInt(a.tipo, 10);
      const nb = parseInt(b.tipo, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a.tipo).localeCompare(String(b.tipo));
    });
    return docs.map((d) => {
      const path = `/musei/${encodeURIComponent(nomeMuseo)}/oggetti/${encodeURIComponent(nomeOggetto)}/immagini/${d.tipo}`;
      return {
        tipo: d.tipo,
        urlPath: path,
        url: PUBLIC_API_BASE ? `${PUBLIC_API_BASE}${path}` : path,
      };
    });
  } catch {
    return [];
  } finally {
    await client.close();
  }
}

function buildFallbackObjectAnswer({ question, oggetto, museo, userPrefs }) {
  const descrizione = String(oggetto?.descrizionePreferita || oggetto?.descrizioneBreve || "").trim();
  const autore = String(oggetto?.autore || "").trim();
  const anno = String(oggetto?.anno || "").trim();
  const corrente = String(oggetto?.correnteArtistica || "").trim();
  const interessi = Array.isArray(userPrefs?.interessi) ? userPrefs.interessi.filter(Boolean) : [];
  const livello = String(userPrefs?.livello || "").trim();
  const durata = String(userPrefs?.durata || "").trim();
  const interesseHint = interessi.length > 0 ? `Interessi utente: ${interessi.join(", ")}.` : "";
  const preferenceHint = [livello ? `Livello: ${livello}.` : "", durata ? `Durata: ${durata}.` : ""].filter(Boolean).join(" ");

  return [
    `Al momento sto rispondendo in modalita locale (risposta AI non disponibile).`,
    `Domanda: "${question}"`,
    `Opera: ${oggetto?.nome || "N/D"} - Museo: ${museo?.nome || "N/D"}.`,
    autore ? `Autore: ${autore}.` : "",
    anno ? `Anno: ${anno}.` : "",
    corrente ? `Corrente: ${corrente}.` : "",
    descrizione ? `Contesto: ${descrizione}` : "",
    interesseHint,
    preferenceHint,
  ].filter(Boolean).join(" ");
}

function extractChatCompletionText(data) {
  const c0 = data?.choices?.[0];
  const msg = c0?.message;
  const content = msg?.content;
  if (typeof content === "string") return content;
  // Alcuni provider OpenAI-compatible possono restituire content come array di parti.
  if (Array.isArray(content)) {
    const joined = content
      .map((p) => (typeof p === "string" ? p : (p && typeof p.text === "string" ? p.text : "")))
      .join("");
    return joined;
  }
  // Fallback legacy
  if (typeof c0?.text === "string") return c0.text;
  return "";
}

function resolveAiAuthHeader() {
  const bearer = process.env.AI_AUTH_BEARER || "";
  if (bearer.trim()) return `Bearer ${bearer.trim()}`;
  if (AI_API_KEY) return `Bearer ${AI_API_KEY}`;
  return "";
}

function aiAllowNoAuth() {
  return AI_ALLOW_NO_AUTH || AI_PROVIDER === "ollama";
}

function aiUpstreamReady() {
  return Boolean(AI_BASE_URL && (resolveAiAuthHeader() || aiAllowNoAuth()));
}

async function askObjectAI({ question, museo, oggetto, userPrefs, immaginiOggetto }) {
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) throw new Error("Domanda vuota");

  if (!aiUpstreamReady()) {
    return buildFallbackObjectAnswer({ question: cleanQuestion, museo, oggetto, userPrefs });
  }

  const authHeader = resolveAiAuthHeader();

  const livello = String(userPrefs?.livello || "").trim().toLowerCase();
  const durata = String(userPrefs?.durata || "").trim().toLowerCase();
  const navLang = normalizeNavLang(userPrefs?.navLang);
  const secondiSoloDurata = targetReadingSecondsFromDurata(durata);
  const vuoleApprofondire = isApprofondimentoRichiesto(cleanQuestion);
  const domandaAnalitica = isDomandaAnalitica(cleanQuestion);

  let targetSec = Math.round(secondiSoloDurata * moltiplicatoreSecondiPerLivello(livello));
  targetSec = Math.max(targetSec, secondiSoloDurata);
  if (domandaAnalitica) targetSec = Math.round(targetSec * 1.35);
  if (vuoleApprofondire) targetSec = Math.round(targetSec * 1.85);
  targetSec = Math.min(Math.max(targetSec, 4), 52);

  const wordBudget = approximateWordBudget(targetSec, livello);
  const parolePerSecondo =
    targetSec > 0 ? (wordBudget / targetSec).toFixed(1) : "2.5";

  const nomeOggetto = String(oggetto?.nome || "").trim() || "N/D";
  const nomeMuseo = String(museo?.nome || "").trim() || "N/D";
  const cittaMuseo = String(museo?.citta || "").trim();
  const stanzaOggetto = String(oggetto?.stanza || "").trim() || "N/D";
  const livelloPerIstruzione = livello || "studente";

  const righeQualita = [
    "Qualità della risposta: non ripetere pedissequamente una sola frase del contesto (es. copiare solo nostraDescrizionePerProfilo). Se in CONTESTO_DATI ci sono più voci utili (descrizioniMatriceMuseo, textBody, textTitle, autore, anno, corrente), integra almeno due informazioni distinte quando disponibili, con formulazione da guida.",
    "Se lo spettatore chiede più dettagli o «ancora», non rispondere con la stessa stringa: sintetizza elementi aggiuntivi presenti nel JSON o spiega meglio ciò che c’è già, con parole nuove.",
  ];

  const righeEsperto =
    livello === "esperto" || livello === "avanzato"
      ? [
          "Livello esperto/avanzato: la risposta deve essere articolata (più frasi collegate), con lessico appropriato. Per domande su significato storico o contesto, struttura almeno: (1) cos’è l’oggetto secondo i dati; (2) cosa si può ricavare su funzione o ambito culturale usando solo parole e concetti presenti o implicati chiaramente nel testo (es. «funerario» → sfera dei rituali per i defunti), senza aggiungere date o fatti non scritti nel CONTESTO_DATI.",
          "Se il CONTESTO_DATI è povero, dilo chiaramente («i materiali non specificano…») e non riempire con conoscenza generica esterna.",
        ]
      : [];

  const linguaRisposta =
    navLang === "it"
      ? [
          "Rispondi in italiano, in tono da guida chiara e coinvolgente, ma senza inventare: usa solo i dati nel CONTESTO_DATI e nella domanda.",
        ]
      : navLang === "en"
        ? [
            "IMPORTANT: the CONTESTO_DATI JSON below is in Italian (museum source texts).",
            "You must answer entirely in English, as a professional museum guide: accurately translate and adapt the Italian context for the visitor. Do not invent facts not supported by the data.",
            "Keep proper names of works, artists, and places recognizable (you may add a short Italian original in parentheses once if helpful).",
          ]
        : [
            "IMPORTANT : le JSON CONTESTO_DATI ci-dessous est en italien (textes source du musée).",
            "Vous devez répondre entièrement en français, comme un guide de musée professionnel : traduisez et adaptez fidèlement le contexte italien. N’inventez pas de faits absents des données.",
            "Conservez les noms propres d’œuvres, d’artistes et de lieux reconnaissables (vous pouvez ajouter une courte forme italienne entre parenthèses si utile).",
          ];

  const messaggioAssoluto = [
    "ISTRUZIONE ASSOLUTA — segui questo incarico per prima cosa:",
    `Spiega come una guida museale l’oggetto «${nomeOggetto}», che si trova nel museo «${nomeMuseo}»${cittaMuseo ? ` di «${cittaMuseo}»` : ""}, nella stanza «${stanzaOggetto}»,`,
    `per un visitatore con livello «${livelloPerIstruzione}».`,
    `Lunghezza obiettivo: circa ${targetSec} secondi di lettura ad alta voce (~${parolePerSecondo} parole/s, fino a ~${wordBudget} parole), calibrata su durata profilo, livello «${livelloPerIstruzione}»${domandaAnalitica ? ", domanda analitica" : ""}${vuoleApprofondire ? ", richiesta di approfondimento" : ""}. Solo dati del CONTESTO_DATI.`,
    ...linguaRisposta,
    ...righeQualita,
    "Non puoi vedere le immagini: non descrivere dettagli visivi assenti dal testo.",
    "Se qualcosa non è nei materiali, dilo in una frase breve.",
    ...righeEsperto,
  ].join(" ");

  const livelloIstruzioni = [
    "Dettaglio per livello (sempre ancorato ai dati):",
    "- bambino: frasi brevissime, parole semplici.",
    "- studente: chiaro, ordinato, una o due frasi ben costruite.",
    "- esperto: più frasi, termini d’arte e storici corretti se coerenti con i dati; nessuna risposta monoriga se il budget parole lo consente.",
    "- avanzato: discorso compatto ma stratificato (aspetti collegati), solo se supportato dai dati.",
  ].join(" ");

  const systemPrompt = [messaggioAssoluto, "", livelloIstruzioni].join(" ");

  const contestoDati = {
    museo: {
      nome: museo?.nome || "",
      citta: museo?.citta || "",
    },
    stanza: oggetto?.stanza || "",
    oggetto: {
      nome: oggetto?.nome || "",
      autore: oggetto?.autore || "",
      anno: oggetto?.anno || "",
      correnteArtistica: oggetto?.correnteArtistica || "",
      textTitle: oggetto?.textTitle || "",
      textBody: oggetto?.textBody || "",
    },
    nostraDescrizionePerProfilo: oggetto?.descrizionePreferita || "",
    descrizioniMatriceMuseo: Array.isArray(oggetto?.descrizioniMatrice) ? oggetto.descrizioniMatrice : [],
    immaginiOggetto: Array.isArray(immaginiOggetto) ? immaginiOggetto : [],
    preferenzeUtente: {
      livello: livello || "studente",
      durata: durata || "medio",
      linguaRispostaNavigazione: navLang,
      interessi: Array.isArray(userPrefs?.interessi) ? userPrefs.interessi.filter(Boolean) : [],
    },
    impostazioniLetturaDalProfilo: {
      difficolta: livello || "studente",
      durataScelta: durata || "medio",
      secondiSoloDurataProfilo: secondiSoloDurata,
      moltiplicatoreLivello: moltiplicatoreSecondiPerLivello(livello),
      lunghezzaLetturaSecondiEffettivi: targetSec,
      approfondimentoRichiesto: vuoleApprofondire,
      domandaAnalitica,
      nota: "I secondi effettivi combinano durata profilo, livello (esperto/avanzato allunga), tipo di domanda e richiesta di approfondimento.",
    },
    metaLunghezza: {
      secondiLetturaTarget: targetSec,
      paroleIndicativeMax: wordBudget,
      parolePerSecondoIndicative: Number(parolePerSecondo),
    },
  };

  const userContent = [
    messaggioAssoluto,
    "",
    "DOMANDA DELLO SPETTATORE:",
    cleanQuestion,
    "",
    "La risposta va formulata rispettando tutti i vincoli dell’ISTRUZIONE ASSOLUTA sopra (lunghezza, livello, solo dati del contesto, tono guida, niente ripetizione vuota della sola riga breve).",
    "",
    "CONTESTO_DATI (JSON):",
    JSON.stringify(contestoDati),
  ].join("\n");

  const maxTokens = Math.min(
    1100,
    Math.max(
      260,
      Math.ceil(wordBudget * 3) +
        (vuoleApprofondire ? 140 : 0) +
        (domandaAnalitica ? 100 : 0) +
        (livello === "esperto" || livello === "avanzato" ? 120 : 0)
    )
  );

  const payload = {
    model: AI_MODEL,
    temperature:
      vuoleApprofondire || domandaAnalitica || livello === "esperto" || livello === "avanzato"
        ? 0.52
        : 0.42,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  const headers = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers.Authorization = authHeader;

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`AI upstream error (${response.status}): ${errText || "unknown"}`);
    }

    const data = await response.json();
    const answer = String(extractChatCompletionText(data) || "").trim();
    if (!answer) {
      const finishReason = String(data?.choices?.[0]?.finish_reason || "").trim();
      const hasToolCalls = Array.isArray(data?.choices?.[0]?.message?.tool_calls) && data.choices[0].message.tool_calls.length > 0;
      const hint = [
        finishReason ? `finish_reason=${finishReason}` : "",
        hasToolCalls ? "tool_calls=1" : "",
      ].filter(Boolean).join(" ");
      throw new Error(`Risposta AI vuota${hint ? ` (${hint})` : ""}`);
    }
    return answer;
  } catch (err) {
    if (AI_STRICT) throw err;
    const msg = err instanceof Error ? err.message : "unknown";
    return `${buildFallbackObjectAnswer({ question: cleanQuestion, museo, oggetto, userPrefs })} (Nota tecnica: ${msg})`;
  }
}

// ============================================================
// AI MUSEUM GUIDE (chat generica sul museo)
// ============================================================

/**
 * Costruisce un contesto compatto del museo per la chat generica.
 * Pensato per stare entro pochi KB anche con musei grandi: non includiamo
 * descrizioni complete degli oggetti, solo dati strutturali (stanza, autore,
 * corrente, anno, eventuale titolo) + label tradotte delle stanze dal layout.
 * Gli item objectType \"text\" (schede solo testo sulla mappa) sono esclusi dalla lista:
 * nella chat museo si ignorano per orientamento/descrizione come opere esposte.
 */
function buildMuseumContextForAI({ museo, layout, navLang }) {
  const lang = normalizeNavLang(navLang);
  const labelI18n = (layout && layout.labelI18n && layout.labelI18n.stanze) || {};
  const rooms = layout && layout.rooms && typeof layout.rooms === "object" ? layout.rooms : {};
  const grid = layout && layout.grid && typeof layout.grid === "object" ? layout.grid : {};
  const stanzeKeys = new Set([...Object.keys(rooms), ...Object.keys(grid)]);

  const stanze = Array.from(stanzeKeys).map((key) => {
    const room = rooms[key] || {};
    const cell = grid[key] || {};
    const tipo = String(room.tipo || cell.tipo || "normale").trim().toLowerCase() || "normale";
    const tradotte = labelI18n[key] && typeof labelI18n[key] === "object" ? labelI18n[key] : null;
    const label = tradotte && tradotte[lang] ? String(tradotte[lang]).trim() : key;
    const out = { id: key, label, tipo };
    if (typeof room.x === "number" && typeof room.y === "number") {
      out.posizione = { x: room.x, y: room.y, w: room.w || 0, h: room.h || 0 };
    }
    if (typeof cell.row === "number" && typeof cell.col === "number") {
      out.griglia = { row: cell.row, col: cell.col };
    }
    return out;
  });

  const oggettiList = Array.from(museo?.oggetti instanceof Map ? museo.oggetti.values() : []);
  const oggetti = oggettiList
    .filter((raw) => {
      const ot = String(raw?.objectType || "").trim().toLowerCase() || "normal";
      return ot !== "text";
    })
    .map((o) => {
      const objectType = String(o?.objectType || "").trim().toLowerCase() || "normal";
      return {
        nome: String(o?.nome || "").trim(),
        stanza: String(o?.stanza || "").trim(),
        objectType,
        autore: String(o?.autore || "").trim() || undefined,
        anno: String(o?.anno || "").trim() || undefined,
        correnteArtistica: String(o?.correnteArtistica || "").trim() || undefined,
        connessi: Array.isArray(o?.connessi) ? o.connessi.filter(Boolean).slice(0, 6) : [],
      };
    })
    .filter((o) => o.nome);

  const stanzeConOggetti = {};
  for (const o of oggetti) {
    if (!o.stanza) continue;
    if (!stanzeConOggetti[o.stanza]) stanzeConOggetti[o.stanza] = [];
    stanzeConOggetti[o.stanza].push(o.nome);
  }

  const percorsiRaw = Array.isArray(museo?.percorsi) ? museo.percorsi : [];
  const percorsiCatalogo = percorsiRaw
    .slice(0, 16)
    .map((p) => {
      const tappe = Array.isArray(p?.oggetti)
        ? p.oggetti.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 36)
        : [];
      const nomePercorso = String(p?.nome || "").trim();
      if (!nomePercorso && tappe.length < 1) return null;
      return { nome: nomePercorso || "Senza nome", tappe };
    })
    .filter(Boolean);

  const stanzeRiassuntoTipo = stanze.reduce(
    (acc, s) => {
      const t = String(s.tipo || "normale").toLowerCase();
      if (!acc[t]) acc[t] = [];
      acc[t].push(s.label || s.id);
      return acc;
    },
    /** @type {Record<string, string[]>} */ ({})
  );

  const indirizzo = String(museo?.indirizzo ?? "").trim();
  const palazzo = String(museo?.palazzo ?? "").trim();
  const istruzioniAccesso = String(museo?.istruzioniAccesso ?? "").trim();

  return {
    museo: {
      nome: String(museo?.nome || "").trim(),
      citta: String(museo?.citta || "").trim(),
      ...(indirizzo ? { indirizzo } : {}),
      ...(palazzo ? { palazzo } : {}),
      ...(istruzioniAccesso ? { istruzioniAccesso } : {}),
    },
    stanze,
    stanzeRiassuntoTipo,
    percorsiCatalogo,
    oggetti,
    stanzeConOggetti,
  };
}

/**
 * Chat generica "Chiedi alla guida": risponde sia su singoli oggetti che
 * su come muoversi nel museo (es. "dov'e' il bagno?", "cosa vedo in questa
 * stanza?", "qual e' il prossimo oggetto del mio percorso?"). La risposta
 * resta corta (2-4 frasi) per essere comoda da leggere/ascoltare in mappa.
 */
async function askMuseumGuideAI({
  question,
  museoCtx,
  positionCtx,
  history,
  navLang,
}) {
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) throw new Error("Domanda vuota");

  const lang = normalizeNavLang(navLang);

  if (!aiUpstreamReady()) {
    // Fallback super semplice: prova a indovinare se chiede una stanza nota.
    const lc = cleanQuestion.toLowerCase();
    const museoBlk = museoCtx?.museo || {};
    const accessSnippet = [museoBlk.indirizzo, museoBlk.palazzo, museoBlk.istruzioniAccesso].filter(Boolean).join(" · ");
    if (
      accessSnippet &&
      /\b(indirizzo|ubicazione|dove\s+(è|si\s+trova|si\s+trova\s+il)|come\s+(arrivo|arrivare|si\s+arriva)|ingresso|accesso)|\b(address|location|how\s+to\s+(get|reach)|where\s+(is|to\s+find))|\b(adresse|accès|comment\s+(venir|arriver))\b/i.test(
        lc
      )
    ) {
      return lang === "it"
        ? `Info dal profilo museo: ${accessSnippet}`
        : lang === "fr"
          ? `Infos du profil du musée : ${accessSnippet}`
          : `From the museum profile: ${accessSnippet}`;
    }
    const srTipo = museoCtx?.stanzeRiassuntoTipo || {};
    if (/\b(wc|toilettes?|bagno\b|servizi\s+igienic)/i.test(lc) && srTipo.wc && srTipo.wc.length) {
      const labels = srTipo.wc.slice(0, 3).join(", ");
      return lang === "it"
        ? `Secondo la mappa, servizi correlati alla tipo «wc»: ${labels}. Apri la mappa e cerca queste sale oppure usa i collegamenti rapidi se disponibili.`
        : lang === "fr"
          ? `D'après le plan (type WC) : ${labels}. Ouvrez la carte ou les raccourcis si disponibles.`
          : `From the floor plan (WC-type rooms): ${labels}. Use the map or quick links if shown.`;
    }
    if (/\b(shop|bookshop|museum\s+shop|negozio|boutique\s+mus)/i.test(lc) && srTipo.shop && srTipo.shop.length) {
      const labels = srTipo.shop.slice(0, 3).join(", ");
      return lang === "it"
        ? `Punti di tipo shop sulla mappa: ${labels}.`
        : lang === "fr"
          ? `Points type boutique sur le plan : ${labels}.`
          : `Shop-type areas on the map: ${labels}.`;
    }
    if (museoCtx?.stanze?.length) {
      const hit = museoCtx.stanze.find((s) =>
        lc.includes(String(s.label || "").toLowerCase()) ||
        lc.includes(String(s.id || "").toLowerCase())
      );
      if (hit) {
        return lang === "it"
          ? `La sala "${hit.label}" si trova nella mappa: usa il percorso o tocca la sala per andarci.`
          : lang === "fr"
            ? `La salle "${hit.label}" se trouve sur la carte : utilisez le parcours ou touchez la salle.`
            : `Room "${hit.label}" is on the map: use the path or tap the room to get there.`;
      }
    }
    return lang === "it"
      ? "La guida AI non è raggiungibile in questo momento. Prova più tardi."
      : lang === "fr"
        ? "Le guide IA n'est pas joignable pour l'instant. Réessayez plus tard."
        : "The AI guide is not reachable right now. Please try again later.";
  }

  const authHeader = resolveAiAuthHeader();

  const linguaRisposta =
    lang === "it"
      ? [
          "Rispondi in italiano, in tono di guida museale gentile e concreta.",
          "Sii breve: 2-4 frasi al massimo, niente elenchi puntati lunghi.",
        ]
      : lang === "en"
        ? [
            "IMPORTANT: the JSON CONTESTO_DATI below uses Italian source labels.",
            "Answer entirely in English, friendly museum-guide tone.",
            "Be brief: 2-4 sentences max, no long bullet lists.",
            "Translate room labels and object names if natural; keep proper names recognizable.",
          ]
        : [
            "IMPORTANT : le JSON CONTESTO_DATI ci-dessous est en italien.",
            "Répondez entièrement en français, ton de guide de musée bienveillant.",
            "Soyez bref : 2-4 phrases maximum, pas de longues listes à puces.",
            "Traduisez les noms de salles si c'est naturel, gardez les noms propres reconnaissables.",
          ];

  const istruzione = [
    "ISTRUZIONE ASSOLUTA — sei la guida del museo. Rispondi alle domande del visitatore",
    "usando ESCLUSIVAMENTE i dati del CONTESTO_DATI (mappa del museo, stanze, oggetti, percorsi, accesso al luogo)",
    "e la POSIZIONE_VISITATORE. Non inventare opere, autori o stanze che non sono nel JSON.",
    "Per «come arrivo al museo», indirizzo, ingressi, ingresso disabili o note pratiche: usa solo museo.indirizzo, museo.palazzo, museo.istruzioniAccesso se presenti; se mancano, dichiaralo senza inventare.",
    "Percorso attivo nell'app: in POSIZIONE_VISITATORE usa l'array «percorsoAttivoNelNavigator» (stabilità: è la lista inviata dal client / navigator che descrive la visita CORRENTE: percorso acquistato, visita IA o visita guidata). percorsiCatalogo in CONTESTO_DATI elenca altri percorsi in catalogo: non sostituiscono questa sequenza.",
    "Ignora per descrizione come «opera esposta» gli oggetti con objectType \"text\": non sono nel JSON oggetti. Se in percorso compaiono id tipo __text__… (solo visite guidate), sono contenuti solo testuali in stanza — non cercarli nell'elenco opere né come dipinti/statue.",
    "Usa stanzeRiassuntoTipo per collegare i servizi alle etichette delle sale (ingresso, uscita, wc, shop, corridoio, normale…).",
    "Usa percorsiCatalogo solo per confrontare o menzionare alternative; la sequenza autoritativa dell'utente è «percorsoAttivoNelNavigator» in POSIZIONE_VISITATORE. La mappa usa nodi tecnici IN/OUT/SHOP/WC (vedi notaPercorso).",
    "Domande possibili: descrizione di un oggetto/stanza, indicazioni di spostamento in museo (bagno, shop, sala), ordine delle tappe, prossimo passo suggerito.",
    "Navigazione in museo: combina tipo stanza, posizione (stanza/oggetto correnti) e eventualmente la sequenza nel percorso (tappa prima/dopo/indice); resta sintetico e orientativo come su una mappa SVG.",
    "Se non hai dati sufficienti, dillo in una frase invece di inventare.",
    ...linguaRisposta,
  ].join(" ");

  const systemPrompt = istruzione;

  const trimmedHistory = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
        .slice(-6)
    : [];

  const contestoDati = {
    museo: museoCtx?.museo || { nome: "", citta: "" },
    stanze: museoCtx?.stanze || [],
    stanzeRiassuntoTipo: museoCtx?.stanzeRiassuntoTipo || {},
    stanzeConOggetti: museoCtx?.stanzeConOggetti || {},
    percorsiCatalogo: museoCtx?.percorsiCatalogo || [],
    oggetti: museoCtx?.oggetti || [],
    posizioneVisitatore: positionCtx || {},
  };

  const userContent = [
    "DOMANDA DEL VISITATORE:",
    cleanQuestion,
    "",
    "POSIZIONE_VISITATORE (JSON):",
    JSON.stringify(positionCtx || {}),
    "",
    "CONTESTO_DATI (JSON):",
    JSON.stringify(contestoDati),
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of trimmedHistory) {
    messages.push({ role: m.role, content: String(m.text || "").slice(0, 2000) });
  }
  messages.push({ role: "user", content: userContent });

  const payload = {
    model: AI_MODEL,
    temperature: 0.35,
    max_tokens: 480,
    messages,
  };

  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`AI upstream error (${response.status}): ${errText || "unknown"}`);
    }
    const data = await response.json();
    const answer = String(extractChatCompletionText(data) || "").trim();
    if (!answer) throw new Error("Risposta AI vuota");
    return answer;
  } catch (err) {
    if (AI_STRICT) throw err;
    const msg = err instanceof Error ? err.message : "unknown";
    return (
      (lang === "it"
        ? "Non riesco a rispondere adesso. "
        : lang === "fr"
          ? "Je ne peux pas répondre maintenant. "
          : "I can't answer right now. ") + `(Nota tecnica: ${msg})`
    );
  }
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

async function ensureMuseiIndexes() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const col = client.db(DB_NAME).collection(QR_CODES_COLLECTION);
    await col.createIndex({ hash: 1 }, { unique: true });
    await col.createIndex({ museo: 1, oggetto: 1 });
    await col.createIndex({ enabled: 1 });
  } finally {
    await client.close();
  }
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
        indirizzo: d.indirizzo,
        palazzo: d.palazzo,
        istruzioniAccesso: d.istruzioniAccesso,
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
  await ensureMuseiIndexes();
  console.log("✅ Indici musei/QR pronti");

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
        navLang: input.navLang,
        eta: input.eta,
        ruolo,
        percorsiAcquistati: [],
        percorsiPersonalizzati: [],
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

  app.get("/users/me/percorsi/personalizzati", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const museo = String(req.query?.museo || "").trim();
      const routes = Array.isArray(session.user.percorsiPersonalizzati) ? session.user.percorsiPersonalizzati : [];
      const normalized = routes
        .map((r) => normalizePersonalRouteStorage(r))
        .filter((r) => !museo || r.museo === museo);
      res.json({ percorsiPersonalizzati: normalized });
    } catch (err) {
      console.error("Errore lista percorsi personalizzati:", err.message);
      res.status(500).json({ error: "errore recupero percorsi personalizzati" });
    }
  });

  app.get("/users/me/percorsi/personalizzati/:id", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const id = String(req.params?.id || "").trim();
      if (!id) return res.status(400).json({ error: "id percorso obbligatorio" });
      const routes = Array.isArray(session.user.percorsiPersonalizzati) ? session.user.percorsiPersonalizzati : [];
      const routeIndex = routes.findIndex((r) => String(r?.id || "").trim() === id);
      if (routeIndex < 0) return res.status(404).json({ error: "percorso personalizzato non trovato" });
      const ensured = await ensureCustomDescriptionsI18n(routes[routeIndex]);
      const route = ensured.route;
      if (!route) return res.status(404).json({ error: "percorso personalizzato non trovato" });
      if (ensured.changed) {
        const userId = new ObjectId(String(session.user._id));
        const nextRoutes = routes.slice();
        nextRoutes[routeIndex] = route;
        await withUsersDb(async (db) => {
          await db.collection(USERS_COLLECTION).updateOne(
            { _id: userId },
            { $set: { percorsiPersonalizzati: nextRoutes, updatedAt: new Date() } }
          );
        });
      }
      res.json({ percorsoPersonalizzato: route });
    } catch (err) {
      console.error("Errore dettaglio percorso personalizzato:", err.message);
      res.status(500).json({ error: "errore dettaglio percorso personalizzato" });
    }
  });

  app.delete("/users/me/percorsi/personalizzati/:id", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const id = String(req.params?.id || "").trim();
      if (!id) return res.status(400).json({ error: "id percorso obbligatorio" });
      const userId = new ObjectId(String(session.user._id));
      await withUsersDb(async (db) => {
        await db.collection(USERS_COLLECTION).updateOne(
          { _id: userId },
          {
            $pull: { percorsiPersonalizzati: { id } },
            $set: { updatedAt: new Date() },
          }
        );
      });
      res.json({ ok: true, id });
    } catch (err) {
      console.error("Errore delete percorso personalizzato:", err.message);
      res.status(500).json({ error: "errore eliminazione percorso personalizzato" });
    }
  });

  app.get("/users/me/percorsi/combined", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const museoNome = String(req.query?.museo || "").trim();
      if (!museoNome) return res.status(400).json({ error: "museo obbligatorio" });
      const museo = sistema.get_museo(museoNome);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const purchased = Array.isArray(session.user.percorsiAcquistati) ? session.user.percorsiAcquistati : [];
      const purchaseKeys = new Set(purchased.map((p) => percorsoPurchaseKey(p?.museo, p?.percorso)));
      const standard = (Array.isArray(museo.percorsi) ? museo.percorsi : [])
        .map((p) => normalizePercorso(p))
        .filter((p) => {
          const included = Number(p.prezzo || 0) <= 0;
          return included || purchaseKeys.has(percorsoPurchaseKey(museoNome, p.nome));
        })
        .map((p) => ({
          id: `std::${museoNome}::${p.nome}`,
          source: "standard",
          museo: museoNome,
          nome: p.nome,
          oggetti: p.oggetti || [],
          prezzo: p.prezzo || 0,
        }));

      const personalized = (Array.isArray(session.user.percorsiPersonalizzati) ? session.user.percorsiPersonalizzati : [])
        .map((r) => normalizePersonalRouteStorage(r, museoNome))
        .filter((r) => r.museo === museoNome)
        .map((r) => ({
          id: r.id,
          source: "ai_personalized",
          museo: r.museo,
          nome: r.nome,
          oggetti: r.objectNodes,
          flowNodes: r.flowNodes,
          textSteps: r.textSteps,
          customDescriptionsByObject: r.customDescriptionsByObject,
          customDescriptionsByObjectI18n: r.customDescriptionsByObjectI18n,
          lengthPreset: r.lengthPreset,
          targetRatio: r.targetRatio,
          prezzo: 0,
          createdAt: r.createdAt,
        }));

      res.json({ percorsi: [...standard, ...personalized] });
    } catch (err) {
      console.error("Errore lista percorsi combined:", err.message);
      res.status(500).json({ error: "errore recupero percorsi combined" });
    }
  });

  app.post("/users/me/percorsi/personalizzati/genera", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const userRateKey = String(session.user._id);
      const lastReqTs = Number(personalRouteRateMap.get(userRateKey) || 0);
      if (Date.now() - lastReqTs < PERSONAL_ROUTE_AI_RATE_MS) {
        return res.status(429).json({ error: "richieste troppo frequenti, riprova tra pochi secondi" });
      }
      personalRouteRateMap.set(userRateKey, Date.now());
      const museoNome = String(req.body?.museo || "").trim();
      if (!museoNome) return res.status(400).json({ error: "museo obbligatorio" });
      const lengthPreset = normalizePersonalRouteLengthPreset(req.body?.lengthPreset);
      const museo = sistema.get_museo(museoNome);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const objectDocs = buildMuseumObjectDocs(museo).filter((o) => {
        const key = String(o.nome || "").trim().toLowerCase();
        return key !== "in" && key !== "out";
      });
      if (objectDocs.length < 1) return res.status(400).json({ error: "museo senza oggetti utili" });

      const targetCount = personalRouteTargetCount(objectDocs.length, lengthPreset);
      const userPrefs = {
        interessi: Array.isArray(session.user.interessi) ? session.user.interessi : [],
        livello: session.user.livello || "studente",
        durata: session.user.durata || "medio",
        navLang: normalizeNavLang(session.user.navLang),
      };

      const fallbackRoute = fallbackPersonalizedRoute({ objectDocs, targetCount, userPrefs });
      const aiRouteRaw = await withTimeout(aiGeneratePersonalRoute({
        museoNome,
        objectDocs,
        targetCount,
        userPrefs,
      }), 16000, "ai_route").catch((err) => {
        console.warn("AI1 fallback route planner:", err.message);
        return fallbackRoute;
      });

      const repaired = validateAndRepairPersonalRoute({
        objectDocs,
        aiRoute: aiRouteRaw,
        targetCount,
      });

      const generatedDescriptionsByLangEntries = await Promise.all(
        ALLOWED_NAV_LANGS.map(async (lang) => {
          const rows = await withTimeout(aiGeneratePersonalDescriptions({
            museoNome,
            objectDocs,
            selectedObjects: repaired.objectNodes || repaired.selectedObjects,
            userPrefs,
            navLangOverride: lang,
          }), 18000, `ai_descriptions_${lang}`).catch((err) => {
            console.warn(`AI2 fallback descrizioni ${lang}:`, err.message);
            return {};
          });
          return [lang, rows];
        })
      );
      const generatedDescriptionsByLang = Object.fromEntries(generatedDescriptionsByLangEntries);
      const baseTextMap = {
        ...(fallbackRoute.textDescriptionsByObject && typeof fallbackRoute.textDescriptionsByObject === "object"
          ? fallbackRoute.textDescriptionsByObject
          : {}),
        ...(repaired.textDescriptionsByObject && typeof repaired.textDescriptionsByObject === "object"
          ? repaired.textDescriptionsByObject
          : {}),
      };
      const textDescriptionsByLangEntries = await Promise.all(
        ALLOWED_NAV_LANGS.map(async (lang) => {
          const translated = await withTimeout(
            aiTranslateCustomTextMap({ textMap: baseTextMap, targetLang: lang }),
            12000,
            `ai_translate_textsteps_${lang}`
          ).catch(() => baseTextMap);
          return [lang, translated];
        })
      );
      const textDescriptionsByLang = Object.fromEntries(textDescriptionsByLangEntries);
      const textStepByNode = new Map(
        (Array.isArray(repaired.textSteps) ? repaired.textSteps : [])
          .map((s) => [`__text__${String(s?.id || "").trim()}`, s])
      );
      for (const lang of ALLOWED_NAV_LANGS) {
        if (lang === "it") continue;
        const row = textDescriptionsByLang[lang] && typeof textDescriptionsByLang[lang] === "object"
          ? textDescriptionsByLang[lang]
          : {};
        for (const [key, baseText] of Object.entries(baseTextMap)) {
          const v = String(row[key] || "").trim();
          const b = String(baseText || "").trim();
          if (!b) continue;
          if (!v || v === b) {
            const step = textStepByNode.get(key);
            row[key] = fallbackFocusTextByLang({
              lang,
              room: step?.room || "",
              objectName: step?.insertAfterObject || "",
              interests: userPrefs?.interessi || [],
            });
          }
        }
        textDescriptionsByLang[lang] = row;
      }
      const routeNodesForDescriptions = uniqueStrings(
        Array.isArray(repaired.flowNodes) && repaired.flowNodes.length > 0
          ? repaired.flowNodes
          : (repaired.objectNodes || repaired.selectedObjects)
      );

      const byName = new Map(objectDocs.map((o) => [o.nome, o]));
      const mergedDescriptionsByLang = {};
      for (const lang of ALLOWED_NAV_LANGS) {
        const mergedDescriptions = {};
        const langRows = generatedDescriptionsByLang[lang] && typeof generatedDescriptionsByLang[lang] === "object"
          ? generatedDescriptionsByLang[lang]
          : {};
        for (const name of routeNodesForDescriptions) {
          const overrideText = textDescriptionsByLang?.[lang]?.[name];
          if (overrideText) {
            mergedDescriptions[name] = overrideText;
            continue;
          }
          if (langRows[name]) {
            mergedDescriptions[name] = langRows[name];
            continue;
          }
          const localizedMatrix = descrizioniMatrixForNavLang({
            descrizioni: byName.get(name)?.descrizioni || [],
            descrizioniI18n: byName.get(name)?.descrizioniI18n || {},
          }, lang);
          const fallback = pickOurDescription(localizedMatrix, userPrefs);
          mergedDescriptions[name] = fallback || `Descrizione personalizzata non disponibile per ${name}.`;
        }
        mergedDescriptionsByLang[lang] = mergedDescriptions;
      }

      const now = new Date();
      const customRouteName = String(req.body?.nome || "").trim();
      const routeName =
        customRouteName || `Visita personalizzata ${lengthPreset} ${now.toLocaleDateString("it-IT")}`;
      const routeDoc = normalizePersonalRouteStorage({
        id: new ObjectId().toString(),
        museo: museoNome,
        nome: routeName,
        lengthPreset,
        targetRatio: PERSONAL_ROUTE_LENGTH_PRESETS[lengthPreset] || 0.5,
        flowNodes: repaired.flowNodes,
        objectNodes: repaired.objectNodes || repaired.selectedObjects,
        textSteps: repaired.textSteps,
        customDescriptionsByObject: mergedDescriptionsByLang[userPrefs.navLang] || mergedDescriptionsByLang.it || {},
        customDescriptionsByObjectI18n: mergedDescriptionsByLang,
        generatedFrom: userPrefs,
        createdAt: now,
        updatedAt: now,
      }, museoNome);

      const userId = new ObjectId(String(session.user._id));
      await withUsersDb(async (db) => {
        const usersCol = db.collection(USERS_COLLECTION);
        const fresh = await usersCol.findOne({ _id: userId }, { projection: { percorsiPersonalizzati: 1 } });
        const current = Array.isArray(fresh?.percorsiPersonalizzati) ? fresh.percorsiPersonalizzati : [];
        const capped = current.slice(-19);
        await usersCol.updateOne(
          { _id: userId },
          {
            $set: {
              percorsiPersonalizzati: [...capped, routeDoc],
              updatedAt: now,
            },
          }
        );
      });

      res.status(201).json({ percorsoPersonalizzato: routeDoc });
    } catch (err) {
      console.error("Errore generazione percorso personalizzato:", err.message);
      res.status(500).json({ error: "errore generazione percorso personalizzato" });
    }
  });

  app.get("/users/me/oggetti/richieste", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const museo = String(req.query?.museo || "").trim();
      const oggetto = String(req.query?.oggetto || "").trim();
      const stanza = String(req.query?.stanza || "").trim();
      const filter = { userId: String(session.user._id) };
      if (museo) filter.museo = museo;
      if (oggetto) filter.oggetto = oggetto;
      if (stanza) filter.stanza = stanza;
      const richieste = await withUsersDb(async (db) =>
        db
          .collection(MARKETPLACE_OBJECT_REQUESTS_COLLECTION)
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray()
      );
      res.json({
        prezzoFisso: MARKETPLACE_OBJECT_FIXED_PRICE,
        richieste: richieste.map((r) => ({
          id: String(r._id),
          museo: r.museo,
          oggetto: r.oggetto,
          stanza: r.stanza || "",
          prezzo: normalizePrezzo(r.prezzo),
          status: r.status || "pending",
          note: r.note || "",
          decidedBy: r.decidedBy || "",
          createdAt: r.createdAt,
          decidedAt: r.decidedAt || null,
        })),
      });
    } catch (err) {
      console.error("Errore lista richieste acquisto oggetti:", err.message);
      res.status(500).json({ error: "errore recupero richieste acquisto oggetti" });
    }
  });

  app.post("/users/me/oggetti/acquista-richiesta", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });

      const nomeMuseo = String(req.body?.museo || "").trim();
      const nomeOggetto = String(req.body?.oggetto || "").trim();
      const nomeStanza = String(req.body?.stanza || "").trim();
      if (!nomeMuseo || !nomeOggetto) {
        return res.status(400).json({ error: "museo e oggetto sono obbligatori" });
      }

      const museo = sistema.get_museo(nomeMuseo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const oggettiList = museo?.oggetti instanceof Map
        ? Array.from(museo.oggetti.values())
        : Array.isArray(museo?.oggetti)
          ? museo.oggetti
          : [];
      const oggetto = oggettiList.find((o) => {
        const sameName = String(o?.nome || "").trim() === nomeOggetto;
        if (!sameName) return false;
        if (!nomeStanza) return true;
        return String(o?.stanza || "").trim() === nomeStanza;
      });
      if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });
      const stanzaOggetto = String(oggetto?.stanza || nomeStanza).trim();

      const userId = String(session.user._id);
      const now = new Date();
      const existing = await withUsersDb(async (db) =>
        db.collection(MARKETPLACE_OBJECT_REQUESTS_COLLECTION).findOne({
          userId,
          museo: nomeMuseo,
          oggetto: nomeOggetto,
          stanza: stanzaOggetto,
          status: { $in: ["pending", "approved"] },
        })
      );
      if (existing) {
        return res.json({
          duplicate: true,
          richiesta: {
            id: String(existing._id),
            museo: existing.museo,
            oggetto: existing.oggetto,
            stanza: existing.stanza || "",
            prezzo: normalizePrezzo(existing.prezzo),
            status: existing.status || "pending",
            createdAt: existing.createdAt,
          },
        });
      }

      const richiesta = {
        userId,
        userEmail: String(session.user.email || ""),
        userNome: String(session.user.nome || ""),
        userCognome: String(session.user.cognome || ""),
        museo: nomeMuseo,
        oggetto: nomeOggetto,
        stanza: stanzaOggetto,
        prezzo: MARKETPLACE_OBJECT_FIXED_PRICE,
        status: "pending",
        note: "",
        decidedBy: "",
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await withUsersDb(async (db) =>
        db.collection(MARKETPLACE_OBJECT_REQUESTS_COLLECTION).insertOne(richiesta)
      );
      res.status(201).json({
        duplicate: false,
        richiesta: {
          ...richiesta,
          id: String(inserted.insertedId),
        },
      });
    } catch (err) {
      console.error("Errore richiesta acquisto oggetto:", err.message);
      res.status(500).json({ error: "errore richiesta acquisto oggetto" });
    }
  });

  app.get("/admin/marketplace/richieste", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isAdmin(session.user)) return res.status(403).json({ error: "solo admin" });

      const museo = String(req.query?.museo || "").trim();
      const status = String(req.query?.status || "").trim().toLowerCase();
      const filter = {};
      if (museo) filter.museo = museo;
      if (status) filter.status = status;
      const richieste = await withUsersDb(async (db) =>
        db
          .collection(MARKETPLACE_OBJECT_REQUESTS_COLLECTION)
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray()
      );
      res.json({
        prezzoFisso: MARKETPLACE_OBJECT_FIXED_PRICE,
        richieste: richieste.map((r) => ({
          id: String(r._id),
          userId: r.userId,
          userEmail: r.userEmail || "",
          userNome: r.userNome || "",
          userCognome: r.userCognome || "",
          museo: r.museo,
          oggetto: r.oggetto,
          stanza: r.stanza || "",
          prezzo: normalizePrezzo(r.prezzo),
          status: r.status || "pending",
          note: r.note || "",
          decidedBy: r.decidedBy || "",
          createdAt: r.createdAt,
          decidedAt: r.decidedAt || null,
        })),
      });
    } catch (err) {
      console.error("Errore lista richieste admin marketplace:", err.message);
      res.status(500).json({ error: "errore lista richieste admin marketplace" });
    }
  });

  app.patch("/admin/marketplace/richieste/:id", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      if (!isAdmin(session.user)) return res.status(403).json({ error: "solo admin" });

      const id = String(req.params?.id || "").trim();
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "id richiesta non valido" });
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "status non valido (approved|rejected)" });
      }
      const note = String(req.body?.note || "").trim();
      const decidedBy = String(session.user.email || session.user.nome || "admin");
      const now = new Date();
      const requestId = new ObjectId(id);
      const collName = MARKETPLACE_OBJECT_REQUESTS_COLLECTION;

      const richiesta = await withUsersDb(async (db) => db.collection(collName).findOne({ _id: requestId }));
      if (!richiesta) return res.status(404).json({ error: "richiesta non trovata" });
      if (String(richiesta.status || "").toLowerCase() !== "pending") {
        return res.status(400).json({ error: "richiesta gia processata" });
      }

      await withUsersDb(async (db) => {
        await db.collection(collName).updateOne(
          { _id: requestId },
          { $set: { status, note, decidedBy, decidedAt: now, updatedAt: now } }
        );
        if (status === "approved") {
          await db.collection(USERS_COLLECTION).updateOne(
            { _id: new ObjectId(String(richiesta.userId)) },
            {
              $addToSet: {
                oggettiAcquistati: {
                  museo: richiesta.museo,
                  oggetto: richiesta.oggetto,
                  stanza: richiesta.stanza || "",
                  prezzo: normalizePrezzo(richiesta.prezzo),
                  purchasedAt: now,
                },
              },
              $set: { updatedAt: now },
            }
          );

          // Rimuove l'oggetto dal museo e ricuce i collegamenti (A->B->C diventa A->C)
          const museo = sistema.get_museo(richiesta.museo);
          if (museo) {
            const removedName = String(richiesta.oggetto || "").trim();
            const removedObj = museo.get_oggetto(removedName);
            if (removedObj) {
              const successors = Array.isArray(removedObj.connessi)
                ? removedObj.connessi.map((x) => String(x || "").trim()).filter(Boolean)
                : [];
              const predecessors = [];

              for (const obj of museo.oggetti.values()) {
                if (obj.nome === removedName) continue;
                const current = Array.isArray(obj.connessi) ? obj.connessi.map((x) => String(x || "").trim()).filter(Boolean) : [];
                if (!current.includes(removedName)) continue;
                predecessors.push(obj.nome);
                const rewritten = current.filter((n) => n !== removedName);
                for (const nxt of successors) {
                  if (nxt && nxt !== obj.nome && nxt !== removedName && !rewritten.includes(nxt)) {
                    rewritten.push(nxt);
                  }
                }
                obj.connessi = rewritten;
              }

              // Ricucitura simmetrica: se il grafo e` usato anche "al contrario",
              // colleghiamo anche i successori verso i predecessori.
              for (const succ of successors) {
                const succObj = museo.get_oggetto(succ);
                if (!succObj) continue;
                const succConns = Array.isArray(succObj.connessi)
                  ? succObj.connessi.map((x) => String(x || "").trim()).filter(Boolean)
                  : [];
                for (const pred of predecessors) {
                  if (!pred || pred === succ || pred === removedName) continue;
                  if (!succConns.includes(pred)) succConns.push(pred);
                }
                succObj.connessi = succConns;
              }

              museo.oggetti.delete(removedName);
              if (!Array.isArray(museo.percorsi)) museo.percorsi = [];
              museo.percorsi = museo.percorsi.map((p) => ({
                ...p,
                oggetti: Array.isArray(p.oggetti) ? p.oggetti.filter((n) => n !== removedName) : [],
              }));

              // Rebuild mappa_oggetti dopo le modifiche ai connessi
              museo.mappa_oggetti.adj.clear();
              for (const obj of museo.oggetti.values()) {
                museo.mappa_oggetti.addNode(obj.nome);
              }
              for (const obj of museo.oggetti.values()) {
                const conns = Array.isArray(obj.connessi) ? obj.connessi : [];
                for (const to of conns) {
                  if (museo.oggetti.has(to)) museo.mappa_oggetti.addEdge(obj.nome, to);
                }
              }

              sistema.salvaSuFile(FILE_JSON);
              try {
                await upsertMuseo({
                  nome: museo.nome,
                  citta: museo.citta,
                  oggetti: Array.from(museo.oggetti.values()),
                  percorsi: museo.percorsi || [],
                });
              } catch (mongoErr) {
                console.error("Errore sync Mongo dopo vendita oggetto marketplace:", mongoErr.message);
              }
            }
          }
        }
      });

      res.json({ ok: true, status, id });
    } catch (err) {
      console.error("Errore update richiesta admin marketplace:", err.message);
      res.status(500).json({ error: "errore update richiesta admin marketplace" });
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
              navLang: input.navLang,
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

  /** Aggiornamento leggero: solo lingua navigatore (it / en / fr) */
  app.patch("/users/me/nav-lang", async (req, res) => {
    try {
      const session = await getSessionUser(req);
      if (!session) return res.status(401).json({ error: "utente non autenticato" });
      const navLang = normalizeNavLang(req.body?.navLang ?? req.body?.nav_lang);
      const userId = new ObjectId(String(session.user._id));
      const updated = await withUsersDb(async (db) => {
        await db.collection(USERS_COLLECTION).updateOne(
          { _id: userId },
          { $set: { navLang, updatedAt: new Date() } }
        );
        return db.collection(USERS_COLLECTION).findOne({ _id: userId });
      });
      res.json({ user: userPublicView(updated) });
    } catch (err) {
      console.error("Errore nav-lang:", err.message);
      res.status(500).json({ error: "errore aggiornamento lingua" });
    }
  });

  // ==========================================================
  // ROUTE — OBJECT AI CHAT
  // ==========================================================
  app.post("/ai/object-chat", async (req, res) => {
    try {
      const nomeMuseo = String(req.body?.museo || "").trim();
      const nomeOggetto = String(req.body?.oggetto || "").trim();
      const question = String(req.body?.question || "").trim();
      if (!nomeMuseo || !nomeOggetto || !question) {
        return res.status(400).json({ error: "museo, oggetto e question sono obbligatori" });
      }

      const museo = sistema.get_museo(nomeMuseo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const oggettoDoc = museo.get_oggetto(nomeOggetto);
      if (!oggettoDoc) return res.status(404).json({ error: "Oggetto non trovato" });

      const session = await getSessionUser(req);
      const userPrefs = session?.user
        ? {
            interessi: Array.isArray(session.user.interessi) ? session.user.interessi : [],
            livello: String(session.user.livello || "").trim(),
            durata: String(session.user.durata || "").trim(),
            navLang: normalizeNavLang(session.user.navLang),
          }
        : {
            interessi: [],
            livello: String(req.body?.livello || "").trim(),
            durata: String(req.body?.durata || "").trim(),
            navLang: normalizeNavLang(req.body?.navLang ?? req.body?.nav_lang),
          };

      const descrizionePreferita = pickOurDescription(oggettoDoc.descrizioni, userPrefs);
      const descrizioniMatrice = descrizioniMatrixForAI(oggettoDoc.descrizioni);
      const immaginiOggetto = await listOggettoImmagineMetas(nomeMuseo, nomeOggetto);

      const aiAnswer = await askObjectAI({
        question,
        museo: { nome: museo.nome, citta: museo.citta },
        oggetto: {
          nome: oggettoDoc.nome,
          stanza: String(oggettoDoc.stanza || "").trim(),
          autore: String(oggettoDoc.autore || "").trim(),
          anno: String(oggettoDoc.anno || "").trim(),
          correnteArtistica: String(oggettoDoc.correnteArtistica || "").trim(),
          textTitle: String(oggettoDoc.textTitle || "").trim(),
          textBody: String(oggettoDoc.textBody || "").trim(),
          descrizionePreferita,
          descrizioneBreve: descrizionePreferita,
          descrizioniMatrice,
        },
        userPrefs,
        immaginiOggetto,
      });

      res.json({ answer: aiAnswer, source: aiUpstreamReady() ? AI_PROVIDER : "fallback" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "unknown");
      console.error("Errore object chat AI:", msg);
      // In dev: restituiamo anche dettagli per capire subito se è 401/429/quota/timeout.
      res.status(502).json({
        error: "errore chat IA oggetto",
        detail: msg,
      });
    }
  });

  // ==========================================================
  // ROUTE — MUSEUM GUIDE CHAT (Chiedi alla guida)
  // ==========================================================
  app.post("/ai/museum-chat", async (req, res) => {
    try {
      const nomeMuseo = String(req.body?.museo || "").trim();
      const question = String(req.body?.question || "").trim();
      if (!nomeMuseo || !question) {
        return res.status(400).json({ error: "museo e question sono obbligatori" });
      }

      const museo = sistema.get_museo(nomeMuseo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });

      const session = await getSessionUser(req);
      const navLang = normalizeNavLang(
        session?.user?.navLang ?? req.body?.navLang ?? req.body?.nav_lang
      );

      // Layout dal Mongo (rooms + grid + label tradotte) — best effort.
      let layout = null;
      const client = new MongoClient(MONGO_URI);
      try {
        await client.connect();
        layout = await client
          .db(DB_NAME)
          .collection(LAYOUT_COLLECTION)
          .findOne({ _id: nomeMuseo });
      } catch (e) {
        console.warn("museum-chat: layout non disponibile:", e?.message || e);
      } finally {
        try { await client.close(); } catch {}
      }

      const museoCtx = buildMuseumContextForAI({ museo, layout, navLang });

      // Contesto posizione: stanza corrente + oggetto corrente (se passato)
      // + percorso (sequenza ordinata di tappe).
      const stanzaCorrente = String(req.body?.stanzaCorrente || "").trim() || null;
      const oggettoCorrente = String(req.body?.oggettoCorrente || "").trim() || null;
      const percorso = Array.isArray(req.body?.percorso)
        ? req.body.percorso.map((s) => String(s || "").trim()).filter(Boolean)
        : [];
      const tappaCorrente = String(req.body?.tappaCorrente || "").trim() || null;
      const refPercorso = oggettoCorrente || tappaCorrente;
      let indiceTappaCorrente = null;
      let tappaPrecedente = null;
      let prossimaTappa = null;
      if (percorso.length > 0) {
        const idx =
          refPercorso !== null && refPercorso !== undefined && refPercorso !== ""
            ? percorso.indexOf(refPercorso)
            : -1;
        indiceTappaCorrente = idx >= 0 ? idx : null;
        if (idx > 0) tappaPrecedente = percorso[idx - 1];
        if (idx >= 0 && idx + 1 < percorso.length) prossimaTappa = percorso[idx + 1];
        else if (idx < 0 && !refPercorso) prossimaTappa = percorso[0];
      }

      const positionCtx = {
        stanzaCorrente,
        oggettoCorrente,
        tappaCorrente,
        percorsoAttivoNelNavigator: percorso,
        tappaPrecedente,
        prossimaTappa,
        indiceTappaCorrente,
        totaleTappePercorso: percorso.length,
        notaPercorso:
          "Sulla mappa la visita usa nodi tecnici IN, OUT, SHOP, WC tra le tappe: servono all'orientamento, non sono opere sul catalogo.",
        notaSequenza:
          "\"percorsoAttivoNelNavigator\" è la sequenza ordinata attualmente attiva nell'app (identica al campo «percorso» nella richiesta HTTP dal navigator). Possono comparire __text__… nelle visite guidate (solo messaggio in sala, non catalogo opere).",
      };

      const history = Array.isArray(req.body?.history) ? req.body.history : [];

      const aiAnswer = await askMuseumGuideAI({
        question,
        museoCtx,
        positionCtx,
        history,
        navLang,
      });

      res.json({
        answer: aiAnswer,
        source: aiUpstreamReady() ? AI_PROVIDER : "fallback",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "unknown");
      console.error("Errore museum chat AI:", msg);
      res.status(502).json({
        error: "errore chat IA museo",
        detail: msg,
      });
    }
  });

  // (STT/TTS disabilitati: versione "solo JS" usa STT client-side e TTS browser)

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

    const layoutDoc = layoutStore[req.params.nome_museo] || {};
    const labelI18n =
      layoutDoc.labelI18n && typeof layoutDoc.labelI18n === "object"
        ? layoutDoc.labelI18n
        : { stanze: {}, percorsi: {} };

    console.log(`Restituisco dati museo '${museo.nome}'`);
    res.json({
      nome: museo.nome,
      citta: museo.citta,
      indirizzo: museo.indirizzo || "",
      palazzo: museo.palazzo || "",
      istruzioniAccesso: museo.istruzioniAccesso || "",
      oggetti: Array.from(museo.oggetti.values()),
      percorsi: museo.percorsi || [],
      labelI18n,
    });
  });

  // ==========================================================
  // ROUTE — QR validate
  // ==========================================================
  app.post("/qr/validate", async (req, res) => {
    const codice = String(req.body?.codice || "").trim();
    const museo = String(req.body?.museo || "").trim();
    const oggetto = String(req.body?.oggetto || "").trim();
    if (!codice || !museo || !oggetto) {
      return res.status(400).json({ error: "Parametri mancanti (codice, museo, oggetto)" });
    }
    const hash = hashQrCode(codice);
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const doc = await client
        .db(DB_NAME)
        .collection(QR_CODES_COLLECTION)
        .findOne({ hash, museo, oggetto, enabled: true });
      if (!doc) {
        console.log(`QR validate KO museo='${museo}' oggetto='${oggetto}'`);
        return res.status(404).json({ error: "Codice QR non valido per quest'opera" });
      }
      console.log(`QR validate OK museo='${museo}' oggetto='${oggetto}'`);
      return res.json({ ok: true, museo, oggetto });
    } catch (err) {
      console.error("QR validate ERROR:", err?.message || err);
      return res.status(500).json({ error: "Errore validazione QR" });
    } finally {
      await client.close();
    }
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

    const indirizzo = String(req.body?.indirizzo ?? "").trim();
    const palazzo = String(req.body?.palazzo ?? "").trim();
    const istruzioniAccesso = String(req.body?.istruzioniAccesso ?? "").trim();
    const museo = { nome, citta, oggetti: oggetti || [], percorsi: [], indirizzo, palazzo, istruzioniAccesso };
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
    if (Object.prototype.hasOwnProperty.call(req.body, "indirizzo")) {
      museo.indirizzo = String(req.body.indirizzo ?? "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "palazzo")) {
      museo.palazzo = String(req.body.palazzo ?? "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "istruzioniAccesso")) {
      museo.istruzioniAccesso = String(req.body.istruzioniAccesso ?? "").trim();
    }

    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({
        nome: museo.nome,
        citta: museo.citta,
        indirizzo: museo.indirizzo || "",
        palazzo: museo.palazzo || "",
        istruzioniAccesso: museo.istruzioniAccesso || "",
        oggetti: Array.from(museo.oggetti.values()),
        percorsi: museo.percorsi || [],
      });
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

    const {
      nome,
      stanza,
      connessi,
      descrizioni,
      pos,
      objectType,
      textTitle,
      textBody,
      autore,
      licenza,
      correnteArtistica,
      anno,
    } = req.body;
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
    if (Object.prototype.hasOwnProperty.call(req.body, "descrizioniI18n")) {
      if (req.body.descrizioniI18n == null) delete oggetto.descrizioniI18n;
      else if (typeof req.body.descrizioniI18n === "object") oggetto.descrizioniI18n = req.body.descrizioniI18n;
    }
    if (objectType != null) oggetto.objectType = String(objectType || "").trim() || "normal";
    if (textTitle != null) oggetto.textTitle = String(textTitle || "").trim();
    if (textBody != null) oggetto.textBody = String(textBody || "").trim();
    if (autore != null) oggetto.autore = String(autore || "").trim();
    if (licenza != null) oggetto.licenza = String(licenza || "").trim();
    if (correnteArtistica != null) oggetto.correnteArtistica = String(correnteArtistica || "").trim();
    if (anno != null) oggetto.anno = String(anno || "").trim();

    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()), percorsi: museo.percorsi || [] });
      console.log(`Oggetto '${oggetto.nome}' aggiornato`);
    } catch (err) {
      console.error("Errore MongoDB:", err.message);
    }

    res.json({ message: `Oggetto '${oggetto.nome}' aggiornato` });
  });

  app.post("/musei/:nome_museo/oggetti/:oggetto/translate-descriptions", async (req, res) => {
    try {
      const museo = sistema.get_museo(req.params.nome_museo);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const og = museo.get_oggetto(req.params.oggetto);
      if (!og) return res.status(404).json({ error: "Oggetto non trovato" });
      const matrixIt = Array.isArray(og.descrizioni) ? og.descrizioni : [];
      const descrizioniI18n = {
        ...(og.descrizioniI18n && typeof og.descrizioniI18n === "object" ? og.descrizioniI18n : {}),
      };
      for (const lang of ["en", "fr"]) {
        descrizioniI18n[lang] = await aiTranslateDescrizioniMatrixFromIt(matrixIt, lang);
      }
      og.descrizioniI18n = descrizioniI18n;
      sistema.salvaSuFile(FILE_JSON);
      try {
        await upsertMuseo({
          nome: museo.nome,
          citta: museo.citta,
          oggetti: Array.from(museo.oggetti.values()),
          percorsi: museo.percorsi || [],
        });
      } catch (err) {
        console.error("Errore MongoDB translate-descriptions:", err.message);
      }
      res.json({ descrizioniI18n });
    } catch (err) {
      console.error("translate-descriptions:", err.message);
      res.status(500).json({ error: err.message || "errore traduzione" });
    }
  });

  app.post("/musei/:nome_museo/layout/translate-labels", async (req, res) => {
    try {
      const nomeM = req.params.nome_museo;
      const museo = sistema.get_museo(nomeM);
      if (!museo) return res.status(404).json({ error: "Museo non trovato" });
      const layoutDoc = layoutStore[nomeM] || {};
      const rooms = layoutDoc.rooms && typeof layoutDoc.rooms === "object" ? layoutDoc.rooms : {};
      const stanzeNomi = Object.keys(rooms);
      const percorsiNomi = (museo.percorsi || []).map((p) => p.nome).filter(Boolean);
      const merged = await aiTranslateLayoutLabels({ stanzeNomi, percorsiNomi });
      const prev = layoutDoc.labelI18n && typeof layoutDoc.labelI18n === "object" ? layoutDoc.labelI18n : {};
      const labelI18n = {
        stanze: { ...(prev.stanze || {}), ...merged.stanze },
        percorsi: { ...(prev.percorsi || {}), ...merged.percorsi },
      };

      const client = new MongoClient(MONGO_URI);
      try {
        await client.connect();
        await client.db(DB_NAME).collection(LAYOUT_COLLECTION).updateOne(
          { _id: nomeM },
          { $set: { labelI18n } },
          { upsert: true }
        );
      } finally {
        await client.close();
      }

      layoutStore[nomeM] = { ...(layoutStore[nomeM] || {}), labelI18n };
      saveLayoutStore(LAYOUT_FILE, layoutStore);
      res.json({ labelI18n });
    } catch (err) {
      console.error("translate-labels:", err.message);
      res.status(500).json({ error: err.message || "errore traduzione etichette" });
    }
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
