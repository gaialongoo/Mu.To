const cors = require("cors");
const https = require("https");
const express = require("express");
const { caricaMuseiDaJSON } = require("./parser_musei.js");
const { upsertMuseo, syncMuseiSuMongo } = require("./mongo_upload.js");const fs = require("fs");
const { syncLayoutSuMongo } = require("./layout_upload.js");
require('dotenv').config({ path: __dirname + '/.env' });
//console.log("Chiave API caricata:", process.env.API_KEY);

// --- 🔧 CONFIGURAZIONE SICUREZZA ---
const SOLO_LOCALHOST = false; // true = solo localhost, false = ascolta su tutte le interfacce
const RICHIESTA_API_KEY = false; // true = obbligo API key, false = accesso libero (solo localhost)
const VALID_API_KEYS = [process.env.API_KEY]; // letta da .env

const PORT = 3000;
const path = require('path');
const FILE_JSON = path.join(__dirname, 'musei.json');
const LAYOUT_FILE = path.join(__dirname, "layout.json");

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-API-Key"]
}));

// --- 🔒 Middleware per sicurezza ---
if (RICHIESTA_API_KEY) {
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") return next(); // 👈 FIX

    const apiKey = req.header("X-API-Key");
    if (!apiKey) return res.status(401).json({ error: "API key mancante" });
    if (!VALID_API_KEYS.includes(apiKey)) return res.status(403).json({ error: "API key non valida" });
    next();
  });
}


// Disabilita header che espongono info
app.disable("x-powered-by");
app.disable("etag");



// --- Middleware log richieste ---
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- Caricamento sistema musei ---
console.log("Caricamento musei da file:", FILE_JSON);
const sistema = caricaMuseiDaJSON(FILE_JSON);

// 🔥 Sync logica musei
syncMuseiSuMongo(sistema);

// 🔥 Sync layout grafici
syncLayoutSuMongo(LAYOUT_FILE);

console.log(`Caricati ${sistema.musei.size} musei`);


// --- 1️⃣ Lista musei ---
app.get("/musei", (req, res) => {
  console.log("Restituisco lista musei");
  const musei = Array.from(sistema.musei.keys());
  res.json({ musei });
});

// --- 2️⃣ JSON completo di un museo ---
app.get("/musei/:nome_museo", (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) {
    console.log(`Museo '${req.params.nome_museo}' non trovato`);
    return res.status(404).json({ error: "Museo non trovato" });
  }

  console.log(`Restituisco dati museo '${museo.nome}'`);
  const jsonMuseo = {
    nome: museo.nome,
    citta: museo.citta,
    oggetti: Array.from(museo.oggetti.values()),
    percorsi: museo.percorsi || []
  };

  res.json(jsonMuseo);
});

// --- 3️⃣ JSON di un singolo oggetto ---
app.get("/musei/:nome_museo/oggetti/:oggetto", (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const oggetto = museo.get_oggetto(req.params.oggetto);
  if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });

  console.log(`Restituisco oggetto '${oggetto.nome}' del museo '${museo.nome}'`);
  res.json(oggetto);
});

// --- 4️⃣ Percorso migliore tra oggetti ---
app.get("/musei/:nome_museo/percorso", (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const oggettiQuery = req.query.oggetti;
  if (!oggettiQuery) return res.status(400).json({ error: "Parametri oggetti mancanti" });

  const oggettiLista = oggettiQuery.split(",");
  console.log(`Calcolo percorso tra oggetti: ${oggettiLista.join(" -> ")}`);

  let percorsoCompleto = [];
  for (let i = 0; i < oggettiLista.length - 1; i++) {
    const start = oggettiLista[i];
    const stop = oggettiLista[i + 1];
    const percorso = museo.BFS_oggetti(start, stop);
    if (!percorso) return res.status(404).json({ error: `Percorso non trovato tra ${start} e ${stop}` });

    if (percorsoCompleto.length === 0) {
      percorsoCompleto = percorso;
    } else {
      percorsoCompleto = percorsoCompleto.concat(percorso.slice(1));
    }
  }

  console.log(`Percorso calcolato: ${percorsoCompleto.join(" -> ")}`);
  const oggettiPercorso = percorsoCompleto.map(nome => museo.get_oggetto(nome));
  res.json({ percorso: oggettiPercorso });
});

// --- 5️⃣ Lista percorsi di un museo ---
app.get("/musei/:nome_museo/percorsi", (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  // Inizializza percorsi se non esistono
  if (!museo.percorsi) museo.percorsi = [];

  console.log(`Restituisco ${museo.percorsi.length} percorsi del museo '${museo.nome}'`);
  res.json({ percorsi: museo.percorsi });
});

