const crypto = require("crypto");
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: __dirname + "/../.env" });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI mancante nel .env");
  process.exit(1);
}

const DB_NAME = "utenti";
const USERS_COLLECTION = "users";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function parseArgs(argv) {
  const args = { email: "", password: "", nome: "Admin", cognome: "Mu.To", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--email" && argv[i + 1]) args.email = String(argv[++i]).trim();
    else if (a.startsWith("--email=")) args.email = String(a.split("=").slice(1).join("=")).trim();
    else if (a === "--password" && argv[i + 1]) args.password = String(argv[++i]);
    else if (a.startsWith("--password=")) args.password = String(a.split("=").slice(1).join("="));
    else if (a === "--nome" && argv[i + 1]) args.nome = String(argv[++i]).trim();
    else if (a.startsWith("--nome=")) args.nome = String(a.split("=").slice(1).join("=")).trim();
    else if (a === "--cognome" && argv[i + 1]) args.cognome = String(argv[++i]).trim();
    else if (a.startsWith("--cognome=")) args.cognome = String(a.split("=").slice(1).join("=")).trim();
  }
  return args;
}

function printHelp() {
  console.log(`
Crea un utente admin nel database MongoDB.

Uso:
  node scripts/create_admin.js --email admin@muto.it --password Admin123!

Opzioni:
  --email      Email dell'admin (obbligatoria)
  --password   Password dell'admin (obbligatoria, min 6 caratteri)
  --nome       Nome (default: Admin)
  --cognome    Cognome (default: Mu.To)

Se l'email esiste gia', il ruolo viene aggiornato a "admin".
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (!args.email) { console.error("--email obbligatoria"); printHelp(); process.exit(1); }
  if (!args.password || args.password.length < 6) {
    console.error("--password obbligatoria (minimo 6 caratteri)");
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const col = client.db(DB_NAME).collection(USERS_COLLECTION);
    const existing = await col.findOne({ email: args.email });

    if (existing) {
      await col.updateOne(
        { _id: existing._id },
        { $set: { ruolo: "admin", updatedAt: new Date() } }
      );
      console.log(`\nUtente "${args.email}" esistente — ruolo aggiornato a admin.\n`);
    } else {
      const now = new Date();
      await col.insertOne({
        nome: args.nome,
        cognome: args.cognome,
        email: args.email,
        passwordHash: hashPassword(args.password),
        interessi: [],
        livello: "",
        durata: "",
        navLang: "it",
        eta: "",
        ruolo: "admin",
        percorsiAcquistati: [],
        percorsiPersonalizzati: [],
        createdAt: now,
        updatedAt: now,
      });
      console.log(`\nAdmin creato con successo!`);
      console.log(`  Email:    ${args.email}`);
      console.log(`  Password: ${args.password}`);
      console.log(`  Nome:     ${args.nome} ${args.cognome}\n`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Errore:", err?.message || err);
  process.exit(1);
});
