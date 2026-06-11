// Funzioni pure condivise dallo store Alpine. Nessuna dipendenza da framework.

export const PAGE_SIZE = 9;

export const LEVEL_KEY_TO_INDEX = { bambino: 0, studente: 1, esperto: 2, avanzato: 3 };
export const DURATION_KEY_TO_INDEX = { corto: 0, medio: 1, lungo: 2, esteso: 3 };

export function displayI18nMapLookup(map, key, navLang) {
  if (!key) return "";
  if (navLang === "it") return key;
  const entry = map?.[key];
  if (!entry || typeof entry !== "object") return key;
  const t = entry[navLang];
  return typeof t === "string" && t.trim() ? t.trim() : key;
}

export function formatPrezzo(prezzo, mp) {
  const amount = Number(prezzo);
  if (!Number.isFinite(amount) || amount <= 0) return mp("included");
  return `${amount.toFixed(2).replace(".", ",")} EUR`;
}

export function formatEuroAmount(prezzo) {
  const amount = Number(prezzo);
  if (!Number.isFinite(amount) || amount <= 0) return "0,00 EUR";
  const [intPart, dec = "00"] = amount.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${dec} EUR`;
}

export function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseAnnoValue(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const match = raw.match(/-?\d+/);
  if (!match) return null;
  const value = Math.abs(Number(match[0]));
  if (!Number.isFinite(value)) return null;
  const hasAc = /a\s*\.?\s*c\s*\.?/i.test(raw);
  return hasAc ? -value : value;
}

export function yearInputToSigned(yearValue, era) {
  const n = Math.abs(Number(yearValue));
  if (!Number.isFinite(n) || n <= 0) return null;
  return era === "ac" ? -n : n;
}

function buildObjectGraph(oggetti = []) {
  const graph = new Map();
  for (const obj of oggetti) {
    const name = String(obj?.nome || "").trim();
    if (!name) continue;
    if (!graph.has(name)) graph.set(name, new Set());
  }
  for (const obj of oggetti) {
    const from = String(obj?.nome || "").trim();
    if (!from || !graph.has(from)) continue;
    const connessi = Array.isArray(obj?.connessi) ? obj.connessi : [];
    for (const nextRaw of connessi) {
      const to = String(nextRaw || "").trim();
      if (!to || !graph.has(to)) continue;
      graph.get(from).add(to);
      graph.get(to).add(from);
    }
  }
  return graph;
}

function shortestDistance(graph, start, goal) {
  if (!start || !goal) return Number.POSITIVE_INFINITY;
  if (start === goal) return 0;
  if (!graph.has(start) || !graph.has(goal)) return Number.POSITIVE_INFINITY;
  const queue = [{ node: start, dist: 0 }];
  const visited = new Set([start]);
  while (queue.length > 0) {
    const { node, dist } = queue.shift();
    for (const next of graph.get(node) || []) {
      if (visited.has(next)) continue;
      if (next === goal) return dist + 1;
      visited.add(next);
      queue.push({ node: next, dist: dist + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function optimizeObjectsOrderByPath(selectedNames, allObjects) {
  if (!Array.isArray(selectedNames) || selectedNames.length <= 1) return selectedNames || [];
  const selected = selectedNames.map((x) => String(x || "").trim()).filter(Boolean);
  if (selected.length <= 1) return selected;

  const graph = buildObjectGraph(allObjects);
  const objectByName = new Map(
    (Array.isArray(allObjects) ? allObjects : [])
      .map((obj) => [String(obj?.nome || "").trim(), obj])
      .filter(([name]) => !!name)
  );
  const hasIN = graph.has("IN");
  let current = hasIN ? "IN" : selected[0];
  const remaining = new Set(selected);
  const ordered = [];

  while (remaining.size > 0) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const currentRoom = String(objectByName.get(current)?.stanza || "").trim().toLowerCase();
    for (const candidate of remaining) {
      const d = shortestDistance(graph, current, candidate);
      const candidateRoom = String(objectByName.get(candidate)?.stanza || "").trim().toLowerCase();
      const roomPenalty = currentRoom && candidateRoom && currentRoom === candidateRoom ? 0 : 1000;
      const score = roomPenalty + d;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best) {
      const first = Array.from(remaining).sort((a, b) => a.localeCompare(b))[0];
      ordered.push(first);
      remaining.delete(first);
      current = first;
      continue;
    }
    ordered.push(best);
    remaining.delete(best);
    current = best;
  }

  return ordered;
}

export function extractDefaultDescription(oggetto) {
  const descrizioni = Array.isArray(oggetto?.descrizioni) ? oggetto.descrizioni : [];
  for (const level of descrizioni) {
    if (!Array.isArray(level)) continue;
    for (const text of level) {
      const value = String(text || "").trim();
      if (value) return value;
    }
  }
  return "";
}
