/**
 * Genera QR codes per gli oggetti di un museo.
 *
 * - Per ogni oggetto crea un secret random `<prefix>-<random>`
 * - Calcola `sha256(secret)` e fa upsert su `musei.qr_codes`
 *   con `{ hash, museo, oggetto, enabled, createdAt }`
 * - Genera il PNG del QR (contenuto = secret in chiaro) in
 *   `<out>/<oggetto-slug>.png`
 * - Aggiorna `<out>/manifest.json` con `{ museo, oggetto, file, hash, generatedAt }`
 *
 * I secret in chiaro vengono stampati a schermo UNA volta sola
 * (esattamente come `generate_professor_codes.js`): salvali ora se
 * ti servono, perche su Mongo viene memorizzato solo l'hash.
 *
 * Uso tipico:
 *   npm run gen:qr -- --museo Uffizi
 *   npm run gen:qr -- --museo Uffizi --oggetti statua,dipinto
 *   npm run gen:qr -- --museo Uffizi --regenerate
 *   npm run gen:qr -- --all-museums --skip-existing
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const QRCode = require("qrcode");
require("dotenv").config({ path: __dirname + "/../.env" });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI mancante nel .env");
  process.exit(1);
}

const DB_NAME = "musei";
const COLLECTION = "qr_codes";
const MUSEI_FILE = path.resolve(__dirname, "..", "musei.json");

function parseArgs(argv) {
  const args = {
    museo: "",
    oggetti: null,
    out: "",
    length: 24,
    prefix: "MUTO",
    regenerate: false,
    skipExisting: false,
    allMuseums: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--museo" && argv[i + 1]) args.museo = String(argv[++i]);
    else if (a.startsWith("--museo=")) args.museo = a.split("=").slice(1).join("=");
    else if (a === "--oggetti" && argv[i + 1]) args.oggetti = String(argv[++i]).split(",").map(s => s.trim()).filter(Boolean);
    else if (a.startsWith("--oggetti=")) args.oggetti = a.split("=").slice(1).join("=").split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--out" && argv[i + 1]) args.out = String(argv[++i]);
    else if (a.startsWith("--out=")) args.out = a.split("=").slice(1).join("=");
    else if (a === "--length" && argv[i + 1]) args.length = Number(argv[++i]);
    else if (a.startsWith("--length=")) args.length = Number(a.split("=")[1]);
    else if (a === "--prefix" && argv[i + 1]) args.prefix = String(argv[++i]);
    else if (a.startsWith("--prefix=")) args.prefix = String(a.split("=")[1]);
    else if (a === "--regenerate") args.regenerate = true;
    else if (a === "--skip-existing") args.skipExisting = true;
    else if (a === "--all-museums") args.allMuseums = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Genera codici QR per gli oggetti di un museo e salva su MongoDB
soltanto gli hash. I PNG vengono salvati in una cartella di dump.

Uso:
  node scripts/generate_qr_codes.js --museo <nome> [opzioni]
  node scripts/generate_qr_codes.js --all-museums [opzioni]

Opzioni:
  --museo       nome del museo (obbligatorio salvo con --all-museums)
  --all-museums elabora tutti i musei in musei.json
  --oggetti     lista oggetti separati da virgola; default: tutti gli
                oggetti del museo letti da musei.json
  --out         cartella di output (default: qr_dump/<museo>/)
  --length      lunghezza parte random del secret (default: 24)
  --prefix      prefisso del secret (default: MUTO)
  --regenerate  rimuove i QR precedenti per gli oggetti specificati
                prima di reinserire i nuovi
  --skip-existing  salta solo se esiste un QR enabled su MongoDB **e**
                   il file PNG corrispondente e' gia' nella cartella output;
                   se Mongo ha hash ma il PNG manca, rigenera (DB aggiornato)
`);
}

function randomCodePart(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // niente caratteri ambigui
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function formatSecret(prefix, museo, oggetto, part) {
  const slug = (s) => String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${prefix}-${slug(museo)}-${slug(oggetto)}-${part}`;
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim()).digest("hex");
}

function safeFileSlug(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Scrive solo se il contenuto cambia (evita restart nodemon per mtime su file invariato). */
function writeManifestIfChanged(manifestPath, manifest) {
  const next = JSON.stringify(manifest, null, 2) + "\n";
  try {
    if (fs.existsSync(manifestPath)) {
      const prev = fs.readFileSync(manifestPath, "utf8");
      if (prev === next) return false;
    }
  } catch {
    /* write below */
  }
  fs.writeFileSync(manifestPath, next);
  return true;
}

