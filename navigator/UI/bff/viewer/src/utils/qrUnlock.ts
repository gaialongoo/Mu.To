/**
 * Helper per il QR-gate degli oggetti museali.
 *
 * Il gate si attiva solo da mobile (touch + viewport stretto). Una volta
 * validato il QR di un oggetto, l'oggetto e' considerato sbloccato e
 * memorizzato in localStorage finche' l'utente non fa logout.
 */

const STORAGE_PREFIX = "muto_qr_unlocked_";

/** True se il dispositivo e' considerato "mobile" ai fini del QR-gate. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth <= 900;
    return coarse && narrow;
  } catch {
    return false;
  }
}

function storageKey(museo: string): string {
  return `${STORAGE_PREFIX}${String(museo || "").trim()}`;
}

function readUnlockedSet(museo: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(museo));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeUnlockedSet(museo: string, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(museo),
      JSON.stringify(Array.from(set)),
    );
  } catch {
    /* quota piena o storage disabilitato: ignoriamo */
  }
}

/** True se l'oggetto e' gia' stato sbloccato in questo browser. */
export function isObjectUnlocked(museo: string, oggetto: string): boolean {
  const m = String(museo || "").trim();
  const o = String(oggetto || "").trim();
  if (!m || !o) return false;
  return readUnlockedSet(m).has(o);
}

/** Segna l'oggetto come sbloccato. */
export function markObjectUnlocked(museo: string, oggetto: string): void {
  const m = String(museo || "").trim();
  const o = String(oggetto || "").trim();
  if (!m || !o) return;
  const set = readUnlockedSet(m);
  if (set.has(o)) return;
  set.add(o);
  writeUnlockedSet(m, set);
}

/** Rimuove tutte le chiavi `muto_qr_unlocked_*`. Da chiamare al logout. */
export function clearAllQrUnlocks(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignora */
  }
}

/**
 * Verifica un QR sul backend.
 *
 * Il backend richiede X-API-Key, ma il viewer parla con il BFF che la inietta.
 */
export async function validateQrCode(params: {
  codice: string;
  museo: string;
  oggetto: string;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    const r = await fetch("/api/qr/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        codice: params.codice,
        museo: params.museo,
        oggetto: params.oggetto,
      }),
    });
    if (r.ok) return { ok: true };
    let message = "Codice QR non valido";
    try {
      const data = await r.json();
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      /* ignora body non-json */
    }
    return { ok: false, status: r.status, message };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Errore di rete",
    };
  }
}
