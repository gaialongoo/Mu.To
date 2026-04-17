// svg_writer.js

// ---------- HELPERS ----------

function isSpecial(o) {
  return ["ingresso", "uscita", "bagno", "servizio"].includes(o.stanza.tipo);
}

function findObject(oggetti, nome) {
  return oggetti.find((o) => o.nome === nome) || null;
}

// ---------- SVG ----------

function svgHeader(title, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <style>
      /* ===== STANZE ===== */
      .stanza {
        fill: #fff;
        stroke: #2c3e50;
        stroke-width: 3;
      }

      .stanza.ingresso  { fill: #a9dfbf; stroke: #2ecc71; }
      .stanza.uscita    { fill: #f5b7b1; stroke: #e74c3c; }
      .stanza.bagno     { fill: #aed6f1; stroke: #3498db; }
      .stanza.servizio  { fill: #fad7a0; stroke: #f39c12; }

      .stanza-label {
        font: bold 14px Arial;
        fill: #2c3e50;
        pointer-events: none;
      }

      /* ===== CORRIDOI ===== */
      .corridoio { fill: #ecf0f1; stroke: #95a5a6; stroke-width: 2; }

      /* ===== OGGETTI ===== */
      .oggetto {
        fill: #3498db;
        stroke: #2980b9;
        stroke-width: 2;
        cursor: pointer;
      }
      .oggetto-label {
        font: 10px Arial;
        fill: black;
        text-anchor: middle;
        pointer-events: none;
      }

      /* Anello ripple che pulsa attorno all'oggetto */
      .oggetto-ripple {
        fill: none;
        stroke: #3498db;
        stroke-width: 2.5;
        opacity: 0;
        animation: ripple-out 1.8s ease-out infinite;
      }
      .oggetto-ripple.delay1 { animation-delay: 0.6s; }
      .oggetto-ripple.delay2 { animation-delay: 1.2s; }

      @keyframes ripple-out {
        0%   { r: 11px; opacity: 0.75; stroke-width: 2.5; }
        100% { r: 26px; opacity: 0;    stroke-width: 0.5; }
      }

      /* ===== PERCORSI ANIMATI ===== */
      .conn-obj {
        stroke: #e74c3c;
        stroke-width: 4;
        fill: none;
        stroke-linecap: round;
        stroke-dasharray: 12 10;
        animation: flow-red 1.2s linear infinite;
      }

      .conn-obj-debug {
        stroke: #27ae60;
        stroke-width: 3;
        fill: none;
        stroke-linecap: round;
        stroke-dasharray: 6 6;
        animation: flow-green 0.9s linear infinite;
        opacity: 0.85;
      }

      @keyframes flow-red {
        from { stroke-dashoffset: 0; }
        to   { stroke-dashoffset: -22; }
      }

      @keyframes flow-green {
        from { stroke-dashoffset: 0; }
        to   { stroke-dashoffset: -12; }
      }
    </style>
  </defs>
`;
}

function svgFooter() {
  return "</svg>";
}

// ---------- ROUTING ----------

function roundedPath(points) {
  const parts = [`M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`);
  }
  return parts.join(" ");
}

function routeBetween(o, t, stanze, corridoi) {
  const graph = new Map();
  for (const s of stanze) graph.set(s, []);

  const corrMap = new Map();

  for (const c of corridoi) {
    graph.get(c.a).push(c.b);
    graph.get(c.b).push(c.a);
    corrMap.set(`${c.a.nome}->${c.b.nome}`, c);
    corrMap.set(`${c.b.nome}->${c.a.nome}`, c);
  }

  const queue = [o.stanza];
  const prev = new Map();
  prev.set(o.stanza, null);

  while (queue.length) {
    const cur = queue.shift();
    if (cur === t.stanza) break;
    for (const n of (graph.get(cur) || [])) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }

  const path = [];
  let cur = t.stanza;
  while (cur !== undefined && cur !== null) {
    path.push(cur);
    cur = prev.get(cur);
  }
  path.reverse();

  const pts = [o.pos];
  const pushPoint = (p) => {
    if (!p) return;
    const last = pts[pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    pts.push(p);
  };

  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i];
    const B = path[i + 1];
    const c = corrMap.get(`${A.nome}->${B.nome}`);

    const fromDoor = resolveDoorPoint(A, B, c);
    pushPoint(fromDoor);

    const toDoor = resolveDoorPoint(B, A, c);
    for (const p of corridorTransitPoints(c, fromDoor, toDoor)) pushPoint(p);
    pushPoint(toDoor);
  }

  pushPoint(t.pos);
  return pts;
}

function resolveDoorPoint(room, otherRoom, corr) {
  if (corr) {
    // Routing dinamico: usa sempre geometria reale stanza<->corridoio.
    // Non usare pA/pB (derivati da aDoor/bDoor) per evitare passaggi forzati.
    const geomDoor = inferDoorFromCorridorRect(room, corr);
    if (geomDoor) return geomDoor;
  }
  // Fallback estremo solo se manca del tutto il corridoio/geom.
  return room.porta[inferLegacySide(room, otherRoom)];
}

function inferDoorFromCorridorRect(room, corr) {
  if (!room || !corr) return null;
  const rx0 = room.x, rx1 = room.x + room.w;
  const ry0 = room.y, ry1 = room.y + room.h;
  const cx0 = corr.x, cx1 = corr.x + corr.w;
  const cy0 = corr.y, cy1 = corr.y + corr.h;
  const ox = Math.max(0, Math.min(rx1, cx1) - Math.max(rx0, cx0));
  const oy = Math.max(0, Math.min(ry1, cy1) - Math.max(ry0, cy0));
  const PENALTY = 1e6;
  const dN = Math.abs(cy1 - ry0) + (ox > 0 ? 0 : PENALTY);
  const dS = Math.abs(cy0 - ry1) + (ox > 0 ? 0 : PENALTY);
  const dW = Math.abs(cx1 - rx0) + (oy > 0 ? 0 : PENALTY);
  const dE = Math.abs(cx0 - rx1) + (oy > 0 ? 0 : PENALTY);
  const m = Math.min(dN, dS, dW, dE);
  if (m === dN) {
    const x = ox > 0 ? (Math.max(rx0, cx0) + Math.min(rx1, cx1)) / 2 : (cx0 + cx1) / 2;
    return [x, room.y];
  }
  if (m === dS) {
    const x = ox > 0 ? (Math.max(rx0, cx0) + Math.min(rx1, cx1)) / 2 : (cx0 + cx1) / 2;
    return [x, room.y + room.h];
  }
  if (m === dW) {
    const y = oy > 0 ? (Math.max(ry0, cy0) + Math.min(ry1, cy1)) / 2 : (cy0 + cy1) / 2;
    return [room.x, y];
  }
  const y = oy > 0 ? (Math.max(ry0, cy0) + Math.min(ry1, cy1)) / 2 : (cy0 + cy1) / 2;
  return [room.x + room.w, y];
}

function corridorTransitPoints(corr, fromDoor, toDoor) {
  if (!corr || !fromDoor || !toDoor) return [];
  // Evita percorsi diagonali nel corridoio quando e' decentrato.
  if ((corr.w || 0) >= (corr.h || 0)) {
    const y = corr.y + corr.h / 2;
    return [[fromDoor[0], y], [toDoor[0], y]];
  }
  const x = corr.x + corr.w / 2;
  return [[x, fromDoor[1]], [x, toDoor[1]]];
}

function inferLegacySide(fromRoom, toRoom) {
  // fallback per layout legacy: usa row/col solo se discriminano davvero la direzione.
  // Con layout libero (x/y/w/h), row/col possono restare a 0 di default e
  // causare lati porta errati (es. sempre N): in quel caso usa geometria.
  const hasGrid = typeof fromRoom.col === "number" && typeof toRoom.col === "number" && typeof fromRoom.row === "number" && typeof toRoom.row === "number";
  const gridDiscriminates = hasGrid && (toRoom.col !== fromRoom.col || toRoom.row !== fromRoom.row);
  if (gridDiscriminates) {
    if (toRoom.col > fromRoom.col) return "E";
    if (toRoom.col < fromRoom.col) return "W";
    if (toRoom.row > fromRoom.row) return "S";
    return "N";
  }
  const dx = (toRoom.x + toRoom.w / 2) - (fromRoom.x + fromRoom.w / 2);
  const dy = (toRoom.y + toRoom.h / 2) - (fromRoom.y + fromRoom.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "S" : "N";
}

// ---------- DRAW ----------

function draw(svg, stanze, corridoi, oggetti, edgeMode = "all", edgeFocus = null) {
  // ---------- CORRIDOI ----------
  for (const c of corridoi) {
    svg += `\n<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="corridoio"/>`;
  }

  // ---------- STANZE ----------
  // Disegna le stanze sopra i corridoi: se un corridoio invade una stanza,
  // la stanza resta visivamente prioritaria.
  for (const s of stanze) {
    const cls = s.tipo !== "normale" ? `stanza ${s.tipo}` : "stanza";
    svg += `\n<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" class="${cls}"/>`;
    svg += `\n<text x="${s.x + s.w / 2}" y="${s.y + 16}" class="stanza-label" text-anchor="middle">${s.nome}</text>`;
  }

  // ---------- PERCORSI ----------
  if (edgeMode === "path") {
    if (edgeFocus && edgeFocus.length === 2) {
      const a = findObject(oggetti, edgeFocus[0]);
      const b = findObject(oggetti, edgeFocus[1]);
      if (a && b) {
        const d = roundedPath(routeBetween(a, b, stanze, corridoi));
        const cls = isSpecial(a) || isSpecial(b) ? "conn-obj-debug" : "conn-obj";
        svg += `\n<path d="${d}" class="${cls}"/>`;
      }
    }
  } else if (edgeMode !== "none") {
    const specials = oggetti.filter((o) => isSpecial(o));
    const drawn = new Set();
    const edges = [];

    for (const o of oggetti) {
      if (!isSpecial(o)) {
        for (const name of o.connessi) {
          const t = oggetti.find((x) => x.nome === name);
          if (!t || isSpecial(t)) continue;
          const key = [o.nome, t.nome].sort().join("|");
          if (drawn.has(key)) continue;
          drawn.add(key);
          edges.push([o, t, "conn-obj"]);
        }
      }

      for (const s of specials) {
        if (s === o) continue;
        const key = [o.nome, s.nome].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        edges.push([o, s, "conn-obj-debug"]);
      }
    }

    for (const [o, t, cls] of edges) {
      if (edgeMode === "services" && !isSpecial(o) && !isSpecial(t)) continue;
      const d = roundedPath(routeBetween(o, t, stanze, corridoi));
      svg += `\n<path d="${d}" class="${cls}"/>`;
    }
  }

  // ---------- OGGETTI (ripple solo su f1 = edgeFocus[0]) ----------
  const rippleTarget = edgeFocus && edgeFocus[1] ? edgeFocus[1] : null;

  for (const o of oggetti) {
    if (o.visibile) {
      const [x, y] = o.pos;

      // Ripple solo sull'oggetto f1 (es. "mummia" in /Museo/path/mummia/collana)
      if (o.nome === rippleTarget) {
        svg += `\n<circle cx="${x}" cy="${y}" r="11" class="oggetto-ripple"/>`;
        svg += `\n<circle cx="${x}" cy="${y}" r="11" class="oggetto-ripple delay1"/>`;
        svg += `\n<circle cx="${x}" cy="${y}" r="11" class="oggetto-ripple delay2"/>`;
      }

      svg += `\n<circle cx="${x}" cy="${y}" r="10" class="oggetto"/>`;
      svg += `\n<text x="${x}" y="${y + 3}" class="oggetto-label">${o.nome}</text>`;
    }
  }

  return svg;
}

module.exports = { svgHeader, svgFooter, draw };
