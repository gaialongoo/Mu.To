//struttura che gestisce piu musei
const { Museo } = require("./museo.js");

class SistemaMusei {
  constructor() {
    this.musei = new Map(); // chiave: nome del museo
  }

  aggiungi_museo(museoData) {
  const museo = new Museo(museoData.nome, museoData.citta);

  // ✅ FIX: carica i percorsi dal JSON
  museo.percorsi = museoData.percorsi || [];

  for (const oggetto of museoData.oggetti || []) {
    museo.aggiungi_oggetto(oggetto);
  }

  this.musei.set(museo.nome, museo);
}


  get_museo(nome) {
    return this.musei.get(nome) || null;
  }

  BFS_museo(museoNome, start, stop) {
    const museo = this.get_museo(museoNome);
    if (!museo) return null;
    return museo.BFS_oggetti(start, stop);
  }

  // 📌 Funzione che genera il JSON completo di tutto il sistema
  toJSON() {
    const jsonMusei = [];
    for (const museo of this.musei.values()) {
      const museoJson = {
        nome: museo.nome,
        citta: museo.citta,
        oggetti: Array.from(museo.oggetti.values()).map(ogg => ({
          nome: ogg.nome,
          stanza: ogg.stanza,
          connessi: ogg.connessi || [],
          descrizioni: ogg.descrizioni || []
        })),
        percorsi: museo.percorsi || []
      };

      jsonMusei.push(museoJson);
    }
    return { musei: jsonMusei };
  }

  // Se vuoi scrivere direttamente su file JSON
  salvaSuFile(filePath) {
    const fs = require("fs");
    const jsonData = JSON.stringify(this.toJSON(), null, 2); // indentazione 2 spazi
    fs.writeFileSync(filePath, jsonData, "utf-8");
  }
}

module.exports = { SistemaMusei };


