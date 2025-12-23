//struttura per la gestione di 1 museo
const { Graph } = require("./graph.js");

class Museo {
  constructor(nome, citta) {
    this.nome = nome;
    this.citta = citta;
    this.mappa_oggetti = new Graph();
    this.oggetti = new Map();

    this.percorsi = [];
  }


  aggiungi_oggetto(oggetto) {
    this.oggetti.set(oggetto.nome, oggetto);
    this.mappa_oggetti.addNode(oggetto.nome);
    for (const connesso of oggetto.connessi || []) {
      this.mappa_oggetti.addEdge(oggetto.nome, connesso);
    }
  }

  collega_oggetti(o1, o2) {
    this.mappa_oggetti.addEdge(o1, o2);
  }

  BFS_oggetti(start, stop) {
    if (!this.mappa_oggetti.adj.has(start) || !this.mappa_oggetti.adj.has(stop)) {
      return null;
    }

    const queue = [[start]];
    const visited = new Set();
    visited.add(start);

    while (queue.length > 0) {
      const path = queue.shift();
      const node = path[path.length - 1];

      if (node === stop) return path;

      const neighbors = this.mappa_oggetti.adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }

    return null;
  }

  get_oggetto(nome) {
    return this.oggetti.get(nome) || null;
  }
}

module.exports = { Museo };