// --- 6️⃣ Dettagli di un percorso specifico ---
app.get("/musei/:nome_museo/percorsi/:nome_percorso", (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  if (!museo.percorsi) museo.percorsi = [];

  const percorso = museo.percorsi.find(p => p.nome === req.params.nome_percorso);
  if (!percorso) return res.status(404).json({ error: "Percorso non trovato" });

  console.log(`Restituisco percorso '${percorso.nome}' del museo '${museo.nome}'`);
  res.json(percorso);
});

// --- 7️⃣ Creazione nuovo percorso ---
app.post("/musei/:nome_museo/percorsi", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const { nome, oggetti } = req.body;

  // Validazioni
  if (!nome) return res.status(400).json({ error: "Nome percorso obbligatorio" });
  if (!oggetti || !Array.isArray(oggetti) || oggetti.length === 0) {
    return res.status(400).json({ error: "Array oggetti obbligatorio e non vuoto" });
  }

  // Inizializza percorsi se non esistono
  if (!museo.percorsi) museo.percorsi = [];

  // Verifica unicità nome percorso
  if (museo.percorsi.find(p => p.nome === nome)) {
    return res.status(400).json({ error: "Percorso già esistente" });
  }

  // Verifica che tutti gli oggetti esistano
  for (const nomeOggetto of oggetti) {
    if (!museo.get_oggetto(nomeOggetto)) {
      return res.status(404).json({ 
        error: `Oggetto '${nomeOggetto}' non trovato nel museo` 
      });
    }
  }

  // Aggiungi il percorso
  const nuovoPercorso = { nome, oggetti };
  museo.percorsi.push(nuovoPercorso);

  // Salva su file
  sistema.salvaSuFile(FILE_JSON);
  console.log(`Percorso '${nome}' aggiunto al museo '${museo.nome}' e salvato su file`);

  // Sincronizza su MongoDB
  try {
    await upsertMuseo({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values()),
      percorsi: museo.percorsi
    });
    console.log(`Museo '${museo.nome}' con percorso aggiornato su MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.status(201).json({ 
    message: `Percorso '${nome}' creato con successo`,
    percorso: nuovoPercorso
  });
});

// --- 8️⃣ Cancellazione percorso ---
app.delete("/musei/:nome_museo/percorsi/:nome_percorso", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  if (!museo.percorsi) museo.percorsi = [];

  const indice = museo.percorsi.findIndex(p => p.nome === req.params.nome_percorso);
  if (indice === -1) return res.status(404).json({ error: "Percorso non trovato" });

  // Rimuovi il percorso
  museo.percorsi.splice(indice, 1);

  // Salva su file
  sistema.salvaSuFile(FILE_JSON);
  console.log(`Percorso '${req.params.nome_percorso}' eliminato dal museo '${museo.nome}'`);

  // Sincronizza su MongoDB
  try {
    await upsertMuseo({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values()),
      percorsi: museo.percorsi
    });
    console.log(`Museo '${museo.nome}' aggiornato su MongoDB dopo eliminazione percorso`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.json({ message: `Percorso '${req.params.nome_percorso}' eliminato con successo` });
});
// --- Creazione nuovo museo ---
app.post("/musei", async (req, res) => {
  const { nome, citta, oggetti } = req.body;
  if (!nome || !citta) return res.status(400).json({ error: "Nome e citta obbligatori" });

  if (sistema.get_museo(nome)) return res.status(400).json({ error: "Museo già esistente" });

  const museo = { nome, citta, oggetti: oggetti || [], percorsi: [] };
  sistema.aggiungi_museo(museo);
  sistema.salvaSuFile(FILE_JSON);
  console.log(`Museo '${nome}' aggiunto al file ${FILE_JSON}`);

  try {
    await upsertMuseo(museo);
    console.log(`Museo '${nome}' sincronizzato su MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.status(201).json({ message: `Museo '${nome}' creato con successo` });
});