function readMuseiJson() {
  if (!fs.existsSync(MUSEI_FILE)) {
    throw new Error(`musei.json non trovato in ${MUSEI_FILE}`);
  }
  const raw = fs.readFileSync(MUSEI_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.musei)) {
    throw new Error("musei.json malformato: chiave 'musei' mancante");
  }
  return parsed.musei;
}

function listObjectsForMuseum(museoName) {
  const musei = readMuseiJson();
  const museo = musei.find(m => String(m.nome).trim() === String(museoName).trim());
  if (!museo) {
    throw new Error(`museo '${museoName}' non trovato in musei.json`);
  }
  if (!Array.isArray(museo.oggetti)) return [];
  // Salta gli item di solo testo (objectType === "text", il classico "?"):
  // il viewer non chiede QR per quelli, quindi non ha senso generare il PNG.
  return museo.oggetti
    .filter(o => String(o?.objectType || "normal").toLowerCase() !== "text")
    .map(o => String(o.nome || "").trim())
    .filter(Boolean);
}

function getObjectTypesForMuseum(museoName) {
  const musei = readMuseiJson();
  const museo = musei.find(m => String(m.nome).trim() === String(museoName).trim());
  if (!museo || !Array.isArray(museo.oggetti)) return new Map();
  const map = new Map();
  for (const o of museo.oggetti) {
    const nome = String(o?.nome || "").trim();
    if (!nome) continue;
    map.set(nome, String(o?.objectType || "normal").toLowerCase());
  }
  return map;
}

async function ensureQrIndexes(col) {
  await col.createIndex({ hash: 1 }, { unique: true });
  await col.createIndex({ museo: 1, oggetto: 1 });
  await col.createIndex({ enabled: 1 });
}

/**
 * Genera QR per un museo. Se allowEmpty, musei senza oggetti QR-abilitati vengono solo avvisati.
 * @param {import("mongodb").Collection} col
 * @param {object} baseArgs flags da parseArgs + museo impostato nel loop
 * @param {string} museoNome
 * @param {{ allowEmpty?: boolean }} opts
 */
