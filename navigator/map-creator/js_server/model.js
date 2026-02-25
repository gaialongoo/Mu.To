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
    this.porta = {};
  }

  computeSize() {
    this.w = 220;
    this.h = 180;
  }

  layoutObjects() {
    if (!this.oggetti.length) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const r = Math.min(this.w, this.h) * 0.3;
    this.oggetti.forEach((o, i) => {
      const a = (2 * Math.PI * i) / this.oggetti.length;
      o.pos = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  }
}

class Oggetto {
  constructor(nome, stanza, connessi) {
    this.nome = nome;
    this.stanza = stanza;
    this.connessi = connessi;
    this.pos = [0, 0];
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
