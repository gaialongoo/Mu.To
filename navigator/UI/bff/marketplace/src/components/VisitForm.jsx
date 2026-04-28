import React, { useState } from "react";
import { api, enc } from "../api";
import { inputStyle } from "./ItemForm";

export default function VisitForm({ museo, allOggetti, onSaved, onCancel, toast }) {
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isMobile = viewportW <= 768;

  const [nome,          setNome]     = useState("");
  const [prezzo,        setPrezzo]   = useState("0");
  const [visitOggetti,  setVisit]    = useState([]);
  const [selected,      setSelected] = useState("");
  const [saving,        setSaving]   = useState(false);

  const addOggetto = () => {
    if (!selected || visitOggetti.includes(selected)) return;
    setVisit([...visitOggetti, selected]);
    setSelected("");
  };
  const removeOggetto = (i) => setVisit(visitOggetti.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!visitOggetti.length) { toast("Aggiungi almeno un oggetto", "error"); return; }
    setSaving(true);
    try {
      await api(`/musei/${enc(museo)}/percorsi`, {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), oggetti: visitOggetti, prezzo: Number(prezzo) || 0 }),
      });
      toast(`Percorso "${nome}" creato`);
      setNome(""); setPrezzo("0"); setVisit([]);
      onSaved();
    } catch (err) {
      toast("Errore: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: isMobile ? 16 : 46, maxWidth: 780, margin: isMobile ? "0 0 26px" : "0 auto 40px", position: "relative",
    }}>
      <div style={{ position: "absolute", top: 0, left: 48, right: 48, height: 1, background: "linear-gradient(90deg, transparent, var(--gold), transparent)", opacity: 0.45 }} />
      <h3 style={{ fontFamily: "var(--font-head)", fontSize: 19, fontWeight: 400, letterSpacing: "0.12em", color: "var(--text)", marginBottom: 34 }}>
        <small style={{ display: "block", fontSize: 9, letterSpacing: "0.3em", color: "var(--gold)", marginBottom: 8 }}>Gestione Percorsi</small>
        Crea Percorso Statico
      </h3>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Nome del Percorso</label>
          <input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Es: Rinascimento Fiorentino" />
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Prezzo (EUR)</label>
          <input
            style={inputStyle}
            value={prezzo}
            onChange={(e) => setPrezzo(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="0.00"
          />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Oggetti in ordine di visita</label>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {/* List */}
            <div style={{
              minHeight: 70, padding: 12,
              background: "var(--bg-panel)",
              display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start",
            }}>
              {visitOggetti.length === 0
                ? <span style={{ width: "100%", textAlign: "center", fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.06em", padding: "16px 0" }}>Nessun oggetto aggiunto</span>
                : visitOggetti.map((n, i) => (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--gold-dim)", color: "var(--gold)",
                    border: "1px solid rgba(92,191,128,0.2)",
                    padding: "5px 10px", borderRadius: 2,
                    fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.1em",
                  }}>
                    <span style={{ color: "var(--text-faint)", fontSize: 9 }}>{i + 1}.</span>
                    {n}
                    <button type="button" onClick={() => removeOggetto(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gold)", fontSize: 14 }}>×</button>
                  </span>
                ))
              }
            </div>
            {/* Footer */}
            <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: isMobile ? "column" : "row", gap: 8, alignItems: "center", background: "var(--bg-card)" }}>
              <select
                style={{ ...inputStyle, flex: 1, width: "100%", padding: "8px 12px", fontSize: 12 }}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">— Seleziona oggetto —</option>
                {allOggetti.map((o) => <option key={o.nome} value={o.nome}>{o.nome}</option>)}
              </select>
              <button type="button" onClick={addOggetto} style={{
                padding: "8px 16px",
                width: isMobile ? "100%" : "auto",
                background: "var(--gold-dim)", color: "var(--gold)",
                border: "1px solid rgba(92,191,128,0.3)", borderRadius: "var(--radius)",
                cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
              }}>Aggiungi</button>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, letterSpacing: "0.04em" }}>Tutti gli oggetti devono esistere nel museo · nessun duplicato</p>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexDirection: isMobile ? "column" : "row", marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--border)" }}>
          <button type="button" onClick={onCancel} style={{ padding: "10px 22px", width: isMobile ? "100%" : "auto", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>Annulla</button>
          <button type="submit" disabled={saving} style={{ padding: "10px 22px", width: isMobile ? "100%" : "auto", background: "var(--gold)", color: "#0d0d0d", border: "none", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase" }}>{saving ? "Salvataggio..." : "Salva Percorso"}</button>
        </div>
      </form>
    </div>
  );
}

const labelStyle = {
  display: "block", fontFamily: "var(--font-head)", fontSize: 10,
  letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 9,
};