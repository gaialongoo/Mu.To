import React, { useState, useEffect, useRef, useCallback } from "react";
import { api, enc, setApiKey, clearApiKey } from "./api";
import Toast from "./components/Toast";
import ApiKeyModal from "./components/ApiKeyModal";
import ItemCard from "./components/ItemCard";
import ItemForm from "./components/ItemForm";
import VisitForm from "./components/VisitForm";

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

// ─── Visit card ──────────────────────────────────────────────────────────────
function VisitCard({ percorso, onDelete, delay }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", overflow: "hidden",
      animation: `fadeUp 0.4s ease ${delay}s backwards`,
    }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div style={{ height: 155, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, background: "linear-gradient(135deg, #1a1a1a, #202020)" }}>🗺️</div>
      <div style={{ padding: "20px 22px 14px" }}>
        <div style={{ fontFamily: "var(--font-head)", fontSize: 14, fontWeight: 500, letterSpacing: "0.07em", color: "var(--text)", marginBottom: 10 }}>{percorso.nome}</div>
        <div style={{ fontSize: 11, letterSpacing: "0.05em", color: "var(--text-dim)", marginBottom: 14 }}>{(percorso.oggetti || []).length} opere</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(percorso.oggetti || []).slice(0, 3).map((n) => (
            <span key={n} style={{ background: "var(--gold-dim)", color: "var(--gold)", border: "1px solid rgba(92,191,128,0.18)", padding: "3px 9px", borderRadius: 2, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "var(--font-head)" }}>{n}</span>
          ))}
          {percorso.oggetti?.length > 3 && <span style={{ background: "var(--gold-dim)", color: "var(--gold)", border: "1px solid rgba(92,191,128,0.18)", padding: "3px 9px", borderRadius: 2, fontSize: 9, letterSpacing: "0.14em", fontFamily: "var(--font-head)" }}>+{percorso.oggetti.length - 3}</span>}
        </div>
      </div>
      <div style={{ padding: "10px 22px 18px" }}>
        <DangerBtn onClick={() => onDelete(percorso.nome)}>Elimina</DangerBtn>
      </div>
    </div>
  );
}

