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
  }
  return args;
}

function printHelp() {
  console.log(`
Genera codici QR per gli oggetti di un museo e salva su MongoDB
soltanto gli hash. I PNG vengono salvati in una cartella di dump.

Uso:
  node scripts/generate_qr_codes.js --museo <nome> [opzioni]

Opzioni:
  --museo       (obbligatorio) nome del museo
  --oggetti     lista oggetti separati da virgola; default: tutti gli
                oggetti del museo letti da musei.json
  --out         cartella di output (default: qr_dump/<museo>/)
  --length      lunghezza parte random del secret (default: 24)
  --prefix      prefisso del secret (default: MUTO)
  --regenerate  rimuove i QR precedenti per gli oggetti specificati
                prima di reinserire i nuovi
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.museo) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isFinite(args.length) || args.length < 8 || args.length > 64) {
    console.error("❌ --length non valido (8..64)");
    process.exit(1);
  }

  const requested = Array.isArray(args.oggetti) && args.oggetti.length > 0
    ? args.oggetti
    : listObjectsForMuseum(args.museo);

  // Filtra item di solo testo anche se passati esplicitamente con --oggetti.
  // Per quelli il viewer non chiede mai il QR, quindi sarebbe spreco.
  const typeMap = getObjectTypesForMuseum(args.museo);
  const skipped = [];
  const oggettiDaGenerare = requested.filter(nome => {
    const t = typeMap.get(nome);
    if (t === "text") {
      skipped.push(nome);
      return false;
    }
    return true;
  });
  if (skipped.length > 0) {
    console.log(`ℹ️  Saltati ${skipped.length} item di solo testo (objectType="text"):`);
    skipped.forEach(n => console.log(`   • ${n}`));
  }

  if (oggettiDaGenerare.length === 0) {
    console.error(`❌ nessun oggetto da processare per museo '${args.museo}'`);
    process.exit(1);
  }

  const outDir = args.out
    ? path.resolve(args.out)
    : path.resolve(__dirname, "..", "qr_dump", safeFileSlug(args.museo));
  fs.mkdirSync(outDir, { recursive: true });

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const col = client.db(DB_NAME).collection(COLLECTION);
    await col.createIndex({ hash: 1 }, { unique: true });
    await col.createIndex({ museo: 1, oggetto: 1 });
    await col.createIndex({ enabled: 1 });

    if (args.regenerate) {
      const r = await col.deleteMany({
        museo: args.museo,
        oggetto: { $in: oggettiDaGenerare },
      });
      console.log(`🧹 Rimossi ${r.deletedCount} QR precedenti per ${oggettiDaGenerare.length} oggetto/i`);
    }

    const generated = [];
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
          console.warn(`⚠️  collisione hash per '${oggetto}': salto (riprova senza --length troppo bassa o usa --regenerate)`);
          continue;
        }
        throw err;
      }

      const fileName = `${safeFileSlug(oggetto)}.png`;
      const filePath = path.join(outDir, fileName);
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

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    console.log("\n✅ QR generati. Salvali ora se ti servono i secret in chiaro:");
    console.log("   (su MongoDB e' memorizzato solo l'hash)\n");
    for (const g of generated) {
      console.log(`  • ${g.oggetto}`);
      console.log(`      secret: ${g.secret}`);
      console.log(`      file:   ${path.relative(process.cwd(), g.file)}`);
    }
    console.log(`\nTotale generati: ${generated.length}`);
    console.log(`Cartella output: ${outDir}`);
    console.log(`Manifest:        ${manifestPath}\n`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("💥 Errore generazione QR:", err?.message || err);
  process.exit(1);
});
