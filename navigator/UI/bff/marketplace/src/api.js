// Tutte le chiamate usano /api — il proxy Vite le redirige a https://localhost:3000
// e inietta automaticamente X-API-Key (configurato in vite.config.js).
// Se l'utente imposta una key manualmente nel browser, viene aggiunta qui.

const BASE = "/api";

const BUILT_IN_KEY = typeof __API_KEY__ !== "undefined" ? __API_KEY__ : "";
let runtimeKey = BUILT_IN_KEY;

export function setApiKey(key)  { runtimeKey = key; }
export function clearApiKey()   { runtimeKey = BUILT_IN_KEY; }
export function hasRuntimeKey() { return !!runtimeKey; }

export async function api(path, opts = {}) {
  const isFormData = opts.isFormData;
  const headers = isFormData
    ? (runtimeKey ? { "X-API-Key": runtimeKey } : {})
    : Object.assign(
        { "Content-Type": "application/json" },
        runtimeKey ? { "X-API-Key": runtimeKey } : {}
      );

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${t}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res;
}

export const enc = (s) => encodeURIComponent(s);
export const previewUrl = (museo, nome) =>
  `${BASE}/musei/${enc(museo)}/oggetti/${enc(nome)}/immagini/preview`;