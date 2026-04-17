// model.js

class Stanza {
  constructor(nome) {
    this.nome = nome;
    this.tipo = "normale";
    this.oggetti = [];

    this.row = 0;
    this.col = 0;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.porta = {}; // punti assoluti {N,S,E,W} usati dal routing legacy
  }

  computeSize() {
    this.w = 220;
    this.h = 180;
  }

  layoutObjects() {}
}

class Oggetto {
  constructor(nome, stanza, connessi) {
    this.nome = nome;
    this.stanza = stanza;
    this.connessi = connessi;
    // pos è assoluta (px) nello spazio SVG
    this.pos = [0, 0];
    // posRel è relativa alla stanza (0..1). Se presente ha priorità.
    this.posRel = null;
    this.visibile = true;
  }
}

class Corridoio {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
  }
}

module.exports = { Stanza, Oggetto, Corridoio };
