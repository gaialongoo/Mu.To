//struttura a grafo per gli oggetti
class Graph {
  constructor() {
    this.adj = new Map();
  }

  addNode(node) {
    if (!this.adj.has(node)) this.adj.set(node, []);
  }

  addEdge(a, b) {
    this.addNode(a);
    this.addNode(b);
    this.adj.get(a).push(b);
  }
}

// Esportazione in CommonJS
module.exports = { Graph };

