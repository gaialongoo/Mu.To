// svg_writer.js

// ---------- HELPERS ----------

function isSpecial(o) {
  return ["ingresso", "uscita", "bagno", "servizio"].includes(o.stanza.tipo);
}

function findObject(oggetti, nome) {
  return oggetti.find((o) => o.nome === nome) || null;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function roomPatternId(nome, v = 0) {
  const safeName = String(nome || "stanza").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `room-bg-${safeName}-${v}`;
}

const DEFAULT_LABEL_X = 0.5;
const DEFAULT_LABEL_Y = 0.09;

const LEGACY_LABEL_POS = {
  "top-center": { labelX: 0.5, labelY: 0.09 },
  "top-left": { labelX: 0.08, labelY: 0.09 },
  "top-right": { labelX: 0.92, labelY: 0.09 },
  center: { labelX: 0.5, labelY: 0.5 },
  "bottom-center": { labelX: 0.5, labelY: 0.91 },
  "bottom-left": { labelX: 0.08, labelY: 0.91 },
  "bottom-right": { labelX: 0.92, labelY: 0.91 },
};

function normalizeLabelRel(n, fallback = 0.5) {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function resolveLabelRel(room) {
  if (typeof room?.labelX === "number" || typeof room?.labelY === "number") {
    return {
      labelX: normalizeLabelRel(room.labelX, DEFAULT_LABEL_X),
      labelY: normalizeLabelRel(room.labelY, DEFAULT_LABEL_Y),
    };
  }
  const legacy = LEGACY_LABEL_POS[String(room?.labelPos || "").trim()];
  if (legacy) return legacy;
  return { labelX: DEFAULT_LABEL_X, labelY: DEFAULT_LABEL_Y };
}

function roomLabelLayout(room) {
  const x = room.x ?? 0;
  const y = room.y ?? 0;
  const w = room.w ?? 220;
  const h = room.h ?? 180;
  const { labelX, labelY } = resolveLabelRel(room);
  const lx = x + w * labelX;
  const ly = y + h * labelY;
  const textAnchor = labelX <= 0.15 ? "start" : labelX >= 0.85 ? "end" : "middle";
  return { x: lx, y: ly, textAnchor, dominantBaseline: "middle" };
}

// ---------- SVG ----------

function svgHeader(title, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <style>
      /* Stanze: bordi come in origine (IN verde, OUT rosso, WC/servizi a colori, sale grigio scuro) */
      .stanza {
        stroke: #2c3e50;
        stroke-width: 3;
      }

      .stanza.ingresso {
        stroke: #2ecc71;
      }
      .stanza.uscita {
        stroke: #e74c3c;
      }
      .stanza.bagno {
        stroke: #3498db;
      }
      .stanza.servizio {
        stroke: #f39c12;
      }

      .stanza-label {
        font: bold 14px Arial;
        fill: #000000;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        pointer-events: none;
      }

      /* ===== CORRIDOI ===== */
      .corridoio {
        fill: #ecf0f1;
        stroke: #95a5a6;
        stroke-width: 2;
      }

      /* ===== OGGETTI ===== */
      .oggetto {
        fill: rgba(92, 191, 128, 0.28);
        stroke: #5cbf80;
        stroke-width: 2;
        cursor: pointer;
      }
      .oggetto-label {
        font: 10px Arial;
        fill: #3d8f5a;
        font-weight: 700;
        text-anchor: middle;
        pointer-events: none;
      }

      /* Anello ripple che pulsa attorno all'oggetto */
      .oggetto-ripple {
        fill: none;
        stroke: #5cbf80;
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

      /* ===== PERCORSI ANIMATI (stesso verde per tutti i segmenti) ===== */
      .conn-percorso,
      .conn-obj,
      .conn-obj-debug {
        stroke: #5cbf80;
        stroke-width: 4;
        fill: none;
        stroke-linecap: round;
        stroke-dasharray: 12 10;
        animation: flow-dash 1.1s linear infinite;
        opacity: 1;
      }

      @keyframes flow-dash {
        from { stroke-dashoffset: 0; }
        to   { stroke-dashoffset: -22; }
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

    // Attraversa la stanza con due porte diverse (es. stanza 6: corridoio orizzontale + verticale).
    if (i + 1 < path.length - 1) {
      const C = path[i + 2];
      const nextFromDoor = resolveDoorPoint(B, C, corrMap.get(`${B.nome}->${C.nome}`));
      for (const p of roomTransitPoints(B, toDoor, nextFromDoor)) pushPoint(p);
    }
  }

  pushPoint(t.pos);
  return pts;
}

function resolveDoorPoint(room, otherRoom, corr) {
  if (corr && otherRoom) {
    const door = inferDoorFromCorridorRect(room, corr, otherRoom);
    if (door) return door;
  }
  return room.porta[inferLegacySide(room, otherRoom)];
}

function inferDoorFromCorridorRect(room, corr, otherRoom = null) {
  if (!room || !corr) return null;
  const rx0 = room.x, rx1 = room.x + room.w;
  const ry0 = room.y, ry1 = room.y + room.h;
  const cx0 = corr.x, cx1 = corr.x + corr.w;
  const cy0 = corr.y, cy1 = corr.y + corr.h;
  const ox = Math.max(0, Math.min(rx1, cx1) - Math.max(rx0, cx0));
  const oy = Math.max(0, Math.min(ry1, cy1) - Math.max(ry0, cy0));

  // Corridoio che invade la stanza: usa il lato verso l'altra stanza (non il bordo
  // geometricamente più vicino, che può essere N mentre il corridoio è in basso).
  if (ox > 0 && oy > 0 && otherRoom) {
    const side = inferLegacySide(room, otherRoom);
    const corrCx = (cx0 + cx1) / 2;
    const corrCy = (cy0 + cy1) / 2;
    if (side === "N" || side === "S") {
      const x = Math.max(rx0, cx0) + ox / 2;
      return [x, side === "N" ? ry0 : ry1];
    }
    const y = Math.max(ry0, cy0) + oy / 2;
    return [side === "W" ? rx0 : rx1, y];
  }

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

function clampBetween(lo, hi, v) {
  return Math.max(lo, Math.min(hi, v));
}

function corridorLaneCoord(corr, fromDoor, toDoor, axis) {
  const isY = axis === "y";
  const c0 = isY ? corr.y : corr.x;
  const c1 = isY ? corr.y + corr.h : corr.x + corr.w;
  if (c1 <= c0) return isY ? fromDoor[1] : fromDoor[0];

  const d0 = isY ? fromDoor[1] : fromDoor[0];
  const d1 = isY ? toDoor[1] : toDoor[0];
  const inside = [d0, d1].filter((d) => d >= c0 && d <= c1);
  if (inside.length === 1) return inside[0];
  if (inside.length === 2) return (inside[0] + inside[1]) / 2;

  const nearestEdge = (d) => (Math.abs(d - c0) <= Math.abs(d - c1) ? c0 : c1);
  const e0 = nearestEdge(d0);
  const e1 = nearestEdge(d1);
  if (e0 === e1) return e0;
  return clampBetween(c0, c1, (d0 + d1) / 2);
}

function pointsNear(a, b, eps = 0.5) {
  if (!a || !b) return false;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
}

function corridorTransitPoints(corr, fromDoor, toDoor) {
  if (!corr || !fromDoor || !toDoor) return [];
  if (pointsNear(fromDoor, toDoor)) return [];

  const horizontal = (corr.w || 0) >= (corr.h || 0);
  const out = [];
  if (horizontal) {
    const y = corridorLaneCoord(corr, fromDoor, toDoor, "y");
    const midA = [fromDoor[0], y];
    const midB = [toDoor[0], y];
    if (!pointsNear(fromDoor, midA)) out.push(midA);
    if (!pointsNear(midA, midB)) out.push(midB);
    if (!pointsNear(midB, toDoor)) out.push([...toDoor]);
  } else {
    const x = corridorLaneCoord(corr, fromDoor, toDoor, "x");
    const midA = [x, fromDoor[1]];
    const midB = [x, toDoor[1]];
    if (!pointsNear(fromDoor, midA)) out.push(midA);
    if (!pointsNear(midA, midB)) out.push(midB);
    if (!pointsNear(midB, toDoor)) out.push([...toDoor]);
  }
  return out;
}

function roomTransitPoints(room, inDoor, outDoor) {
  if (!room || !inDoor || !outDoor) return [];
  if (inDoor[0] === outDoor[0] || inDoor[1] === outDoor[1]) return [outDoor];

  const bendA = [inDoor[0], outDoor[1]];
  const bendB = [outDoor[0], inDoor[1]];
  const center = [room.x + room.w / 2, room.y + room.h / 2];
  const distA = Math.abs(bendA[0] - center[0]) + Math.abs(bendA[1] - center[1]);
  const distB = Math.abs(bendB[0] - center[0]) + Math.abs(bendB[1] - center[1]);
  const bend = distA <= distB ? bendA : bendB;

  return [bend, outDoor];
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
  const roomsWithBg = stanze.filter((s) => typeof s.bgImage === "string" && s.bgImage.trim());
  if (roomsWithBg.length > 0) {
    svg += "\n<defs>";
    for (const s of roomsWithBg) {
      const v = s.bgImage ? s.bgImage.slice(-10).replace(/[^a-zA-Z0-9]/g, "") : "0";
      const pid = roomPatternId(s.nome, v);
      svg += `\n<pattern id="${pid}" patternUnits="userSpaceOnUse" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}">`;
      svg += `\n<rect x="0" y="0" width="${s.w}" height="${s.h}" fill="#fff"/>`;
      svg += `\n<image href="${escapeXml(s.bgImage)}" x="0" y="0" width="${s.w}" height="${s.h}" preserveAspectRatio="none"/>`;
      svg += `\n</pattern>`;
    }
    svg += "\n</defs>";
  }

  // ---------- CORRIDOI ----------
  for (const c of corridoi) {
    svg += `\n<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="corridoio"/>`;
  }

  // ---------- STANZE ----------
  // Disegna le stanze sopra i corridoi: se un corridoio invade una stanza,
  // la stanza resta visivamente prioritaria.
  for (const s of stanze) {
    const cls = s.tipo !== "normale" ? `stanza ${s.tipo}` : "stanza";
    const v = s.bgImage ? s.bgImage.slice(-10).replace(/[^a-zA-Z0-9]/g, "") : "0";
    const roomFill = typeof s.bgImage === "string" && s.bgImage.trim()
      ? `url(#${roomPatternId(s.nome, v)})`
      : "#fff";
    svg += `\n<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" class="${cls}" fill="${roomFill}"/>`;
    const lbl = roomLabelLayout(s);
    svg += `\n<text x="${lbl.x}" y="${lbl.y}" class="stanza-label" text-anchor="${lbl.textAnchor}" dominant-baseline="${lbl.dominantBaseline}">${escapeXml(s.nome)}</text>`;
  }

  // ---------- PERCORSI ----------
  if (edgeMode === "path") {
    if (edgeFocus && edgeFocus.length === 2) {
      const a = findObject(oggetti, edgeFocus[0]);
      const b = findObject(oggetti, edgeFocus[1]);
      if (a && b) {
        const d = roundedPath(routeBetween(a, b, stanze, corridoi));
        svg += `\n<path d="${d}" class="conn-percorso"/>`;
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
          edges.push([o, t, "conn-percorso"]);
        }
      }

      for (const s of specials) {
        if (s === o) continue;
        const key = [o.nome, s.nome].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        edges.push([o, s, "conn-percorso"]);
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

      const objectLabel = o.label != null ? o.label : o.nome;
      const radius = o.isVirtualText ? 7 : 10;
      const objectType = o.objectType === "text" ? "text" : "normal";
      svg += `\n<circle cx="${x}" cy="${y}" r="${radius}" class="oggetto" data-object-name="${escapeXml(o.nome)}" data-object-type="${objectType}"/>`;
      svg += `\n<text x="${x}" y="${y + 3}" class="oggetto-label" data-object-name="${escapeXml(o.nome)}" data-object-type="${objectType}">${escapeXml(objectLabel)}</text>`;
    }
  }

  return svg;
}

module.exports = { svgHeader, svgFooter, draw };
