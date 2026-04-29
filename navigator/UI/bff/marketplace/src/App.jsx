import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, enc, setApiKey, clearApiKey } from "./api";
import Toast from "./components/Toast";
import ApiKeyModal from "./components/ApiKeyModal";
import ItemCard from "./components/ItemCard";

const PAGE_SIZE = 9;

// ─── Arc deco background ────────────────────────────────────────────────────
function ArcDeco() {
  return (
    <>
      <div style={{ position: "fixed", top: -180, right: -180, width: 520, height: 520, pointerEvents: "none", zIndex: 0 }}>
        <svg viewBox="0 0 520 520" xmlns="http://www.w3.org/2000/svg">
          <circle cx="520" cy="0" r="160" fill="none" stroke="#5cbf80" strokeOpacity="0.045" strokeWidth="1.5"/>
          <circle cx="520" cy="0" r="230" fill="none" stroke="#5cbf80" strokeOpacity="0.03"  strokeWidth="1"/>
          <circle cx="520" cy="0" r="300" fill="none" stroke="#5cbf80" strokeOpacity="0.02"  strokeWidth="0.75"/>
        </svg>
      </div>
      <div style={{ position: "fixed", bottom: -200, left: -200, width: 480, height: 480, pointerEvents: "none", zIndex: 0 }}>
        <svg viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
          <circle cx="0" cy="480" r="150" fill="none" stroke="#5cbf80" strokeOpacity="0.04"  strokeWidth="1.5"/>
          <circle cx="0" cy="480" r="220" fill="none" stroke="#5cbf80" strokeOpacity="0.028" strokeWidth="1"/>
          <circle cx="0" cy="480" r="290" fill="none" stroke="#5cbf80" strokeOpacity="0.018" strokeWidth="0.75"/>
        </svg>
      </div>
    </>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function Skeleton() {
  const shimmer = {
    background: "linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  };
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ width: "100%", height: 155, ...shimmer }} />
          <div style={{ padding: "20px 22px" }}>
            <div style={{ height: 12, borderRadius: 2, marginBottom: 12, ...shimmer }} />
            <div style={{ height: 12, width: "60%", borderRadius: 2, marginBottom: 12, ...shimmer }} />
            <div style={{ height: 12, width: "40%", borderRadius: 2, ...shimmer }} />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────
function Pagination({ total, current, onChange }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "36px 0 16px" }}>
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <button key={p} onClick={() => onChange(p)} style={{
          padding: "8px 13px",
          border: `1px solid ${p === current ? "var(--gold)" : "var(--border)"}`,
          background: p === current ? "var(--gold)" : "var(--bg-card)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          fontFamily: "var(--font-head)",
          fontSize: 10,
          letterSpacing: "0.1em",
          color: p === current ? "#0d0d0d" : "var(--text-dim)",
        }}>{p}</button>
      ))}
    </div>
  );
}

function formatPrezzo(prezzo) {
  const amount = Number(prezzo);
  if (!Number.isFinite(amount) || amount <= 0) return "Incluso";
  return `${amount.toFixed(2).replace(".", ",")} EUR`;
}

