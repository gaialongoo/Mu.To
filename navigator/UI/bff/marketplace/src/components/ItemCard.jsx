import React from "react";
import { previewUrl } from "../api";

export default function ItemCard({ oggetto, museo, onEdit, onDelete, delay = 0 }) {
  const nD = Array.isArray(oggetto.descrizioni) ? oggetto.descrizioni.length : 0;
  const nC = Array.isArray(oggetto.connessi) ? oggetto.connessi.length : 0;

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        transition: "all 0.3s ease",
        position: "relative",
        animation: `fadeUp 0.4s ease ${delay}s backwards`,
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-5px)";
        e.currentTarget.style.boxShadow = "0 20px 60px rgba(0,0,0,0.55)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* Image */}
      <div style={{
        width: "100%", height: 155,
        background: "linear-gradient(135deg, #1a1a1a, #202020)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden",
      }}>
        <img
          src={previewUrl(museo, oggetto.nome)}
          alt={oggetto.nome}
          onError={(e) => { e.target.style.display = "none"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>

      {/* Body */}
      <div style={{ padding: "20px 22px 14px" }}>
        <div style={{
          fontFamily: "var(--font-head)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.07em",
          color: "var(--text)",
          marginBottom: 10,
          lineHeight: 1.45,
        }}>{oggetto.nome}</div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.05em", color: "var(--text-dim)" }}>
            {nD} desc · {nC} connessi
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {oggetto.stanza && (
            <span style={{
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-dim)",
              border: "1px solid var(--border)",
              padding: "3px 9px",
              borderRadius: 2,
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontFamily: "var(--font-head)",
            }}>{oggetto.stanza}</span>
          )}
          {(oggetto.connessi || []).slice(0, 2).map((c) => (
            <span key={c} style={{
              background: "var(--gold-dim)",
              color: "var(--gold)",
              border: "1px solid rgba(92,191,128,0.18)",
              padding: "3px 9px",
              borderRadius: 2,
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontFamily: "var(--font-head)",
            }}>{c}</span>
          ))}
          {nC > 2 && (
            <span style={{
              background: "var(--gold-dim)", color: "var(--gold)",
              border: "1px solid rgba(92,191,128,0.18)",
              padding: "3px 9px", borderRadius: 2, fontSize: 9,
              letterSpacing: "0.14em", textTransform: "uppercase",
              fontFamily: "var(--font-head)",
            }}>+{nC - 2}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, padding: "10px 22px 18px" }}>
        <CardBtn onClick={() => onEdit(oggetto.nome)}>Modifica</CardBtn>
        <CardBtn danger onClick={() => onDelete(oggetto.nome)}>Elimina</CardBtn>
      </div>
    </div>
  );
}

function CardBtn({ children, onClick, danger }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1,
        padding: "8px 10px",
        background: "transparent",
        border: `1px solid ${hov ? (danger ? "rgba(200,70,60,0.4)" : "rgba(92,191,128,0.3)") : "var(--border)"}`,
        borderRadius: "var(--radius)",
        cursor: "pointer",
        fontFamily: "var(--font-head)",
        fontSize: 9,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: hov ? (danger ? "#e05a4a" : "var(--gold)") : "var(--text-dim)",
        transition: "all 0.2s",
      }}
    >{children}</button>
  );
}