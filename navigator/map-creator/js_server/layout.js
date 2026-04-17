// layout.js

const { Corridoio } = require("./model");

const START_X = 100;
const START_Y = 120;
const GAP_X = 120;
const GAP_Y = 140;

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function hasNumericOffset(door) {
  return typeof door?.offset === "number" && !Number.isNaN(door.offset);
}

function doorPoint(room, doorSpec, fallbackSide) {
  const side = doorSpec?.side || fallbackSide;
  const offset = clamp01(doorSpec?.offset);
  const x0 = room.x, y0 = room.y, w = room.w, h = room.h;
  if (side === "N") return [x0 + w * offset, y0];
  if (side === "S") return [x0 + w * offset, y0 + h];
  if (side === "W") return [x0, y0 + h * offset];
  return [x0 + w, y0 + h * offset]; // E
}

function inferSide(fromRoom, toRoom) {
  const dx = (toRoom.x + toRoom.w / 2) - (fromRoom.x + fromRoom.w / 2);
  const dy = (toRoom.y + toRoom.h / 2) - (fromRoom.y + fromRoom.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "S" : "N";
}

function inferSideFromPoint(room, px, py) {
  const dN = Math.abs(py - room.y);
  const dS = Math.abs(py - (room.y + room.h));
  const dW = Math.abs(px - room.x);
  const dE = Math.abs(px - (room.x + room.w));
  const m = Math.min(dN, dS, dW, dE);
  if (m === dN) return "N";
  if (m === dS) return "S";
  if (m === dW) return "W";
  return "E";
}

function inferOffsetFromPoint(room, side, px, py) {
  if (side === "N" || side === "S") return clamp01((px - room.x) / room.w);
  return clamp01((py - room.y) / room.h);
}

function overlapLen(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function inferDoorFromCorridorRect(room, corr) {
  const rx0 = room.x, rx1 = room.x + room.w;
  const ry0 = room.y, ry1 = room.y + room.h;
  const cx0 = corr.x, cx1 = corr.x + corr.w;
  const cy0 = corr.y, cy1 = corr.y + corr.h;

  const ox = overlapLen(rx0, rx1, cx0, cx1);
  const oy = overlapLen(ry0, ry1, cy0, cy1);

  const PENALTY = 1e6;
  const dN = Math.abs(cy1 - ry0) + (ox > 0 ? 0 : PENALTY);
  const dS = Math.abs(cy0 - ry1) + (ox > 0 ? 0 : PENALTY);
  const dW = Math.abs(cx1 - rx0) + (oy > 0 ? 0 : PENALTY);
  const dE = Math.abs(cx0 - rx1) + (oy > 0 ? 0 : PENALTY);

  const minD = Math.min(dN, dS, dW, dE);
  const side = minD === dN ? "N" : minD === dS ? "S" : minD === dW ? "W" : "E";

  let offset = 0.5;
  if (side === "N" || side === "S") {
    const x = ox > 0 ? (Math.max(rx0, cx0) + Math.min(rx1, cx1)) / 2 : (cx0 + cx1) / 2;
    offset = clamp01((x - room.x) / room.w);
  } else {
    const y = oy > 0 ? (Math.max(ry0, cy0) + Math.min(ry1, cy1)) / 2 : (cy0 + cy1) / 2;
    offset = clamp01((y - room.y) / room.h);
  }
  return { side, offset };
}

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
    const key = [a.nome, b.nome].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      a: a.nome,
      b: b.nome,
      x: l?.x,
      y: l?.y,
      w: l?.w,
      h: l?.h,
      aDoor: l?.aDoor,
      bDoor: l?.bDoor,
    });
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
    // layout nuovo: se stanza ha già x/y/w/h non toccare; altrimenti usa legacy grid.
    if (!(typeof s.w === "number" && s.w > 0 && typeof s.h === "number" && s.h > 0)) {
      s.computeSize();
    }
    if (!(typeof s.x === "number" && typeof s.y === "number")) {
      s.x = START_X + (s.col || 0) * (s.w + GAP_X);
      s.y = START_Y + (s.row || 0) * (s.h + GAP_Y);
    }
    // porte legacy centrate (usate come fallback)
    s.porta = {
      N: [s.x + s.w / 2, s.y],
      S: [s.x + s.w / 2, s.y + s.h],
      W: [s.x, s.y + s.h / 2],
      E: [s.x + s.w, s.y + s.h / 2],
    };
  }

  for (const link of normalizeCorridorLinks(stanze, manualLinks)) {
    const a = gridByName(stanze, link.a);
    const b = gridByName(stanze, link.b);
    if (!a || !b) continue;
    const c = new Corridoio(a, b);
    // Se link include geometria/porte (nuovo), usala; altrimenti auto.
    const hasGeom = typeof link.x === "number" && typeof link.y === "number" && typeof link.w === "number" && typeof link.h === "number";
    const corrCx = hasGeom ? (link.x + link.w / 2) : null;
    const corrCy = hasGeom ? (link.y + link.h / 2) : null;

    const aRectDoor = hasGeom ? inferDoorFromCorridorRect(a, link) : null;
    const bRectDoor = hasGeom ? inferDoorFromCorridorRect(b, link) : null;
    const aSide = link.aDoor?.side || (aRectDoor?.side || (hasGeom ? inferSideFromPoint(a, corrCx, corrCy) : inferSide(a, b)));
    const bSide = link.bDoor?.side || (bRectDoor?.side || (hasGeom ? inferSideFromPoint(b, corrCx, corrCy) : inferSide(b, a)));

    // Se una sola porta ha offset esplicito, riusalo anche sull'altra:
    // evita che il percorso entri nella stanza successiva al centro (0.5).
    const aHasOffset = hasNumericOffset(link.aDoor);
    const bHasOffset = hasNumericOffset(link.bDoor);
    const aOffsetRaw = aHasOffset
      ? link.aDoor.offset
      : (bHasOffset
          ? link.bDoor.offset
          : (hasGeom ? (aRectDoor?.offset ?? inferOffsetFromPoint(a, aSide, corrCx, corrCy)) : 0.5));
    const bOffsetRaw = bHasOffset
      ? link.bDoor.offset
      : (aHasOffset
          ? link.aDoor.offset
          : (hasGeom ? (bRectDoor?.offset ?? inferOffsetFromPoint(b, bSide, corrCx, corrCy)) : 0.5));

    c.aDoor = { side: aSide, offset: clamp01(aOffsetRaw) };
    c.bDoor = { side: bSide, offset: clamp01(bOffsetRaw) };
    c.pA = doorPoint(a, c.aDoor, aSide);
    c.pB = doorPoint(b, c.bDoor, bSide);

    if (typeof link.x === "number" && typeof link.y === "number" && typeof link.w === "number" && typeof link.h === "number") {
      c.x = link.x; c.y = link.y; c.w = link.w; c.h = link.h;
    } else {
      // auto: rettangolo orizzontale/verticale tra i due punti porta
      const dx = c.pB[0] - c.pA[0];
      const dy = c.pB[1] - c.pA[1];
      if (Math.abs(dx) >= Math.abs(dy)) {
        // orizzontale
        const y = c.pA[1];
        c.x = Math.min(c.pA[0], c.pB[0]);
        c.y = y - 20;
        c.w = Math.abs(dx);
        c.h = 40;
      } else {
        // verticale
        const x = c.pA[0];
        c.x = x - 20;
        c.y = Math.min(c.pA[1], c.pB[1]);
        c.w = 40;
        c.h = Math.abs(dy);
      }
    }
    corridoi.push(c);
  }

  return corridoi;
}

function gridByName(stanze, nome) {
  return stanze.find((s) => s.nome === nome) || null;
}

module.exports = { buildLayout, normalizeCorridorLinks };
