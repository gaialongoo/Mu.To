const { MongoClient } = require("mongodb");
const fs = require("fs");

const uri = "mongodb://localhost:27017";
const DB_NAME = "musei";
const COLLECTION = "musei_layout";

async function syncLayoutSuMongo(layoutFilePath) {
  console.log("Sincronizzazione layout su MongoDB...");

  const raw = fs.readFileSync(layoutFilePath, "utf-8");
  const layouts = JSON.parse(raw);

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    for (const [nomeMuseo, layout] of Object.entries(layouts)) {
      await col.updateOne(
        { _id: nomeMuseo },
        { $set: layout },
        { upsert: true }
      );
      console.log(`✔ Layout '${nomeMuseo}' sincronizzato`);
    }
  } catch (err) {
    console.error("❌ Errore sync layout:", err);
  } finally {
    await client.close();
  }
}

module.exports = { syncLayoutSuMongo };