async function generateQrForOneMuseum(col, baseArgs, museoNome, opts = {}) {
  const allowEmpty = opts.allowEmpty === true;
  const args = { ...baseArgs, museo: museoNome };

  const requested = Array.isArray(args.oggetti) && args.oggetti.length > 0
    ? args.oggetti
    : listObjectsForMuseum(args.museo);

  const typeMap = getObjectTypesForMuseum(args.museo);
  const skippedText = [];
  const oggettiDaGenerare = requested.filter(nome => {
    const t = typeMap.get(nome);
    if (t === "text") {
      skippedText.push(nome);
      return false;
    }
    return true;
  });

  if (skippedText.length > 0) {
    console.log(`ℹ️  [${args.museo}] Saltati ${skippedText.length} item di solo testo (objectType="text"):`);
    skippedText.forEach(n => console.log(`   • ${n}`));
  }

  if (oggettiDaGenerare.length === 0) {
    const msg = `nessun oggetto da processare per museo '${args.museo}'`;
    if (allowEmpty) {
      console.warn(`⚠️  ${msg} (saltato)`);
      return { generated: [], skippedExisting: 0, outDir: "" };
    }
    console.error(`❌ ${msg}`);
    process.exit(1);
  }

  const outDir =
    args.out && !args.allMuseums
      ? path.resolve(args.out)
      : path.resolve(__dirname, "..", "qr_dump", safeFileSlug(args.museo));
  fs.mkdirSync(outDir, { recursive: true });

  if (args.regenerate) {
    const r = await col.deleteMany({
      museo: args.museo,
      oggetto: { $in: oggettiDaGenerare },
    });
    console.log(`🧹 [${args.museo}] Rimossi ${r.deletedCount} QR precedenti per ${oggettiDaGenerare.length} oggetto/i`);
  }

  const generated = [];
  let skippedExisting = 0;
  const manifestPath = path.join(outDir, "manifest.json");
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) manifest = parsed;
    } catch {
      manifest = [];
    }
  }

  for (const oggetto of oggettiDaGenerare) {
    const fileName = `${safeFileSlug(oggetto)}.png`;
    const filePath = path.join(outDir, fileName);
    const pngExists = fs.existsSync(filePath);

    if (args.skipExisting) {
      const existing = await col.findOne({
        museo: args.museo,
        oggetto,
        enabled: true,
      });
      if (existing && pngExists) {
        skippedExisting += 1;
        console.log(`⏭️  [${args.museo}] QR + PNG gia' presenti → ${oggetto}`);
        continue;
      }
      if (existing && !pngExists) {
        const del = await col.deleteMany({ museo: args.museo, oggetto });
        console.log(
          `🔄 [${args.museo}] PNG assente (${fileName}), rigenero (${del.deletedCount} record QR rimossi da MongoDB per questo oggetto)`
        );
      }
    }

    const part = randomCodePart(args.length);
    const secret = formatSecret(args.prefix, args.museo, oggetto, part);
    const hash = hashCode(secret);

    try {
      await col.insertOne({
        hash,
        museo: args.museo,
        oggetto,
        enabled: true,
        createdAt: new Date(),
      });
    } catch (err) {
      if (err && err.code === 11000) {
        console.warn(`⚠️  [${args.museo}] collisione hash per '${oggetto}': salto (riprova senza --length troppo bassa o usa --regenerate)`);
        continue;
      }
      throw err;
    }

    await QRCode.toFile(filePath, secret, {
      errorCorrectionLevel: "M",
      scale: 8,
      margin: 2,
    });

    manifest = manifest.filter(m => m.oggetto !== oggetto);
    manifest.push({
      museo: args.museo,
      oggetto,
      file: fileName,
      hash,
      generatedAt: new Date().toISOString(),
    });

    generated.push({ oggetto, secret, file: filePath });
  }

  writeManifestIfChanged(manifestPath, manifest);

  if (generated.length > 0) {
    console.log(`\n✅ [${args.museo}] QR generati (nuovi). Salva i secret se ti servono in chiaro:`);
    console.log("   (su MongoDB e' memorizzato solo l'hash)\n");
    for (const g of generated) {
      console.log(`  • ${g.oggetto}`);
      console.log(`      secret: ${g.secret}`);
      console.log(`      file:   ${path.relative(process.cwd(), g.file)}`);
    }
    console.log(`\nTotale nuovi per questo museo: ${generated.length}`);
    console.log(`Cartella output: ${outDir}`);
    console.log(`Manifest:        ${manifestPath}\n`);
  } else if (skippedExisting > 0) {
    console.log(`ℹ️  [${args.museo}] Nessun QR nuovo (${skippedExisting} gia' presenti: MongoDB + PNG).`);
  }

  return { generated, skippedExisting, outDir };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.allMuseums && !args.museo) {
    printHelp();
    process.exit(1);
  }
  if (!Number.isFinite(args.length) || args.length < 8 || args.length > 64) {
    console.error("❌ --length non valido (8..64)");
    process.exit(1);
  }

  const museums = args.allMuseums
    ? readMuseiJson().map(m => String(m.nome || "").trim()).filter(Boolean)
    : [String(args.museo).trim()];

  if (museums.length === 0) {
    console.error("❌ Nessun museo in musei.json");
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const col = client.db(DB_NAME).collection(COLLECTION);
    await ensureQrIndexes(col);

    let totalNew = 0;
    let totalSkip = 0;

    for (const museoNome of museums) {
      const r = await generateQrForOneMuseum(col, args, museoNome, {
        allowEmpty: args.allMuseums,
      });
      totalNew += r.generated.length;
      totalSkip += r.skippedExisting;
    }

    if (args.allMuseums) {
      console.log(`\n📋 Riepilogo tutti i musei: ${totalNew} QR nuovi, ${totalSkip} saltati (gia' MongoDB + PNG).`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("💥 Errore generazione QR:", err?.message || err);
  process.exit(1);
});
