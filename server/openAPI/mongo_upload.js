// mongo_upload.js
const { MongoClient } = require("mongodb");

const uri = "mongodb://localhost:27017";
const dbName = "musei_db";
const collectionName = "musei";

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

module.exports = { upsertMuseo, upsertOggetto };