function DangerBtn({ onClick, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{
      width: "100%", padding: "8px 10px", background: "transparent",
      border: `1px solid ${h ? "rgba(200,70,60,0.4)" : "var(--border)"}`,
      borderRadius: "var(--radius)", cursor: "pointer",
      fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.12em",
      textTransform: "uppercase", color: h ? "#e05a4a" : "var(--text-dim)",
      transition: "all 0.2s",
    }}>{children}</button>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
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
  const [editingObj,   setEditingObj]   = useState(null); // oggetto in modifica
  const [stanze,       setStanze]       = useState([]);
  const [search,       setSearch]       = useState("");
  const [stanzaFilter, setStanzaFilter] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedStanza, setAppliedStanza] = useState("");
  const [itemPage,     setItemPage]     = useState(1);
  const [visitPage,    setVisitPage]    = useState(1);

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

  useEffect(() => { loadMuseo(); }, [loadMuseo]);

  // ── Filtered items ─────────────────────────────────────────────────────────
  const filtered = allOggetti.filter((o) => {
    if (appliedSearch && !o.nome.toLowerCase().includes(appliedSearch.toLowerCase())) return false;
    if (appliedStanza && o.stanza !== appliedStanza) return false;
    return true;
  });
  const pagedItems = filtered.slice((itemPage - 1) * PAGE_SIZE, itemPage * PAGE_SIZE);
  const pagedVisits = percorsi.slice((visitPage - 1) * PAGE_SIZE, visitPage * PAGE_SIZE);

  // ── Tab switching ──────────────────────────────────────────────────────────
  const switchTab = (tab) => {
    setActiveTab(tab);
    if (tab === "visits" && !percorsiLoaded) loadPercorsi();
    if (tab === "create-item") setEditingObj(null);
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

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const handleDeleteOggetto = async (nome) => {
    if (!confirm(`Eliminare "${nome}"?`)) return;
    try {
      await api(`/musei/${enc(MUSEO)}/oggetti/${enc(nome)}`, { method: "DELETE" });
      showToast(`"${nome}" eliminato`);
      await loadMuseo();
    } catch (e) { showToast("Errore: " + e.message, "error"); }
  };

  const handleEditOggetto = (nome) => {
    const o = allOggetti.find((x) => x.nome === nome);
    if (!o) return;
    setEditingObj(o);
    setActiveTab("create-item");
  };

  const handleDeletePercorso = async (nome) => {
    if (!confirm(`Eliminare il percorso "${nome}"?`)) return;
    try {
      await api(`/musei/${enc(MUSEO)}/percorsi/${enc(nome)}`, { method: "DELETE" });
      showToast(`Percorso "${nome}" eliminato`);
      await loadPercorsi();
    } catch (e) { showToast("Errore: " + e.message, "error"); }
  };

  // ── No museo ───────────────────────────────────────────────────────────────
  if (!MUSEO) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
        <p style={{ fontFamily: "var(--font-head)", fontSize: 14, letterSpacing: "0.1em", color: "var(--text-dim)" }}>Nessun museo specificato. Torna alla home.</p>
        <a href="/" style={{ padding: "10px 22px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textDecoration: "none" }}>← Torna alla home</a>
      </div>
    );
  }

  // ── Tabs config ────────────────────────────────────────────────────────────
  const TABS = [
    { id: "items",        label: "Oggetti" },
    { id: "visits",       label: "Percorsi" },
    { id: "create-item",  label: "+ Nuovo Oggetto" },
    { id: "create-visit", label: "+ Nuovo Percorso" },
  ];

  return (
    <>
      <ArcDeco />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1440, margin: "0 auto", padding: "0 40px 80px" }}>

        {/* ── Header ── */}
        <header style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", padding: "26px 0 30px", borderBottom: "1px solid var(--border)", marginBottom: 44, gap: 24 }}>
          {/* Left */}
          <div style={{ fontFamily: "var(--font-head)", fontSize: 18, letterSpacing: "0.18em", color: "var(--text)", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 26, height: 26, border: "1.5px solid var(--gold)", borderRadius: "50%", position: "relative" }} />
            MU.TO <span style={{ color: "var(--gold)" }}>MARKETPLACE</span>
          </div>

          {/* Center */}
          <div style={{ textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--gold)", marginBottom: 5 }}>Museo selezionato</p>
            <p style={{ fontFamily: "var(--font-head)", fontSize: 17, fontWeight: 400, letterSpacing: "0.1em", color: "var(--text)" }}>{MUSEO}</p>
          </div>

          {/* Right */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "flex-end" }}>
            <a href="/" style={{ padding: "10px 22px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textDecoration: "none" }}>← Home</a>
            {apiKeyActive && (
              <>
                <span style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--text-dim)" }}>🔑 Key attiva</span>
                <button onClick={handleLogout} style={{ padding: "10px 22px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>Rimuovi Key</button>
              </>
            )}
          </div>
        </header>

        {/* ── Tabs ── */}
        <nav style={{ display: "flex", gap: 2, marginBottom: 32, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 4 }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, padding: "12px 14px",
              background: activeTab === t.id ? "var(--gold)" : "transparent",
              border: "none", borderRadius: 5, cursor: "pointer",
              fontFamily: "var(--font-head)", fontSize: 10, fontWeight: 500,
              letterSpacing: "0.13em", textTransform: "uppercase",
              color: activeTab === t.id ? "#0d0d0d" : "var(--text-dim)",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </nav>

        {/* ── Filters (only on items tab) ── */}
        {activeTab === "items" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search); setAppliedStanza(stanzaFilter); setItemPage(1); } }}
              placeholder="Cerca oggetti..."
              style={{ flex: 1, minWidth: 200, padding: "11px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 13, outline: "none" }}
            />
            <select value={stanzaFilter} onChange={(e) => setStanzaFilter(e.target.value)} style={{ padding: "11px 32px 11px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 13, outline: "none", appearance: "none" }}>
              <option value="">Tutte le stanze</option>
              {stanze.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => { setAppliedSearch(search); setAppliedStanza(stanzaFilter); setItemPage(1); }} style={{ padding: "11px 22px", background: "transparent", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>Filtra</button>
          </div>
        )}

        {/* ── Tab: Oggetti ── */}
        {activeTab === "items" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20, marginBottom: 40 }}>
              {loadingItems
                ? <Skeleton />
                : pagedItems.length === 0
                  ? <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 20px", color: "var(--text-faint)" }}><p style={{ fontFamily: "var(--font-head)", fontSize: 13, letterSpacing: "0.1em" }}>Nessun oggetto trovato</p></div>
                  : pagedItems.map((o, i) => (
                    <ItemCard key={o.nome} oggetto={o} museo={MUSEO} onEdit={handleEditOggetto} onDelete={handleDeleteOggetto} delay={i * 0.05} />
                  ))
              }
            </div>
            <Pagination total={filtered.length} current={itemPage} onChange={setItemPage} />
          </>
        )}

        {/* ── Tab: Percorsi ── */}
        {activeTab === "visits" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20, marginBottom: 40 }}>
              {loadingVisits
                ? <Skeleton />
                : pagedVisits.length === 0
                  ? <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 20px", color: "var(--text-faint)" }}><p style={{ fontFamily: "var(--font-head)", fontSize: 13, letterSpacing: "0.1em" }}>Nessun percorso creato</p></div>
                  : pagedVisits.map((p, i) => (
                    <VisitCard key={p.nome} percorso={p} onDelete={handleDeletePercorso} delay={i * 0.06} />
                  ))
              }
            </div>
            <Pagination total={percorsi.length} current={visitPage} onChange={setVisitPage} />
          </>
        )}

        {/* ── Tab: Nuovo Oggetto ── */}
        {activeTab === "create-item" && (
          <ItemForm
            museo={MUSEO}
            oggetto={editingObj}
            toast={showToast}
            onSaved={async () => { await loadMuseo(); setActiveTab("items"); setEditingObj(null); }}
            onCancel={() => { setActiveTab("items"); setEditingObj(null); }}
          />
        )}

        {/* ── Tab: Nuovo Percorso ── */}
        {activeTab === "create-visit" && (
          <VisitForm
            museo={MUSEO}
            allOggetti={allOggetti}
            toast={showToast}
            onSaved={async () => { await loadPercorsi(); setActiveTab("visits"); }}
            onCancel={() => setActiveTab("visits")}
          />
        )}

      </div>

      <ApiKeyModal open={modalOpen} onClose={() => setModalOpen(false)} onConfirm={handleApiKey} />
      <Toast ref={toastRef} />
    </>
  );
}