function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function optimizeObjectsOrderByPath(selectedNames, allObjects) {
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
      // fallback robusto: se non troviamo connessioni, preserviamo un ordine stabile
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

// ─── Visit card ──────────────────────────────────────────────────────────────
function VisitCard({ percorso, canView, onView, onBuy, buying, delay }) {
  const prezzo = Number(percorso.prezzo || 0);
  const included = prezzo <= 0;
  const disabled = !included && !canView && buying;
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", overflow: "hidden",
      animation: `fadeUp 0.4s ease ${delay}s backwards`,
    }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div style={{ padding: "20px 22px 14px" }}>
        <div style={{ fontFamily: "var(--font-head)", fontSize: 14, fontWeight: 500, letterSpacing: "0.07em", color: "var(--text)", marginBottom: 10 }}>{percorso.nome}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.05em", color: "var(--text-dim)" }}>{(percorso.oggetti || []).length} opere</div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: included ? "var(--gold)" : "var(--text)", fontFamily: "var(--font-head)" }}>{formatPrezzo(prezzo)}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(percorso.oggetti || []).slice(0, 3).map((n) => (
            <span key={n} style={{ background: "var(--gold-dim)", color: "var(--gold)", border: "1px solid rgba(92,191,128,0.18)", padding: "3px 9px", borderRadius: 2, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "var(--font-head)" }}>{n}</span>
          ))}
          {percorso.oggetti?.length > 3 && <span style={{ background: "var(--gold-dim)", color: "var(--gold)", border: "1px solid rgba(92,191,128,0.18)", padding: "3px 9px", borderRadius: 2, fontSize: 9, letterSpacing: "0.14em", fontFamily: "var(--font-head)" }}>+{percorso.oggetti.length - 3}</span>}
        </div>
      </div>
      <div style={{ padding: "10px 22px 18px" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onView?.(percorso)}
            disabled={!canView}
            style={{
              flex: 1,
            padding: "8px 10px",
            background: "transparent",
            border: `1px solid ${canView ? "var(--border)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: "var(--radius)",
            cursor: canView ? "pointer" : "not-allowed",
            fontFamily: "var(--font-head)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: canView ? "var(--gold)" : "var(--text-faint)",
            transition: "all 0.2s",
            opacity: canView ? 1 : 0.7,
          }}
          >
            Visualizza
          </button>
          {!included && !canView && (
            <button
              onClick={() => onBuy?.(percorso)}
              disabled={disabled}
              style={{
                flex: 1,
                padding: "8px 10px",
                background: "var(--gold-dim)",
                border: "1px solid rgba(92,191,128,0.3)",
                borderRadius: "var(--radius)",
                cursor: disabled ? "not-allowed" : "pointer",
                fontFamily: "var(--font-head)",
                fontSize: 9,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--gold)",
                opacity: disabled ? 0.7 : 1,
              }}
            >
              {buying ? "Acquisto..." : "Acquista"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const DESCRIPTION_LEVELS = ["Bambino", "Studente", "Esperto", "Avanzato"];
  const DESCRIPTION_LENGTHS = ["Breve", "Medio", "Lungo"];
  const LEVEL_KEY_TO_INDEX = {
    bambino: 0,
    studente: 1,
    esperto: 2,
    avanzato: 3,
  };
  const DURATION_KEY_TO_INDEX = {
    corto: 0,
    medio: 1,
    lungo: 2,
  };
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemImages, setSelectedItemImages] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [showAllDescriptions, setShowAllDescriptions] = useState(false);
  const [selectedGalleryIndex, setSelectedGalleryIndex] = useState(0);
  const [profileForm, setProfileForm] = useState({
    nome: "",
    cognome: "",
    email: "",
    eta: "",
    ruolo: "",
    livello: "",
    durata: "",
    interessi: [],
  });
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Disabilitare lo scroll quando il profilo è aperto
  useEffect(() => {
    if (profileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [profileOpen]);
  const isTablet = viewportW <= 1024;
  const isMobile = viewportW <= 768;

  const params = new URLSearchParams(window.location.search);
  const MUSEO  = params.get("museo");

  const toastRef = useRef();
  const showToast = (msg, type = "success") => toastRef.current?.show(msg, type);

  const [activeTab,    setActiveTab]    = useState("items");
  const [apiKeyActive, setApiKeyActive] = useState(false);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [allOggetti,   setAllOggetti]   = useState([]);
  const [percorsi,     setPercorsi]     = useState([]);
  const [percorsiLoaded, setPercorsiLoaded] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingVisits,setLoadingVisits]= useState(false);
  const [buyingPath, setBuyingPath] = useState(null);
  const [purchasedKeys, setPurchasedKeys] = useState(new Set());
  const [stanze,       setStanze]       = useState([]);
  const [search,       setSearch]       = useState("");
  const [stanzaFilter, setStanzaFilter] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedStanza, setAppliedStanza] = useState("");
  const [itemPage,     setItemPage]     = useState(1);
  const [visitPage,    setVisitPage]    = useState(1);
  const [teacherBuilderOpen, setTeacherBuilderOpen] = useState(false);
  const [teacherSelectedObjects, setTeacherSelectedObjects] = useState([]);
  const [teacherLevel, setTeacherLevel] = useState("studente");
  const [teacherDuration, setTeacherDuration] = useState("medio");
  const [teacherLink, setTeacherLink] = useState("");
  const [teacherOptimizedOrder, setTeacherOptimizedOrder] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function ensureAuth() {
      try {
        const res = await fetch("/api/users/me", { credentials: "include" });
        if (!res.ok) {
          window.location.replace("/");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          const user = data.user || null;
          setCurrentUser(user);
          setProfileForm({
            nome: user?.nome || "",
            cognome: user?.cognome || "",
            email: user?.email || "",
            eta: user?.eta ?? "",
            ruolo: user?.ruolo || "",
            livello: user?.livello || "",
            durata: user?.durata || "",
            interessi: user?.interessi || [],
          });
          setAuthChecked(true);
        }
      } catch {
        window.location.replace("/");
      }
    }
    ensureAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load museo ─────────────────────────────────────────────────────────────
  const loadMuseo = useCallback(async () => {
    if (!MUSEO) return;
    setLoadingItems(true);
    try {
      const data = await api(`/musei/${enc(MUSEO)}`);
      const oggetti = data.oggetti || [];
      setAllOggetti(oggetti);
      setStanze([...new Set(oggetti.map((o) => o.stanza).filter(Boolean))]);
    } catch (e) {
      showToast("Errore caricamento museo: " + e.message, "error");
    } finally {
      setLoadingItems(false);
    }
  }, [MUSEO]);

  const loadPercorsi = useCallback(async () => {
    if (!MUSEO) return;
    setLoadingVisits(true);
    try {
      const data = await api(`/musei/${enc(MUSEO)}/percorsi`);
      setPercorsi(data.percorsi || []);
      setPercorsiLoaded(true);
    } catch (e) {
      showToast("Errore caricamento percorsi: " + e.message, "error");
    } finally {
      setLoadingVisits(false);
    }
  }, [MUSEO]);

  const loadPurchasedPaths = useCallback(async () => {
    if (!MUSEO) return;
    try {
      const data = await api(`/users/me/percorsi?museo=${enc(MUSEO)}`, { credentials: "include" });
      const keys = Array.isArray(data.chiaviAcquisto) ? data.chiaviAcquisto : [];
      setPurchasedKeys(new Set(keys));
    } catch (e) {
      setPurchasedKeys(new Set());
      showToast("Errore caricamento acquisti: " + e.message, "error");
    }
  }, [MUSEO]);

  useEffect(() => { loadMuseo(); }, [loadMuseo]);
  useEffect(() => { if (authChecked) loadPurchasedPaths(); }, [authChecked, loadPurchasedPaths]);

  // ── Filtered items ─────────────────────────────────────────────────────────
  const filtered = allOggetti.filter((o) => {
    if (appliedSearch && !o.nome.toLowerCase().includes(appliedSearch.toLowerCase())) return false;
    if (appliedStanza && o.stanza !== appliedStanza) return false;
    return true;
  });
  const pagedItems = filtered.slice((itemPage - 1) * PAGE_SIZE, itemPage * PAGE_SIZE);
  const pagedVisits = percorsi.slice((visitPage - 1) * PAGE_SIZE, visitPage * PAGE_SIZE);

  // ── Navigation switching ───────────────────────────────────────────────────
  const currentSection = activeTab === "visits" ? "visits" : "items";
  const switchSection = (section) => {
    if (section === "visits" && !percorsiLoaded) loadPercorsi();
    setActiveTab(section);
  };

  // ── Auth ───────────────────────────────────────────────────────────────────
  const handleApiKey = (key) => {
    setApiKey(key);
    setApiKeyActive(true);
    setModalOpen(false);
    showToast("API Key impostata — ricarico dati");
    loadMuseo();
  };
  const handleLogout = () => {
    clearApiKey();
    setApiKeyActive(false);
    showToast("API Key rimossa");
  };

  const PROFILE_INTERESTS = [
    ["storia", "Storia"],
    ["storia_arte", "Storia dell'arte"],
    ["vita_artista", "Vita artista"],
    ["tecniche_materiali", "Tecniche e materiali"],
    ["estetica", "Estetica"],
    ["sensorialita", "Sensorialita"],
    ["filosofia_significato", "Filosofia e significato"],
    ["moda_costumi", "Moda e costumi"],
  ];
  const isProfessor = String(currentUser?.ruolo || "").toLowerCase() === "professore";

  const toggleInterest = (value) => {
    setProfileForm((prev) => ({
      ...prev,
      interessi: prev.interessi.includes(value)
        ? prev.interessi.filter((item) => item !== value)
        : [...prev.interessi, value],
    }));
  };

  const openProfile = () => setProfileOpen(true);
  const closeProfile = () => setProfileOpen(false);
  const closeItemModal = () => {
    setSelectedItem(null);
    setSelectedItemImages([]);
    setShowAllDescriptions(false);
    setSelectedGalleryIndex(0);
  };
  const closePathModal = () => setSelectedPath(null);
  const closeTeacherBuilder = () => {
    setTeacherBuilderOpen(false);
    setTeacherLink("");
    setTeacherOptimizedOrder([]);
  };
  const toggleTeacherObject = (name) => {
    setTeacherSelectedObjects((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  };
  const generateTeacherLink = () => {
    if (!MUSEO || teacherSelectedObjects.length < 1) {
      showToast("Seleziona almeno un oggetto", "error");
      return;
    }
    const optimizedObjects = optimizeObjectsOrderByPath(teacherSelectedObjects, allOggetti);
    const token = encodeSharePayload({
      museo: MUSEO,
      oggetti: optimizedObjects,
      livello: teacherLevel,
      durata: teacherDuration,
    });
    const link = `${window.location.origin}/?share=${token}`;
    setTeacherLink(link);
    setTeacherOptimizedOrder(optimizedObjects);
    showToast(`Ordine ottimizzato: ${optimizedObjects.join(" -> ")}`);
  };
  const copyTeacherLink = async () => {
    if (!teacherLink) return;
    try {
      await navigator.clipboard.writeText(teacherLink);
      showToast("Link copiato");
    } catch {
      showToast("Copia non riuscita", "error");
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (profileForm.interessi.length < 1) {
      showToast("Seleziona almeno un interesse", "error");
      return;
    }
    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: profileForm.nome.trim(),
          cognome: profileForm.cognome.trim(),
          eta: Number(profileForm.eta),
          livello: profileForm.livello,
          durata: profileForm.durata,
          interessi: profileForm.interessi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Aggiornamento profilo fallito", "error");
        return;
      }
      const user = data.user || null;
      setCurrentUser(user);
      setProfileForm({
        nome: user?.nome || "",
        cognome: user?.cognome || "",
        email: user?.email || "",
        eta: user?.eta ?? "",
        ruolo: user?.ruolo || "",
        livello: user?.livello || "",
        durata: user?.durata || "",
        interessi: user?.interessi || [],
      });
      showToast("Profilo aggiornato");
      setProfileOpen(false);
    } catch {
      showToast("Impossibile aggiornare il profilo", "error");
    }
  };

  const openItemDetails = async (oggetto) => {
    setSelectedItem(oggetto);
    setSelectedItemImages([]);
    setShowAllDescriptions(false);
    setSelectedGalleryIndex(0);
    try {
      const data = await api(`/musei/${enc(MUSEO)}/oggetti/${enc(oggetto.nome)}/immagini`);
      setSelectedItemImages(data.immagini || []);
    } catch {
      setSelectedItemImages([]);
    }
  };

  const openPathDetails = (percorso) => {
    if (!canAccessPath(percorso)) {
      showToast("Acquista il percorso per visualizzarlo", "error");
      return;
    }
    setSelectedPath(percorso);
  };

  const makePurchaseKey = (percorso) => `${MUSEO}::${percorso.nome}`;
  const canAccessPath = (percorso) => Number(percorso?.prezzo || 0) <= 0 || purchasedKeys.has(makePurchaseKey(percorso));

  const buyPath = async (percorso) => {
    if (!percorso?.nome) return;
    if (canAccessPath(percorso)) {
      showToast("Percorso gia disponibile");
      return;
    }
    setBuyingPath(percorso.nome);
    try {
      await api("/users/me/percorsi/acquista", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ museo: MUSEO, percorso: percorso.nome }),
      });
      setPurchasedKeys((prev) => new Set([...prev, makePurchaseKey(percorso)]));
      showToast(`Percorso "${percorso.nome}" acquistato`);
    } catch (e) {
      showToast("Errore acquisto percorso: " + e.message, "error");
    } finally {
      setBuyingPath(null);
    }
  };

  const getPreferredDescription = (oggetto) => {
    const descrizioni = Array.isArray(oggetto?.descrizioni) ? oggetto.descrizioni : [];
    if (descrizioni.length === 0) return null;

    const preferredLevelIndex = LEVEL_KEY_TO_INDEX[currentUser?.livello] ?? 1;
    const preferredDurationIndex = DURATION_KEY_TO_INDEX[currentUser?.durata] ?? 1;

    const levelIndex = descrizioni[preferredLevelIndex]
      ? preferredLevelIndex
      : Math.min(preferredLevelIndex, descrizioni.length - 1);
    const durationGroup = Array.isArray(descrizioni[levelIndex]) ? descrizioni[levelIndex] : [];
    const durationIndex = durationGroup[preferredDurationIndex]
      ? preferredDurationIndex
      : Math.min(preferredDurationIndex, Math.max(durationGroup.length - 1, 0));

    return {
      levelLabel: DESCRIPTION_LEVELS[levelIndex] || `Livello ${levelIndex + 1}`,
      durationLabel: DESCRIPTION_LENGTHS[durationIndex] || `Variante ${durationIndex + 1}`,
      text: durationGroup[durationIndex] || null,
    };
  };

  // ── No museo ───────────────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontFamily: "var(--font-head)", letterSpacing: "0.08em" }}>
        Verifica accesso...
      </div>
    );
  }

  if (!MUSEO) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
        <p style={{ fontFamily: "var(--font-head)", fontSize: 14, letterSpacing: "0.1em", color: "var(--text-dim)" }}>Nessun museo specificato. Torna alla home.</p>
        <a href="/" style={{ padding: "10px 22px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textDecoration: "none" }}>← Torna alla home</a>
      </div>
    );
  }

  return (
    <>
      <ArcDeco />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1440, margin: "0 auto", padding: isMobile ? "0 12px 56px" : isTablet ? "0 22px 70px" : "0 40px 80px" }}>

        {/* ── Header ── */}
        <header style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr", alignItems: "center", padding: isMobile ? "18px 0 22px" : "26px 0 30px", borderBottom: "1px solid var(--border)", marginBottom: isMobile ? 26 : 44, gap: isMobile ? 14 : 24 }}>
          {/* Left */}
          <div style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 14 : 18, letterSpacing: isMobile ? "0.12em" : "0.18em", color: "var(--text)", display: "flex", alignItems: "center", gap: 12, justifyContent: isMobile ? "center" : "flex-start", textAlign: isMobile ? "center" : "left", flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: 34, height: 34, display: "grid", placeItems: "center" }}>
              <img
                src="/img/logo.jpg"
                alt="ArtAround logo"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
            <span style={{ color: "var(--gold)", fontWeight: 600, letterSpacing: "0.18em" }}>MARKETPLACE</span>
          </div>

          {/* Center */}
          <div style={{ textAlign: "center", gridColumn: isMobile ? "1 / -1" : undefined, order: isMobile ? -1 : 0 }}>
            <p style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 8 : 9, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 5 }}>Museo selezionato</p>
            <p style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 14 : 17, fontWeight: 400, letterSpacing: isMobile ? "0.06em" : "0.1em", color: "var(--text)", overflowWrap: "anywhere" }}>{MUSEO}</p>
          </div>

          {/* Right */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: isMobile ? "center" : "flex-end", flexWrap: "wrap" }}>
            <button onClick={openProfile} style={{ padding: isMobile ? "9px 14px" : "10px 22px", background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textDecoration: "none", textTransform: "uppercase", cursor: "pointer" }}>
              Profilo
            </button>
            <a href="/" style={{ padding: isMobile ? "9px 14px" : "10px 22px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textDecoration: "none" }}>← Home</a>
            {apiKeyActive && (
              <>
                <span style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--text-dim)" }}>🔑 Key attiva</span>
                <button onClick={handleLogout} style={{ padding: isMobile ? "9px 14px" : "10px 22px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>Rimuovi Key</button>
              </>
            )}
          </div>
        </header>

        {/* ── Navigation ── */}
        <nav style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", gap: 12, marginBottom: isMobile ? 22 : 32 }}>
          <div style={{ display: "flex", gap: 2, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 4, width: isMobile ? "100%" : "auto" }}>
            {[
              { id: "items", label: "Oggetti" },
              { id: "visits", label: "Percorsi" },
            ].map((t) => (
              <button key={t.id} onClick={() => switchSection(t.id)} style={{
                padding: isMobile ? "11px 12px" : "12px 18px",
                background: currentSection === t.id ? "var(--gold)" : "transparent",
                border: "none", borderRadius: 5, cursor: "pointer",
                fontFamily: "var(--font-head)", fontSize: 10, fontWeight: 500,
                letterSpacing: "0.13em", textTransform: "uppercase",
                color: currentSection === t.id ? "#0d0d0d" : "var(--text-dim)",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
                flex: isMobile ? 1 : undefined,
              }}>{t.label}</button>
            ))}
          </div>
          {activeTab === "visits" && isProfessor && (
            <button
              onClick={() => {
                setTeacherSelectedObjects([]);
                setTeacherLink("");
                setTeacherOptimizedOrder([]);
                setTeacherBuilderOpen(true);
              }}
              style={{ padding: "11px 16px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", width: isMobile ? "100%" : "auto" }}
            >
              Crea percorso classe
            </button>
          )}
        </nav>

        {/* ── Filters (only on items tab) ── */}
        {activeTab === "items" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search); setAppliedStanza(stanzaFilter); setItemPage(1); } }}
              placeholder="Cerca oggetti..."
              style={{ flex: 1, minWidth: isMobile ? "100%" : 200, width: isMobile ? "100%" : undefined, padding: "11px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 13, outline: "none" }}
            />
            <select value={stanzaFilter} onChange={(e) => setStanzaFilter(e.target.value)} style={{ padding: "11px 32px 11px 14px", width: isMobile ? "100%" : undefined, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 13, outline: "none", appearance: "none" }}>
              <option value="">Tutte le stanze</option>
              {stanze.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => { setAppliedSearch(search); setAppliedStanza(stanzaFilter); setItemPage(1); }} style={{ padding: "11px 22px", width: isMobile ? "100%" : "auto", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>Filtra</button>
          </div>
        )}

        {/* ── Tab: Oggetti ── */}
        {activeTab === "items" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))", gap: isMobile ? 14 : 20, marginBottom: 40 }}>
              {loadingItems
                ? <Skeleton />
                : pagedItems.length === 0
                  ? <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 20px", color: "var(--text-faint)" }}><p style={{ fontFamily: "var(--font-head)", fontSize: 13, letterSpacing: "0.1em" }}>Nessun oggetto trovato</p></div>
                  : pagedItems.map((o, i) => (
                    <ItemCard key={o.nome} oggetto={o} museo={MUSEO} onView={openItemDetails} delay={i * 0.05} />
                  ))
              }
            </div>
            <Pagination total={filtered.length} current={itemPage} onChange={setItemPage} />
          </>
        )}

        {/* ── Tab: Percorsi ── */}
        {activeTab === "visits" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))", gap: isMobile ? 14 : 20, marginBottom: 40 }}>
              {loadingVisits
                ? <Skeleton />
                : pagedVisits.length === 0
                  ? <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 20px", color: "var(--text-faint)" }}><p style={{ fontFamily: "var(--font-head)", fontSize: 13, letterSpacing: "0.1em" }}>Nessun percorso creato</p></div>
                  : pagedVisits.map((p, i) => (
                    <VisitCard
                      key={p.nome}
                      percorso={p}
                      canView={canAccessPath(p)}
                      onView={openPathDetails}
                      onBuy={buyPath}
                      buying={buyingPath === p.nome}
                      delay={i * 0.06}
                    />
                  ))
              }
            </div>
            <Pagination total={percorsi.length} current={visitPage} onChange={setVisitPage} />
          </>
        )}

      </div>

      {profileOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeProfile(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(10,9,7,.92)", backdropFilter: "blur(12px)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: isMobile ? "min(620px, 100%)" : "min(620px, 90vw)", maxHeight: isMobile ? "calc(100vh - 32px)" : "90vh", overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", padding: isMobile ? "18px 14px" : "28px", position: "relative", borderRadius: isMobile ? 18 : 12 }}>
            <button onClick={closeProfile} style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
            <p style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 6, fontFamily: "var(--font-head)" }}>Account</p>
            <h3 style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 22 : 28, fontWeight: 400, marginBottom: 18 }}>Profilo</h3>
            <form onSubmit={saveProfile} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <input value={profileForm.nome} onChange={(e) => setProfileForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Nome" style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <input value={profileForm.cognome} onChange={(e) => setProfileForm((p) => ({ ...p, cognome: e.target.value }))} placeholder="Cognome" style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <input value={profileForm.email} disabled placeholder="Email" style={{ padding: "12px 14px", background: "#111", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-dim)" }} />
                <input value={profileForm.eta} onChange={(e) => setProfileForm((p) => ({ ...p, eta: e.target.value }))} type="number" min="1" max="120" placeholder="Eta" style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
                <input value={profileForm.ruolo} disabled placeholder="Ruolo" style={{ padding: "12px 14px", background: "#111", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-dim)" }} />
                <select value={profileForm.livello} onChange={(e) => setProfileForm((p) => ({ ...p, livello: e.target.value }))} style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}>
                  <option value="">Livello</option>
                  <option value="bambino">Bambino</option>
                  <option value="studente">Studente</option>
                  <option value="esperto">Esperto</option>
                  <option value="avanzato">Avanzato</option>
                </select>
                <select value={profileForm.durata} onChange={(e) => setProfileForm((p) => ({ ...p, durata: e.target.value }))} style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}>
                  <option value="">Durata spiegazioni</option>
                  <option value="corto">Corto</option>
                  <option value="medio">Medio</option>
                  <option value="lungo">Lungo</option>
                </select>
              </div>
              <div>
                <p style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 10, fontFamily: "var(--font-head)" }}>Interessi</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: isMobile ? "center" : "flex-start" }}>
                  {PROFILE_INTERESTS.map(([value, label]) => {
                    const active = profileForm.interessi.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleInterest(value)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: `1px solid ${active ? "var(--gold)" : "var(--border)"}`,
                          background: active ? "var(--gold-dim)" : "transparent",
                          color: active ? "var(--gold)" : "var(--text-dim)",
                          cursor: "pointer",
                          fontSize: 11,
                          letterSpacing: "0.05em",
                          maxWidth: "100%",
                          textAlign: "center",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }}>
                <button type="button" onClick={closeProfile} style={{ padding: "11px 16px", width: isMobile ? "100%" : "auto", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>Chiudi</button>
                <button type="submit" style={{ padding: "11px 16px", width: isMobile ? "100%" : "auto", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>Salva profilo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedItem && (
        <div onClick={(e) => { if (e.target === e.currentTarget) closeItemModal(); }} style={{ position: "fixed", inset: 0, background: "rgba(10,9,7,.92)", backdropFilter: "blur(12px)", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: isMobile ? "min(760px, 100%)" : "min(980px, 96vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", padding: isMobile ? "18px 14px" : "28px", position: "relative", borderRadius: 18 }}>
            <button onClick={closeItemModal} style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 22 }}>×</button>
            <p style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 6, fontFamily: "var(--font-head)" }}>Oggetto</p>
            <h3 style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 22 : 28, fontWeight: 400, marginBottom: 18 }}>{selectedItem.nome}</h3>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  <p style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 8, fontFamily: "var(--font-head)" }}>Dettagli</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(180px, 1fr) minmax(0, 2fr)", gap: 12 }}>
                    <p style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.7 }}><strong style={{ color: "var(--text)" }}>Stanza:</strong> {selectedItem.stanza || "N/D"}</p>
                    <p style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.7, overflowWrap: "anywhere" }}><strong style={{ color: "var(--text)" }}>Connessi:</strong> {(selectedItem.connessi || []).join(", ") || "Nessuno"}</p>
                  </div>
                </div>
                <div style={{ padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  <p style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 8, fontFamily: "var(--font-head)" }}>Descrizioni</p>
                  {(() => {
                    const preferred = getPreferredDescription(selectedItem);
                    return (
                      <>
                        {preferred?.text ? (
                          <div style={{ display: "grid", gap: 10 }}>
                            <p style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.7 }}>{preferred.text}</p>
                          </div>
                        ) : (
                          <p style={{ color: "var(--text-dim)", fontSize: 14 }}>Nessuna descrizione disponibile.</p>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowAllDescriptions((prev) => !prev)}
                          style={{
                            marginTop: 12,
                            padding: "8px 12px",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            cursor: "pointer",
                            fontFamily: "var(--font-head)",
                            fontSize: 10,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "var(--gold)",
                          }}
                        >
                          {showAllDescriptions ? "Nascondi tutte" : "Vedi tutte"}
                        </button>

                        {showAllDescriptions && (
                          <div style={{ marginTop: 12 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--gold)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-head)" }}>Livello \\ Lunghezza</th>
                                  {DESCRIPTION_LENGTHS.map((len) => (
                                    <th key={len} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--gold)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-head)", whiteSpace: isMobile ? "normal" : "nowrap" }}>
                                      {len}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {DESCRIPTION_LEVELS.map((lvlLabel, lvlIndex) => {
                                  const group = Array.isArray(selectedItem.descrizioni?.[lvlIndex]) ? selectedItem.descrizioni[lvlIndex] : [];
                                  return (
                                    <tr key={lvlLabel}>
                                      <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "var(--text)", fontSize: 13, verticalAlign: "top", whiteSpace: isMobile ? "normal" : "nowrap", overflowWrap: "anywhere" }}>
                                        {lvlLabel}
                                      </td>
                                      {DESCRIPTION_LENGTHS.map((lenLabel, lenIndex) => (
                                        <td key={`${lvlLabel}-${lenLabel}`} style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "var(--text-dim)", fontSize: isMobile ? 12 : 14, lineHeight: 1.55, verticalAlign: "top", overflowWrap: "anywhere" }}>
                                          {group?.[lenIndex] || "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {(() => {
                const galleryImages = selectedItemImages.filter((img) => img.tipo !== "preview");
                const safeIndex = Math.min(selectedGalleryIndex, Math.max(galleryImages.length - 1, 0));
                const activeImage = galleryImages[safeIndex] || null;
                return (
                  <div style={{ padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
                    <p style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 8, fontFamily: "var(--font-head)" }}>Galleria immagini</p>
                    {galleryImages.length === 0 ? (
                      <p style={{ color: "var(--text-dim)", fontSize: 14 }}>Nessuna immagine extra disponibile.</p>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        <img
                          src={activeImage.url.startsWith("/api") ? activeImage.url : `/api${activeImage.url}`}
                          alt={`${selectedItem.nome} ${activeImage.tipo}`}
                          style={{ width: "100%", height: isMobile ? 220 : 260, objectFit: "cover", borderRadius: 12, background: "#111" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedGalleryIndex((prev) => (prev === 0 ? galleryImages.length - 1 : prev - 1))}
                            style={{ padding: "8px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", cursor: "pointer" }}
                          >
                            ‹
                          </button>
                          <div style={{ display: "flex", gap: 8, overflowX: "auto", flex: 1, paddingBottom: 2 }}>
                            {galleryImages.map((img, index) => (
                              <button
                                key={img.tipo}
                                type="button"
                                onClick={() => setSelectedGalleryIndex(index)}
                                style={{
                                  border: index === safeIndex ? "1px solid var(--gold)" : "1px solid var(--border)",
                                  padding: 0,
                                  borderRadius: 12,
                                  overflow: "hidden",
                                  background: "transparent",
                                  cursor: "pointer",
                                  minWidth: isMobile ? 84 : 72,
                                }}
                              >
                                <img
                                  src={img.url.startsWith("/api") ? img.url : `/api${img.url}`}
                                  alt={`${selectedItem.nome} thumb ${img.tipo}`}
                                  style={{ width: isMobile ? 84 : 72, height: isMobile ? 60 : 52, objectFit: "cover", display: "block" }}
                                />
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedGalleryIndex((prev) => (prev === galleryImages.length - 1 ? 0 : prev + 1))}
                            style={{ padding: "8px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", cursor: "pointer" }}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {selectedPath && (
        <div onClick={(e) => { if (e.target === e.currentTarget) closePathModal(); }} style={{ position: "fixed", inset: 0, background: "rgba(10,9,7,.92)", backdropFilter: "blur(12px)", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: isMobile ? "min(720px, 100%)" : "min(900px, 92vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", padding: isMobile ? "18px 14px" : "28px", position: "relative", borderRadius: 18 }}>
            <button onClick={closePathModal} style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 22 }}>×</button>
            <p style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 6, fontFamily: "var(--font-head)" }}>Percorso</p>
            <h3 style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 22 : 28, fontWeight: 400, marginBottom: 18 }}>{selectedPath.nome}</h3>
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 16 }}>Prezzo: <span style={{ color: "var(--gold)", fontFamily: "var(--font-head)" }}>{formatPrezzo(selectedPath.prezzo)}</span></p>
            <div style={{ padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
              <p style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 10, fontFamily: "var(--font-head)" }}>Opere del percorso in ordine</p>
              <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}>
                {(selectedPath.oggetti || []).map((name) => {
                  const oggetto = allOggetti.find((item) => item.nome === name);
                  return (
                    <li key={name} style={{ color: "var(--text)", lineHeight: 1.6 }}>
                      <span style={{ fontFamily: "var(--font-head)", letterSpacing: "0.06em" }}>{name}</span>
                      {oggetto?.stanza ? (
                        <span style={{ color: "var(--text-dim)" }}>{` — stanza ${oggetto.stanza}`}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      )}

      {teacherBuilderOpen && (
        <div onClick={(e) => { if (e.target === e.currentTarget) closeTeacherBuilder(); }} style={{ position: "fixed", inset: 0, background: "rgba(10,9,7,.92)", backdropFilter: "blur(12px)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: isMobile ? "min(760px, 100%)" : "min(860px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", padding: isMobile ? "18px 14px" : "28px", position: "relative", borderRadius: 18 }}>
            <button onClick={closeTeacherBuilder} style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 22 }}>×</button>
            <p style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 6, fontFamily: "var(--font-head)" }}>Professore</p>
            <h3 style={{ fontFamily: "var(--font-head)", fontSize: isMobile ? 22 : 28, fontWeight: 400, marginBottom: 16 }}>Percorso personalizzato classe</h3>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <select value={teacherLevel} onChange={(e) => setTeacherLevel(e.target.value)} style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}>
                <option value="bambino">Bambino</option>
                <option value="studente">Studente</option>
                <option value="esperto">Esperto</option>
                <option value="avanzato">Avanzato</option>
              </select>
              <select value={teacherDuration} onChange={(e) => setTeacherDuration(e.target.value)} style={{ padding: "12px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}>
                <option value="corto">Corto</option>
                <option value="medio">Medio</option>
                <option value="lungo">Lungo</option>
              </select>
            </div>

            <p style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dim)", marginBottom: 10 }}>
              Seleziona gli oggetti del percorso (ordine libero): {teacherSelectedObjects.length} selezionati.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))", gap: 8, marginBottom: 14 }}>
              {allOggetti.map((obj) => {
                const checked = teacherSelectedObjects.includes(obj.nome);
                return (
                  <button
                    type="button"
                    key={obj.nome}
                    onClick={() => toggleTeacherObject(obj.nome)}
                    style={{ textAlign: "left", padding: "10px 12px", border: `1px solid ${checked ? "var(--gold)" : "var(--border)"}`, background: checked ? "var(--gold-dim)" : "var(--bg-card)", color: checked ? "var(--gold)" : "var(--text-dim)", borderRadius: 8, cursor: "pointer" }}
                  >
                    {obj.nome}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, flexDirection: isMobile ? "column" : "row", marginBottom: 12 }}>
              <button type="button" onClick={generateTeacherLink} style={{ padding: "11px 16px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>
                Genera link
              </button>
              {teacherLink && (
                <button type="button" onClick={copyTeacherLink} style={{ padding: "11px 16px", background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>
                  Copia link
                </button>
              )}
            </div>

            {teacherOptimizedOrder.length > 0 && (
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
                Ordine finale percorso: <span style={{ color: "var(--gold)" }}>{teacherOptimizedOrder.join(" -> ")}</span>
              </p>
            )}

            {teacherLink && (
              <input readOnly value={teacherLink} style={{ width: "100%", padding: "10px 12px", background: "#111", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-dim)" }} />
            )}
          </div>
        </div>
      )}

      <ApiKeyModal open={modalOpen} onClose={() => setModalOpen(false)} onConfirm={handleApiKey} />
      <Toast ref={toastRef} />
    </>
  );
}