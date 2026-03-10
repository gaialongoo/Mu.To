const cors = require("cors");
const https = require("https");
const express = require("express");
const { MongoClient } = require("mongodb");
const { caricaMuseiDaJSON } = require("./parser_musei.js");
const { upsertMuseo, syncMuseiSuMongo } = require("./mongo_upload.js");
const { syncLayoutSuMongo } = require("./layout_upload.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: __dirname + "/.env" });

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
  const apiKey = req.header("X-API-Key");
  if (!apiKey) return res.status(401).json({ error: "API key mancante" });
  if (!VALID_API_KEYS.includes(apiKey)) return res.status(403).json({ error: "API key non valida" });
  next();
});

// ============================================================
// AVVIO ASINCRONO
// ============================================================
async function startServer() {

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

  // --- Caricamento dati ---
  console.log("📂 Caricamento musei da:", FILE_JSON);
  const sistema = caricaMuseiDaJSON(FILE_JSON);
  console.log(`✅ Caricati ${sistema.musei.size} musei`);

  syncMuseiSuMongo(sistema);
  syncLayoutSuMongo(LAYOUT_FILE);

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
    res.json({ percorsi: museo.percorsi });
  });

  // 6️⃣ Dettagli percorso specifico
  app.get("/musei/:nome_museo/percorsi/:nome_percorso", (req, res) => {
    const museo = sistema.get_museo(req.params.nome_museo);
    if (!museo) return res.status(404).json({ error: "Museo non trovato" });

    if (!museo.percorsi) museo.percorsi = [];
    const percorso = museo.percorsi.find(p => p.nome === req.params.nome_percorso);
    if (!percorso) return res.status(404).json({ error: "Percorso non trovato" });

    console.log(`Restituisco percorso '${percorso.nome}' di '${museo.nome}'`);
    res.json(percorso);
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

    museo.aggiungi_oggetto(oggetto);
    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()) });
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

    const nuovoPercorso = { nome, oggetti };
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
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()) });
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

    const { nome, stanza, connessi, descrizioni } = req.body;
    if (nome && nome !== oggetto.nome) {
      museo.oggetti.delete(oggetto.nome);
      oggetto.nome = nome;
      museo.oggetti.set(nome, oggetto);
    }
    if (stanza)      oggetto.stanza = stanza;
    if (connessi) {
      oggetto.connessi = connessi;
      oggetto.connessi.forEach(c => museo.collega_oggetti(oggetto.nome, c));
    }
    if (descrizioni) oggetto.descrizioni = descrizioni;

    sistema.salvaSuFile(FILE_JSON);

    try {
      await upsertMuseo({ nome: museo.nome, citta: museo.citta, oggetti: Array.from(museo.oggetti.values()) });
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
      await client.db("musei_db").collection("musei").deleteOne({ nome: req.params.nome_museo });
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
      await client.db("musei_db").collection("musei")
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
}

// ============================================================
// ENTRY POINT
// ============================================================
startServer().catch(err => {
  console.error("💥 Errore fatale avvio server:", err);
  process.exit(1);
});
