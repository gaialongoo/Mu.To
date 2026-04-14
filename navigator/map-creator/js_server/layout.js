// layout.js

const { Corridoio } = require("./model");

const START_X = 100;
const START_Y = 120;
const GAP_X = 120;
const GAP_Y = 140;

function autoCorridorLinks(stanze) {
  const grid = {};
  for (const s of stanze) grid[`${s.row},${s.col}`] = s;
  const links = [];
  for (const s of stanze) {
    const east = grid[`${s.row},${s.col + 1}`];
    const south = grid[`${s.row + 1},${s.col}`];
    if (east) links.push({ a: s.nome, b: east.nome });
    if (south) links.push({ a: s.nome, b: south.nome });
  }
  return links;
}

function normalizeCorridorLinks(stanze, links) {
  const byName = Object.fromEntries(stanze.map((s) => [s.nome, s]));
  const out = [];
  const seen = new Set();
  const source = Array.isArray(links) && links.length > 0 ? links : autoCorridorLinks(stanze);

  for (const l of source) {
    const aName = l?.a || l?.from || l?.src || l?.sorgente;
    const bName = l?.b || l?.to || l?.dst || l?.destinazione;
    if (!aName || !bName || aName === bName) continue;
    const a = byName[aName];
    const b = byName[bName];
    if (!a || !b) continue;
    const adjacent = (a.row === b.row && Math.abs(a.col - b.col) === 1)
      || (a.col === b.col && Math.abs(a.row - b.row) === 1);
    if (!adjacent) continue;
    const key = [a.nome, b.nome].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: a.nome, b: b.nome });
  }
  return out;
}

function buildLayout(stanze, manualLinks = []) {
  const grid = {};
  for (const s of stanze) {
    grid[`${s.row},${s.col}`] = s;
  }

  const corridoi = [];

  for (const s of stanze) {
    s.computeSize();
    s.x = START_X + s.col * (s.w + GAP_X);
    s.y = START_Y + s.row * (s.h + GAP_Y);
    s.porta = {
      N: [s.x + s.w / 2, s.y],
      S: [s.x + s.w / 2, s.y + s.h],
      W: [s.x, s.y + s.h / 2],
      E: [s.x + s.w, s.y + s.h / 2],
    };
    s.layoutObjects();
  }

  for (const link of normalizeCorridorLinks(stanze, manualLinks)) {
    const a = gridByName(stanze, link.a);
    const b = gridByName(stanze, link.b);
    if (!a || !b) continue;
    const c = new Corridoio(a, b);
    if (a.row === b.row) {
      const west = a.col < b.col ? a : b;
      const east = a.col < b.col ? b : a;
      c.x = west.porta["E"][0];
      c.y = west.porta["E"][1] - 20;
      c.w = east.porta["W"][0] - c.x;
      c.h = 40;
    } else {
      const north = a.row < b.row ? a : b;
      const south = a.row < b.row ? b : a;
      c.x = north.porta["S"][0] - 20;
      c.y = north.porta["S"][1];
      c.w = 40;
      c.h = south.porta["N"][1] - c.y;
    }
    corridoi.push(c);
  }

  return corridoi;
}

function gridByName(stanze, nome) {
  return stanze.find((s) => s.nome === nome) || null;
}

module.exports = { buildLayout, normalizeCorridorLinks };
