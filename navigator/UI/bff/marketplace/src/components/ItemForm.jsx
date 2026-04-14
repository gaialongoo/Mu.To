import React, { useState, useEffect } from "react";
import { api, enc } from "../api";

const LIVELLI = ["bambino", "studente", "avanzato", "esperto"];
const DURATE  = ["breve", "medio", "lungo"];
const EMPTY_DESCRIZIONI = Array.from({ length: LIVELLI.length }, () => Array(DURATE.length).fill(""));
const normalizeLabel = (v) => String(v || "").trim().toLowerCase();
const isValidImageTipo = (tipo) => tipo === "preview" || /^\d+$/.test(tipo);

function normalizeDescrizioni(raw) {
  if (!Array.isArray(raw)) return EMPTY_DESCRIZIONI.map((row) => [...row]);

  // Formato nuovo: matrice 4x3 [[...],[...],...]
  const looksMatrix = raw.every((row) => Array.isArray(row));
  if (looksMatrix) {
    const next = EMPTY_DESCRIZIONI.map((row) => [...row]);
    for (let i = 0; i < LIVELLI.length; i++) {
      for (let j = 0; j < DURATE.length; j++) {
        const value = raw?.[i]?.[j];
        next[i][j] = typeof value === "string" ? value : "";
      }
    }
    return next;
  }

  // Formato legacy marketplace: [livello, durata, secs, text]
  const legacy = EMPTY_DESCRIZIONI.map((row) => [...row]);
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const i = LIVELLI.indexOf(item[0]);
    const j = DURATE.indexOf(item[1]);
    if (i === -1 || j === -1) continue;
    legacy[i][j] = typeof item[3] === "string" ? item[3] : "";
  }
  return legacy;
}

