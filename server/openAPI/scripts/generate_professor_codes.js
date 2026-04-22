const crypto = require("crypto");
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: __dirname + "/../.env" });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI mancante nel .env");
  process.exit(1);
}

const DB_NAME = "utenti";
const COLLECTION = "professor_codes";

function parseArgs(argv) {
  const args = { count: 5, length: 12, prefix: "PROF", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--count" && argv[i + 1]) args.count = Number(argv[++i]);
    else if (a.startsWith("--count=")) args.count = Number(a.split("=")[1]);
    else if (a === "--length" && argv[i + 1]) args.length = Number(argv[++i]);
    else if (a.startsWith("--length=")) args.length = Number(a.split("=")[1]);
    else if (a === "--prefix" && argv[i + 1]) args.prefix = String(argv[++i]);
    else if (a.startsWith("--prefix=")) args.prefix = String(a.split("=")[1]);
  }
  return args;
}

function printHelp() {
  console.log(`
Genera codici di accesso professore e li salva su MongoDB come hash.

Uso:
  node scripts/generate_professor_codes.js --count 10 --length 12 --prefix PROF

Opzioni:
  --count   Numero di codici da generare (default: 5)
  --length  Lunghezza parte random (default: 12)
  --prefix  Prefisso codice (default: PROF)
`);
}

function randomCodePart(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // evita caratteri ambigui
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function formatCode(prefix, part) {
  const chunks = part.match(/.{1,4}/g) || [part];
  return `${prefix}-${chunks.join("-")}`;
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!Number.isFinite(args.count) || args.count < 1 || args.count > 1000) {
    console.error("❌ --count non valido (1..1000)");
    process.exit(1);
  }
  if (!Number.isFinite(args.length) || args.length < 8 || args.length > 64) {
    console.error("❌ --length non valido (8..64)");
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const col = client.db(DB_NAME).collection(COLLECTION);
    await col.createIndex({ hash: 1 }, { unique: true });
    await col.createIndex({ enabled: 1 });

    const codes = [];
    const docs = [];
    for (let i = 0; i < args.count; i++) {
      const code = formatCode(args.prefix, randomCodePart(args.length));
      codes.push(code);
      docs.push({
        hash: hashCode(code),
        enabled: true,
        createdAt: new Date(),
      });
    }

    // insertMany può fallire per collisioni hash (molto improbabile). in quel caso rigenera.
    await col.insertMany(docs, { ordered: true });

    console.log("\n✅ Codici professore generati (salvali ora: non verranno più mostrati):\n");
    codes.forEach((c) => console.log(c));
    console.log(`\nTotale: ${codes.length}\n`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("💥 Errore generazione codici:", err?.message || err);
  process.exit(1);
});

