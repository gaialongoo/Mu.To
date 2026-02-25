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
      .stanza { fill:#fff; stroke:#2c3e50; stroke-width:3; }
      .stanza.ingresso { fill:#a9dfbf; stroke:#2ecc71; }
      .stanza.uscita { fill:#f5b7b1; stroke:#e74c3c; }
      .stanza.bagno { fill:#aed6f1; stroke:#3498db; }
      .stanza.servizio { fill:#fad7a0; stroke:#f39c12; }

      .stanza-label { font:bold 14px Arial; fill:#2c3e50; }

      .corridoio { fill:#ecf0f1; stroke:#95a5a6; stroke-width:2; }

      .oggetto { fill:#3498db; stroke:#2980b9; stroke-width:2; }
      .oggetto-label { font:10px Arial; fill:black; text-anchor:middle; pointer-events:none; }

      /* ===== PERCORSI ANIMATI ===== */

      .conn-obj {
        stroke:#e74c3c;
        stroke-width:4;
        fill:none;
        stroke-linecap:round;
        stroke-dasharray:12 10;
        animation: flow-red 1.2s linear infinite;
      }

      .conn-obj-debug {
        stroke:black;
        stroke-width:3;
        fill:none;
        stroke-linecap:round;
        stroke-dasharray:6 6;
        animation: flow-black 0.9s linear infinite;
        opacity:0.85;
      }

      @keyframes flow-red {
        from { stroke-dashoffset: 0; }
        to   { stroke-dashoffset: -22; }
      }

      @keyframes flow-black {
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
  // Costruisce grafo
  const graph = new Map();
  for (const s of stanze) graph.set(s, []);

  const corrMap = new Map();

  for (const c of corridoi) {
    graph.get(c.a).push(c.b);
    graph.get(c.b).push(c.a);
    corrMap.set(`${c.a.nome}->${c.b.nome}`, c);
    corrMap.set(`${c.b.nome}->${c.a.nome}`, c);
  }

  // BFS
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

  // Ricostruisce percorso
  const path = [];
  let cur = t.stanza;
  while (cur !== undefined && cur !== null) {
    path.push(cur);
    cur = prev.get(cur);
  }
  path.reverse();

  const pts = [o.pos];

  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i];
    const B = path[i + 1];
    const c = corrMap.get(`${A.nome}->${B.nome}`);

    if (B.col > A.col) pts.push(A.porta["E"]);
    else if (B.col < A.col) pts.push(A.porta["W"]);
    else if (B.row > A.row) pts.push(A.porta["S"]);
    else pts.push(A.porta["N"]);

    pts.push([c.x + c.w / 2, c.y + c.h / 2]);

    if (A.col > B.col) pts.push(B.porta["E"]);
    else if (A.col < B.col) pts.push(B.porta["W"]);
    else if (A.row > B.row) pts.push(B.porta["S"]);
    else pts.push(B.porta["N"]);

    if (i + 1 < path.length - 1) {
      pts.push([B.x + B.w / 2, B.y + B.h / 2]);
    }
  }

  pts.push(t.pos);
  return pts;
}

// ---------- DRAW ----------

function draw(svg, stanze, corridoi, oggetti, edgeMode = "all", edgeFocus = null) {
  // ---------- STANZE ----------
  for (const s of stanze) {
    const cls = s.tipo !== "normale" ? `stanza ${s.tipo}` : "stanza";
    svg += `\n<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" class="${cls}"/>`;
    svg += `\n<text x="${s.x + s.w / 2}" y="${s.y + 16}" class="stanza-label" text-anchor="middle">${s.nome}</text>`;
  }

  // ---------- CORRIDOI ----------
  for (const c of corridoi) {
    svg += `\n<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="corridoio"/>`;
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

  // ---------- OGGETTI ----------
  for (const o of oggetti) {
    if (o.visibile) {
      const [x, y] = o.pos;
      svg += `\n<circle cx="${x}" cy="${y}" r="10" class="oggetto"/>`;
      svg += `\n<text x="${x}" y="${y + 3}" class="oggetto-label">${o.nome}</text>`;
    }
  }

  return svg;
}

module.exports = { svgHeader, svgFooter, draw };
