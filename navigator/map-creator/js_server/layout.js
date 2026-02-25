// layout.js

const { Corridoio } = require("./model");

const START_X = 100;
const START_Y = 120;
const GAP_X = 120;
const GAP_Y = 140;

function buildLayout(stanze) {
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

  for (const s of stanze) {
    // Corridoio verso EST (col + 1)
    const east = grid[`${s.row},${s.col + 1}`];
    if (east) {
      const t = east;
      const c = new Corridoio(s, t);
      c.x = s.porta["E"][0];
      c.y = s.porta["E"][1] - 20;
      c.w = t.porta["W"][0] - c.x;
      c.h = 40;
      corridoi.push(c);
    }

    // Corridoio verso SUD (row + 1)
    const south = grid[`${s.row + 1},${s.col}`];
    if (south) {
      const t = south;
      const c = new Corridoio(s, t);
      c.x = s.porta["S"][0] - 20;
      c.y = s.porta["S"][1];
      c.w = 40;
      c.h = t.porta["N"][1] - c.y;
      corridoi.push(c);
    }
  }

  return corridoi;
}

module.exports = { buildLayout };
