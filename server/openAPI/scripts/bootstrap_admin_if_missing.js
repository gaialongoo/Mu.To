/**
 * Creazione automatica dell'admin all'avvio se configurato via env:
 *   ADMIN_BOOTSTRAP_EMAIL
 *   ADMIN_BOOTSTRAP_PASSWORD (min 6 caratteri)
 *
 * Opzionali: ADMIN_BOOTSTRAP_NOME, ADMIN_BOOTSTRAP_COGNOME
 *
 * Se l'email esiste gia' nel DB, esce senza modifiche (exit 0).
 * Legge MONGO_URI da server/openAPI/.env (come create_admin.js).
 */

const crypto = require("crypto");
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: __dirname + "/../.env" });

const MONGO_URI = process.env.MONGO_URI;
const EMAIL = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim();
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    process.exit(0);
  }

  if (!MONGO_URI) {
    console.error("❌ Bootstrap admin: MONGO_URI mancante nel .env");
    process.exit(1);
  }
  if (PASSWORD.length < 6) {
    console.error("❌ Bootstrap admin: ADMIN_BOOTSTRAP_PASSWORD deve essere di almeno 6 caratteri");
    process.exit(1);
  }

  const nome = String(process.env.ADMIN_BOOTSTRAP_NOME || "Admin").trim() || "Admin";
  const cognome = String(process.env.ADMIN_BOOTSTRAP_COGNOME || "Mu.To").trim() || "Mu.To";

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    const col = client.db("utenti").collection("users");
    const existing = await col.findOne({ email: EMAIL });
    if (existing) {
      console.log(`ℹ️  Bootstrap admin: "${EMAIL}" gia' registrato — salto creazione.`);
      return;
    }

    const now = new Date();
    await col.insertOne({
      nome,
      cognome,
      email: EMAIL,
      passwordHash: hashPassword(PASSWORD),
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
    console.log(`✅ Bootstrap admin: creato account "${EMAIL}" (ruolo admin).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("💥 Bootstrap admin:", err?.message || err);
  process.exit(1);
});
