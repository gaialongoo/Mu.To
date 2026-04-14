import React, { useState } from "react";

export default function ApiKeyModal({ open, onClose, onConfirm }) {
  const [key, setKey] = useState("");
  const isMobile = window.innerWidth <= 768;

  const handleConfirm = () => {
    if (!key.trim()) return;
    onConfirm(key.trim());
    setKey("");
  };

  if (!open) return null;

  return (
    <div
      style={{
        display: "flex",
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: isMobile ? 16 : 48,
        width: "90%",
        maxWidth: 420,
        position: "relative",
        boxShadow: "0 40px 100px rgba(0,0,0,0.7)",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 48, right: 48, height: 1,
          background: "linear-gradient(90deg, transparent, var(--gold), transparent)",
          opacity: 0.45,
        }} />
        <button
          onClick={onClose}
          style={{
            position: "absolute", right: 20, top: 20,
            width: 28, height: 28,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "50%",
            cursor: "pointer",
            color: "var(--text-dim)",
            fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}
        >✕</button>

        <h3 style={{ fontFamily: "var(--font-head)", fontSize: 18, fontWeight: 400, letterSpacing: "0.12em", marginBottom: 30 }}>
          <small style={{ display: "block", fontSize: 9, letterSpacing: "0.3em", color: "var(--gold)", marginBottom: 8 }}>Autenticazione</small>
          API Key
        </h3>

        <div style={{ marginBottom: 22 }}>
          <label style={{
            display: "block",
            fontFamily: "var(--font-head)",
            fontSize: 10,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
            marginBottom: 9,
          }}>X-API-Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            placeholder="Inserisci la chiave API"
            style={{
              width: "100%",
              padding: "13px 15px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        <button
          onClick={handleConfirm}
          style={{
            width: "100%",
            padding: 13,
            background: "var(--gold)",
            color: "#0d0d0d",
            border: "none",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontFamily: "var(--font-head)",
            fontSize: 10,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
          }}
        >Conferma</button>

        <div style={{
          marginTop: 18,
          padding: 14,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderLeft: "2px solid var(--gold)",
          borderRadius: "var(--radius)",
          fontSize: 11,
          letterSpacing: "0.04em",
          color: "var(--text-dim)",
          lineHeight: 1.9,
        }}>
          <strong style={{ fontFamily: "var(--font-head)", fontSize: 9, letterSpacing: "0.2em", color: "var(--gold)" }}>INFO</strong><br />
          Inviata come header <code style={{ background: "rgba(92,191,128,0.1)", color: "var(--gold)", padding: "1px 6px", borderRadius: 2, fontFamily: "monospace" }}>X-API-Key</code> tramite proxy Vite su <code style={{ background: "rgba(92,191,128,0.1)", color: "var(--gold)", padding: "1px 6px", borderRadius: 2, fontFamily: "monospace" }}>/api</code>.<br />
          Non viene persistita oltre la sessione.
        </div>
      </div>
    </div>
  );
}