// --- Aggiunta oggetto a museo esistente ---
app.post("/musei/:nome_museo/oggetti", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const oggetto = req.body;
  if (!oggetto.nome) return res.status(400).json({ error: "Nome oggetto obbligatorio" });
  if (museo.get_oggetto(oggetto.nome)) return res.status(400).json({ error: "Oggetto già esistente" });

  museo.aggiungi_oggetto(oggetto);
  sistema.salvaSuFile(FILE_JSON);
  console.log(`Oggetto '${oggetto.nome}' aggiunto al museo '${museo.nome}' e salvato su file`);

  try {
    await upsertMuseo({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values())
    });
    console.log(`Museo '${museo.nome}' aggiornato su MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.status(201).json({ message: `Oggetto '${oggetto.nome}' aggiunto al museo '${museo.nome}'` });
});

// --- Modifica museo ---
app.put("/musei/:nome_museo", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const { nome, citta } = req.body;
  if (nome) museo.nome = nome;
  if (citta) museo.citta = citta;

  if (nome && nome !== req.params.nome_museo) {
    sistema.musei.delete(req.params.nome_museo);
    sistema.musei.set(nome, museo);
  }

  sistema.salvaSuFile(FILE_JSON);
  console.log(`Museo '${museo.nome}' modificato e salvato su file`);

  try {
    await upsertMuseo({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values())
    });
    console.log(`Museo '${museo.nome}' sincronizzato su MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.json({ message: `Museo '${museo.nome}' aggiornato con successo` });
});

// --- Modifica oggetto ---
app.put("/musei/:nome_museo/oggetti/:oggetto", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  const oggetto = museo.get_oggetto(req.params.oggetto);
  if (!oggetto) return res.status(404).json({ error: "Oggetto non trovato" });

  const { nome, stanza, connessi, descrizioni } = req.body;
  if (nome && nome !== oggetto.nome) {
    museo.oggetti.delete(oggetto.nome);
    oggetto.nome = nome;
    museo.oggetti.set(nome, oggetto);
  }
  if (stanza) oggetto.stanza = stanza;
  if (connessi) {
    oggetto.connessi = connessi;
    oggetto.connessi.forEach(c => museo.collega_oggetti(oggetto.nome, c));
  }
  if (descrizioni) oggetto.descrizioni = descrizioni;

  sistema.salvaSuFile(FILE_JSON);
  console.log(`Oggetto '${oggetto.nome}' aggiornato e salvato su file`);

  try {
    await upsertMuseo({
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values())
    });
    console.log(`Museo '${museo.nome}' aggiornato su MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.json({ message: `Oggetto '${oggetto.nome}' aggiornato con successo` });
});

// --- Cancella museo ---
app.delete("/musei/:nome_museo", async (req, res) => {
  const museo = sistema.get_museo(req.params.nome_museo);
  if (!museo) return res.status(404).json({ error: "Museo non trovato" });

  sistema.musei.delete(req.params.nome_museo);
  sistema.salvaSuFile(FILE_JSON);
  console.log(`Museo '${req.params.nome_museo}' eliminato dal file`);

  // MongoDB
  try {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient("mongodb://localhost:27017");
    await client.connect();
    const db = client.db("musei_db");
    await db.collection("musei").deleteOne({ nome: req.params.nome_museo });
    await client.close();
    console.log(`Museo '${req.params.nome_museo}' eliminato da MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.json({ message: `Museo '${req.params.nome_museo}' eliminato con successo` });
});

// --- Cancella oggetto ---
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
  console.log(`Oggetto '${oggetto.nome}' eliminato dal file`);

  // MongoDB
  try {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient("mongodb://localhost:27017");
    await client.connect();
    const db = client.db("musei_db");
    await db.collection("musei").updateOne(
      { nome: museo.nome },
      { $pull: { oggetti: { nome: oggetto.nome } } }
    );
    await client.close();
    console.log(`Oggetto '${oggetto.nome}' eliminato da MongoDB`);
  } catch (err) {
    console.error("Errore MongoDB:", err);
  }

  res.json({ message: `Oggetto '${oggetto.nome}' eliminato con successo` });
});

const HOST = SOLO_LOCALHOST ? "127.0.0.1" : undefined;
const certPath = path.join(__dirname, "cert", "server.crt");
const keyPath = path.join(__dirname, "cert", "server.key");

// Verifica certificati
let options;
try {
  options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  console.log("Certificati TLS caricati correttamente");
} catch (err) {
  console.error("Errore caricando certificati TLS:", err.message);
  process.exit(1); // esci se non riesce a leggere i certificati
}

// Avvio server HTTPS
https.createServer(options, app).listen(PORT, HOST, () => {
  console.log(`Server Musei in ascolto su https://${HOST || "0.0.0.0"}:${PORT}`);
  if (SOLO_LOCALHOST) console.log("Accesso limitato a localhost");
  if (RICHIESTA_API_KEY) console.log("API key richiesta per tutte le richieste");
});
