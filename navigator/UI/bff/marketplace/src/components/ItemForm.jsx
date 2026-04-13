import React, { useState, useEffect } from "react";
import { api, enc } from "../api";

const LIVELLI = ["bambino", "studente", "avanzato", "esperto"];
const DURATE  = ["breve", "medio", "lungo"];

export default function ItemForm({ museo, oggetto, onSaved, onCancel, toast }) {
  const editing = !!oggetto;

  const [nome,      setNome]      = useState(oggetto?.nome      || "");
  const [stanza,    setStanza]    = useState(oggetto?.stanza    || "");
  const [connessi,  setConnessi]  = useState(oggetto?.connessi  || []);
  const [descrizioni, setDesc]    = useState(oggetto?.descrizioni || []);
  const [conInput,  setConInput]  = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (oggetto) {
      setNome(oggetto.nome || "");
      setStanza(oggetto.stanza || "");
      setConnessi(oggetto.connessi || []);
      setDesc(oggetto.descrizioni || []);
    }
  }, [oggetto]);

  const addConnesso = (e) => {
    if ((e.key === "Enter" || e.key === ",") && conInput.trim()) {
      e.preventDefault();
      if (!connessi.includes(conInput.trim())) setConnessi([...connessi, conInput.trim()]);
      setConInput("");
    }
  };
  const removeConnesso = (n) => setConnessi(connessi.filter((c) => c !== n));

  const updateOrAddDesc = (livello, durata, secs, text) => {
    const existing = descrizioni.findIndex((d) => d[0] === livello && d[1] === durata);
    if (existing !== -1) {
      const next = [...descrizioni];
      next[existing] = [livello, durata, secs, text];
      setDesc(next);
    } else if (secs || text) {
      setDesc([...descrizioni, [livello, durata, secs, text]]);
    }
  };

  const removeDesc = (livello, durata) => {
    setDesc(descrizioni.filter((d) => !(d[0] === livello && d[1] === durata)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = { nome: nome.trim(), connessi, descrizioni };
    if (stanza.trim()) body.stanza = stanza.trim();
    try {
      if (editing) {
        await api(`/musei/${enc(museo)}/oggetti/${enc(oggetto.nome)}`, { method: "PUT", body: JSON.stringify(body) });
        toast(`"${nome}" aggiornato`);
      } else {
        await api(`/musei/${enc(museo)}/oggetti`, { method: "POST", body: JSON.stringify(body) });
        toast(`"${nome}" creato`);
      }
      if (imageFile) {
        const fd = new FormData();
        fd.append("immagine", imageFile);
        await api(`/musei/${enc(museo)}/oggetti/${enc(nome.trim())}/immagini/preview`, {
          method: "POST", body: fd, isFormData: true,
        });
      }
      onSaved();
    } catch (err) {
      toast("Errore: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formContainerStyle}>
      <div style={topLineStyle} />
      <h3 style={h3Style}>
        <small style={smallStyle}>{editing ? "Modifica Oggetto" : "Gestione Oggetti"}</small>
        {editing ? oggetto.nome : "Aggiungi Oggetto"}
      </h3>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 22 }}>
          <FormGroup label="Nome">
            <input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Es: La Nascita di Venere" />
          </FormGroup>
          <FormGroup label="Stanza">
            <input style={inputStyle} value={stanza} onChange={(e) => setStanza(e.target.value)} placeholder="Es: Sala 10" />
          </FormGroup>
        </div>

        <FormGroup label={<>Oggetti connessi <span style={{ color: "var(--text-faint)", fontSize: 9 }}>(premi Invio)</span></>}>
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
            padding: "10px 12px", background: "var(--bg-panel)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)", minHeight: 48,
          }}>
            {connessi.map((n) => (
              <span key={n} style={tagStyle}>
                {n}
                <button type="button" onClick={() => removeConnesso(n)} style={tagBtnStyle}>×</button>
              </span>
            ))}
            <input
              style={{ ...inputStyle, flex: 1, minWidth: 120, border: "none", background: "transparent", padding: "4px 4px", fontSize: 13 }}
              value={conInput}
              onChange={(e) => setConInput(e.target.value)}
              onKeyDown={addConnesso}
              placeholder="Nome oggetto..."
            />
          </div>
        </FormGroup>

        <Divider label="Descrizioni" />
        <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "-10px 0 18px", letterSpacing: "0.04em" }}>
          Seleziona livello e durata, inserisci <Code>durata (s)</Code> e <Code>testo</Code>
        </p>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${DURATE.length + 1}, 1fr)`, gap: 12, marginBottom: 24 }}>
          {/* Header row */}
          <div />
          {DURATE.map((d) => (
            <div key={d} style={{
              fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.2em",
              textTransform: "uppercase", color: "var(--gold)",
              padding: "10px 8px", textAlign: "center",
              borderBottom: "1px solid var(--border)",
            }}>{d}</div>
          ))}
          
          {/* Body rows */}
          {LIVELLI.map((livello) => (
            <React.Fragment key={livello}>
              <div style={{
                fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.2em",
                textTransform: "uppercase", color: "var(--gold)",
                padding: "10px 8px", textAlign: "center",
                borderRight: "1px solid var(--border)",
              }}>{livello}</div>
              {DURATE.map((durata) => {
                const desc = descrizioni.find((d) => d[0] === livello && d[1] === durata);
                return (
                  <div key={`${livello}-${durata}`} style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: "10px 8px",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="number"
                        min="1"
                        placeholder="s"
                        value={desc?.[2] || ""}
                        onChange={(e) => updateOrAddDesc(livello, durata, e.target.value, desc?.[3] || "")}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          color: "var(--text)",
                          fontSize: 11,
                          outline: "none",
                        }}
                      />
                      {desc && (
                        <button
                          type="button"
                          onClick={() => removeDesc(livello, durata)}
                          style={{
                            padding: "4px 6px",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            cursor: "pointer",
                            color: "var(--text-faint)",
                            fontSize: 12,
                          }}
                        >×</button>
                      )}
                    </div>
                    <textarea
                      placeholder="Testo..."
                      value={desc?.[3] || ""}
                      onChange={(e) => updateOrAddDesc(livello, durata, desc?.[2] || "15", e.target.value)}
                      style={{
                        padding: "6px 8px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text)",
                        fontSize: 11,
                        minHeight: 60,
                        resize: "vertical",
                        outline: "none",
                        fontFamily: "var(--font-body)",
                      }}
                    />
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>

        <FormGroup label={<>Immagine preview <span style={{ color: "var(--text-faint)", fontSize: 9 }}>(opzionale)</span></>} style={{ marginTop: 22 }}>
          <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} style={{ ...inputStyle, cursor: "pointer", color: "var(--text-dim)" }} />
          <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, letterSpacing: "0.04em" }}>Caricata come tipo "preview" · max 10 MB</p>
        </FormGroup>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--border)" }}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>Annulla</button>
          <button type="submit" disabled={saving} style={saveBtnStyle}>{saving ? "Salvataggio..." : "Salva Oggetto"}</button>
        </div>
      </form>
    </div>
  );
}

// ─── Styled sub-components ───────────────────────────────────────────────────

function FormGroup({ label, children, style }) {
  return (
    <div style={{ marginBottom: 22, ...style }}>
      <label style={{ display: "block", fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 9 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "10px 0 26px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span style={{ fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.25em", color: "var(--text-faint)", textTransform: "uppercase" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function Code({ children }) {
  return <code style={{ background: "rgba(92,191,128,0.1)", color: "var(--gold)", padding: "1px 6px", borderRadius: 2, fontSize: 11, fontFamily: "monospace" }}>{children}</code>;
}

const formContainerStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 46,
  maxWidth: 780,
  margin: "0 auto 40px",
  position: "relative",
};
const topLineStyle = {
  position: "absolute", top: 0, left: 48, right: 48, height: 1,
  background: "linear-gradient(90deg, transparent, var(--gold), transparent)",
  opacity: 0.45,
};
const h3Style = { fontFamily: "var(--font-head)", fontSize: 19, fontWeight: 400, letterSpacing: "0.12em", color: "var(--text)", marginBottom: 34 };
const smallStyle = { display: "block", fontSize: 9, letterSpacing: "0.3em", color: "var(--gold)", marginBottom: 8 };
export const inputStyle = {
  width: "100%", padding: "13px 15px",
  background: "var(--bg-panel)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", color: "var(--text)",
  fontFamily: "var(--font-body)", fontSize: 14, letterSpacing: "0.04em",
  outline: "none", appearance: "none",
};
const tagStyle = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "var(--gold-dim)", color: "var(--gold)",
  border: "1px solid rgba(92,191,128,0.2)",
  padding: "3px 8px", borderRadius: 2,
  fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.1em",
};
const tagBtnStyle = { background: "none", border: "none", cursor: "pointer", color: "var(--gold)", fontSize: 13, lineHeight: 1, padding: 0 };
const saveBtnStyle = {
  padding: "10px 22px", background: "var(--gold)", color: "#0d0d0d",
  border: "none", borderRadius: "var(--radius)", cursor: "pointer",
  fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase",
};
const cancelBtnStyle = {
  padding: "10px 22px", background: "transparent", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer",
  fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase",
};