export default function ItemForm({ museo, oggetto, onSaved, onCancel, toast }) {
  const editing = !!oggetto;

  const [nome,      setNome]      = useState(oggetto?.nome      || "");
  const [stanza,    setStanza]    = useState(oggetto?.stanza    || "");
  const [connessi,  setConnessi]  = useState(oggetto?.connessi  || []);
  const [allOggetti, setAllOggetti] = useState([]);
  const [connessoSel, setConnessoSel] = useState("");
  const [descrizioni, setDesc]    = useState(normalizeDescrizioni(oggetto?.descrizioni));
  const [immagini, setImmagini] = useState([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [uploadingTipo, setUploadingTipo] = useState(null);
  const [deletingTipo, setDeletingTipo] = useState(null);
  const [newTipo, setNewTipo] = useState("preview");
  const [newTipoFile, setNewTipoFile] = useState(null);
  const [newTipoPreview, setNewTipoPreview] = useState(null);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (oggetto) {
      setNome(oggetto.nome || "");
      setStanza(oggetto.stanza || "");
      setConnessi(oggetto.connessi || []);
      setDesc(normalizeDescrizioni(oggetto.descrizioni));
    }
  }, [oggetto]);

  useEffect(() => {
    let cancelled = false;
    const loadOggetti = async () => {
      try {
        const data = await api(`/musei/${enc(museo)}`);
        if (!cancelled) setAllOggetti(data?.oggetti || []);
      } catch {
        if (!cancelled) setAllOggetti([]);
      }
    };
    loadOggetti();
    return () => { cancelled = true; };
  }, [museo]);

  const currentObjectName = (editing ? oggetto?.nome : nome).trim();
  const stanzaTrim = stanza.trim();
  const stanzaNorm = normalizeLabel(stanzaTrim);
  const stanzeDisponibili = [...new Set(allOggetti.map((o) => o?.stanza).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (stanzaTrim && !stanzeDisponibili.includes(stanzaTrim)) stanzeDisponibili.unshift(stanzaTrim);
  const connessiStessaStanza = allOggetti
    .filter((o) =>
      o?.nome &&
      o.nome !== currentObjectName &&
      normalizeLabel(o.stanza) === stanzaNorm &&
      !connessi.includes(o.nome)
    )
    .map((o) => o.nome);
  const connessiTutti = allOggetti
    .filter((o) => o?.nome && o.nome !== currentObjectName && !connessi.includes(o.nome))
    .map((o) => ({ nome: o.nome, stanza: o.stanza || "" }));
  const useFallbackAll = connessiStessaStanza.length === 0;

  const addConnesso = () => {
    if (!connessoSel) return;
    if (!connessi.includes(connessoSel)) {
      setConnessi([...connessi, connessoSel]);
    }
    setConnessoSel("");
  };
  const removeConnesso = (n) => setConnessi(connessi.filter((c) => c !== n));

  const updateDesc = (livelloIdx, durataIdx, text) => {
    setDesc((prev) => {
      const next = prev.map((row) => [...row]);
      next[livelloIdx][durataIdx] = text;
      return next;
    });
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
      onSaved();
    } catch (err) {
      toast("Errore: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const targetNameForImages = editing ? oggetto?.nome : nome.trim();
  const canManageImages = editing && !!targetNameForImages;

  const reloadImmagini = async () => {
    if (!canManageImages) {
      setImmagini([]);
      return;
    }
    setImgLoading(true);
    try {
      const data = await api(`/musei/${enc(museo)}/oggetti/${enc(targetNameForImages)}/immagini`);
      setImmagini(data?.immagini || []);
    } catch {
      setImmagini([]);
    } finally {
      setImgLoading(false);
    }
  };

  useEffect(() => {
    reloadImmagini();
  }, [canManageImages, museo, targetNameForImages]);

  const uploadImmagine = async (tipo, file) => {
    if (!file || !canManageImages) return;
    const tipoFinal = normalizeLabel(tipo);
    if (!tipoFinal || !isValidImageTipo(tipoFinal)) {
      toast("Tipo non valido: usa 'preview' o un numero", "error");
      return;
    }
    setUploadingTipo(tipoFinal);
    try {
      const fd = new FormData();
      fd.append("immagine", file);
      await api(`/musei/${enc(museo)}/oggetti/${enc(targetNameForImages)}/immagini/${enc(tipoFinal)}`, {
        method: "POST",
        body: fd,
        isFormData: true,
      });
      toast(`Immagine "${tipoFinal}" caricata`);
      await reloadImmagini();
      if (tipoFinal === newTipo) {
        setNewTipoFile(null);
        setNewTipoPreview(null);
      }
    } catch (err) {
      toast("Errore: " + err.message, "error");
    } finally {
      setUploadingTipo(null);
    }
  };

  const removeImmagine = async (tipo) => {
    if (!canManageImages) return;
    setDeletingTipo(tipo);
    try {
      await api(`/musei/${enc(museo)}/oggetti/${enc(targetNameForImages)}/immagini/${enc(tipo)}`, { method: "DELETE" });
      toast(`Immagine "${tipo}" eliminata`);
      await reloadImmagini();
    } catch (err) {
      toast("Errore: " + err.message, "error");
    } finally {
      setDeletingTipo(null);
    }
  };

  useEffect(() => {
    return () => {
      if (newTipoPreview) URL.revokeObjectURL(newTipoPreview);
    };
  }, [newTipoPreview]);

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
            <select
              style={inputStyle}
              value={stanza}
              onChange={(e) => setStanza(e.target.value)}
              required
            >
              <option value="">Seleziona stanza...</option>
              {stanzeDisponibili.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FormGroup>
        </div>

        <FormGroup label={<>Oggetti connessi <span style={{ color: "var(--text-faint)", fontSize: 9 }}>(stessa stanza)</span></>}>
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
            <select
              value={connessoSel}
              onChange={(e) => setConnessoSel(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 180, border: "none", background: "transparent", padding: "4px 4px", fontSize: 13 }}
              disabled={!stanzaTrim}
            >
              <option value="">
                {!stanzaTrim
                  ? "Inserisci prima la stanza"
                  : useFallbackAll
                    ? "Nessuno nella stanza: mostra tutti..."
                    : "Seleziona oggetto..."}
              </option>
              {(useFallbackAll ? connessiTutti.map((o) => o.nome) : connessiStessaStanza).map((n) => {
                const stanzaObj = connessiTutti.find((o) => o.nome === n)?.stanza;
                const label = useFallbackAll && stanzaObj ? `${n} (${stanzaObj})` : n;
                return <option key={n} value={n}>{label}</option>;
              })}
            </select>
            <button
              type="button"
              onClick={addConnesso}
              disabled={!connessoSel}
              style={{
                padding: "6px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--text-dim)",
                fontSize: 11,
                cursor: connessoSel ? "pointer" : "default",
              }}
            >
              + Aggiungi
            </button>
          </div>
        </FormGroup>

        <Divider label="Descrizioni" />
        <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "-10px 0 18px", letterSpacing: "0.04em" }}>
          Seleziona livello e durata, inserisci <Code>testo</Code>
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
          {LIVELLI.map((livello, livelloIdx) => (
            <React.Fragment key={livello}>
              <div style={{
                fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.2em",
                textTransform: "uppercase", color: "var(--gold)",
                padding: "10px 8px", textAlign: "center",
                borderRight: "1px solid var(--border)",
              }}>{livello}</div>
              {DURATE.map((durata, durataIdx) => {
                const text = descrizioni?.[livelloIdx]?.[durataIdx] || "";
                return (
                  <div key={`${livello}-${durata}`} style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: "10px 8px",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}>
                    <textarea
                      placeholder="Testo..."
                      value={text}
                      onChange={(e) => updateDesc(livelloIdx, durataIdx, e.target.value)}
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

        <Divider label="Immagini" />
        {!canManageImages ? (
          <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: -8 }}>
            Salva prima l'oggetto. Dopo il salvataggio puoi caricare preview e immagini aggiuntive.
          </p>
        ) : (
          <>
            {imgLoading && <p style={{ fontSize: 11, color: "var(--text-faint)" }}>Caricamento immagini...</p>}
            {!imgLoading && immagini.length === 0 && <p style={{ fontSize: 11, color: "var(--text-faint)" }}>Nessuna immagine caricata.</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
              {immagini.map((img) => (
                <div key={img.tipo} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--bg-panel)" }}>
                  <img src={`/api${img.url}`} alt={img.tipo} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 10, color: "var(--gold)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{img.tipo}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <label style={{ ...miniBtnStyle, flex: 1, textAlign: "center", cursor: uploadingTipo === img.tipo || deletingTipo === img.tipo ? "default" : "pointer" }}>
                        {uploadingTipo === img.tipo ? "Upload..." : "Sostituisci"}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          disabled={uploadingTipo === img.tipo || deletingTipo === img.tipo}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) uploadImmagine(img.tipo, f);
                          }}
                        />
                      </label>
                      <button type="button" style={{ ...miniBtnStyle, color: "#e05a4a" }} disabled={uploadingTipo === img.tipo || deletingTipo === img.tipo} onClick={() => removeImmagine(img.tipo)}>
                        {deletingTipo === img.tipo ? "..." : "Elimina"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 10, background: "var(--bg-panel)" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 8 }}>
                AGGIUNGI O SOSTITUISCI IMMAGINE
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {["preview", "1", "2", "3", "4"].map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setNewTipo(tipo)}
                    style={{
                      ...miniBtnStyle,
                      background: newTipo === tipo ? "var(--gold)" : "transparent",
                      color: newTipo === tipo ? "#0d0d0d" : "var(--text-dim)",
                      borderColor: newTipo === tipo ? "var(--gold)" : "var(--border)",
                    }}
                  >
                    {tipo}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
                <label style={{ ...miniBtnStyle, cursor: "pointer" }}>
                  Scegli file
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (newTipoPreview) URL.revokeObjectURL(newTipoPreview);
                      setNewTipoFile(f);
                      setNewTipoPreview(f ? URL.createObjectURL(f) : null);
                    }}
                  />
                </label>
                <button type="button" style={miniBtnStyle} disabled={!newTipoFile || uploadingTipo === newTipo} onClick={() => uploadImmagine(newTipo, newTipoFile)}>
                  {uploadingTipo === newTipo ? "Upload..." : "Carica"}
                </button>
              </div>
              {!!newTipoFile && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>
                  File selezionato: {newTipoFile.name}
                </div>
              )}
              {newTipoPreview && <img src={newTipoPreview} alt="anteprima locale" style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: "var(--radius)" }} />}
            </div>
          </>
        )}

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
const miniBtnStyle = {
  padding: "7px 9px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text-dim)",
  fontSize: 11,
  cursor: "pointer",
};
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