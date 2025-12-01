//struttura che gestisce piu musei
const { Museo } = require("./museo.js");

class SistemaMusei {
  constructor() {
    this.musei = new Map(); // chiave: nome del museo
  }

  aggiungi_museo(museoData) {
    const museo = new Museo(museoData.nome, museoData.citta);
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
}

module.exports = { SistemaMusei };

