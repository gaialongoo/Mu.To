// mongo_upload.js
const { MongoClient } = require("mongodb");

const uri = "mongodb://localhost:27017";
const dbName = "musei";
const collectionName = "musei_db";


async function upsertMuseo(museo) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    await collection.updateOne(
      { nome: museo.nome },
      { $set: museo },
      { upsert: true }
    );
  } finally {
    await client.close();
  }
}

async function upsertOggetto(nomeMuseo, oggetto) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Aggiorna solo l’oggetto all’interno dell’array "oggetti"
    await collection.updateOne(
      { nome: nomeMuseo, "oggetti.nome": oggetto.nome },
      { $set: { "oggetti.$": oggetto } },
      { upsert: true }
    );
  } finally {
    await client.close();
  }
}

function syncMuseiSuMongo(sistema) {
  console.log("Sincronizzazione iniziale musei su MongoDB...");

  for (const museo of sistema.musei.values()) {
    const payload = {
      nome: museo.nome,
      citta: museo.citta,
      oggetti: Array.from(museo.oggetti.values())
    };

    upsertMuseo(payload)
      .then(() => {
        console.log(`✔ Museo '${museo.nome}' sincronizzato su MongoDB`);
      })
      .catch(err => {
        console.error(`❌ Errore sync museo '${museo.nome}':`, err);
      });
  }
}

module.exports = { upsertMuseo, upsertOggetto, syncMuseiSuMongo };

