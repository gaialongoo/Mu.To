import { useEffect, useMemo, useRef, useState } from "react";
import { useNavLang } from "../i18n/NavLangContext";

const API_BASE = "/api";

type ChatMessage = { role: "user" | "assistant"; text: string };

type Props = {
  museo: string;
  /** Stanza in cui si trova attualmente l'utente (label SVG, es. "sala A"). */
  stanzaCorrente: string | null;
  /** Oggetto attualmente focalizzato (se l'overlay e' aperto), opzionale. */
  oggettoCorrente: string | null;
  /** Tappa corrente del percorso ("to" della path subroute, primo oggetto, ecc.). */
  tappaCorrente: string | null;
  /** Sequenza ordinata di tappe del percorso/visita guidata. */
  percorso: string[];
  onClose: () => void;
};

export default function MuseumChatPanel({
  museo,
  stanzaCorrente,
  oggettoCorrente,
  tappaCorrente,
  percorso,
  onClose,
}: Props) {
  const { t, lang } = useNavLang();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const quickQuestions = useMemo(
    () => [
      t("museumQuickAccess"),
      t("museumQuickWc"),
      t("museumQuickShop"),
      t("museumQuickRoom"),
      t("museumQuickNext"),
    ],
    [t]
  );

  useEffect(() => {
    // Autofocus sul desktop; su mobile evitiamo per non aprire la tastiera.
    if (typeof window !== "undefined" && window.innerWidth > 900) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // ESC chiude.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || loading) return;
    setInput("");
    const newMsg: ChatMessage = { role: "user", text: question };
    setMessages((prev) => [...prev, newMsg]);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/ai/museum-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          museo,
          question,
          stanzaCorrente,
          oggettoCorrente,
          tappaCorrente,
          percorso,
          history: messages,
          navLang: lang,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.detail || d?.error || t("museumChatRequestFail"));
      const answer = String(d?.answer || "").trim() || t("museumChatNoAnswer");
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `${t("museumChatErrorPrefix")} ${err?.message || t("museumChatRequestFail")}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isMobile =
    typeof window !== "undefined" && window.innerWidth <= 900;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("museumChatTitle")}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 10040,
        display: "flex",
        alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? "100%" : "min(640px, 96vw)",
          height: isMobile ? "min(82vh, 720px)" : "min(78vh, 720px)",
          background: "var(--bg, #0f0f10)",
          color: "var(--text, #e9e9e9)",
          border: "1px solid var(--border, rgba(255,255,255,0.12))",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderBottomLeftRadius: isMobile ? 0 : 16,
          borderBottomRightRadius: isMobile ? 0 : 16,
          boxShadow: "0 20px 80px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(92,191,128,0.10) 0%, rgba(92,191,128,0.02) 100%)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-head)",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--green, #5cbf80)",
                fontWeight: 700,
              }}
            >
              {t("museumChatTitle")}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("museumChatSubtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("museumChatClose")}
            title={t("museumChatClose")}
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 10,
              border: "1px solid rgba(224, 65, 56, 0.65)",
              background: "rgba(224, 65, 56, 0.18)",
              color: "#ff5b4f",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: "28px",
              cursor: "pointer",
              boxShadow: "0 0 0 2px rgba(224,65,56,0.18)",
              padding: 0,
            }}
          >
            ✕
          </button>
        </header>

        <div
          ref={listRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                fontSize: 13,
                lineHeight: 1.5,
                padding: "8px 4px",
              }}
            >
              {t("museumChatEmpty")}
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "86%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  background:
                    m.role === "user"
                      ? "rgba(92,191,128,0.20)"
                      : "rgba(92,191,128,0.08)",
                  border:
                    m.role === "user"
                      ? "1px solid rgba(92,191,128,0.45)"
                      : "1px solid rgba(92,191,128,0.18)",
                }}
              >
                {m.text}
              </div>
            </div>
          ))}

          {loading && (
            <div
              style={{
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              {t("museumChatThinking")}
            </div>
          )}
        </div>

        {messages.length === 0 && (
          <div
            style={{
              padding: "0 12px 8px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {quickQuestions.map((q) => (
              <button
                type="button"
                key={q}
                onClick={() => send(q)}
                disabled={loading}
                style={{
                  border: "1px solid rgba(92,191,128,0.35)",
                  background: "rgba(92,191,128,0.08)",
                  color: "var(--green, #5cbf80)",
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("museumChatPlaceholder")}
            disabled={loading}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text, #e9e9e9)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(92,191,128,0.45)",
              background: loading || !input.trim()
                ? "rgba(92,191,128,0.10)"
                : "rgba(92,191,128,0.22)",
              color: "var(--green, #5cbf80)",
              fontFamily: "var(--font-head)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            }}
          >
            {t("send")}
          </button>
        </form>
      </div>
    </div>
  );
}
