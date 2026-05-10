import { useMemo, useState } from "react";
import "./styles/svg.css";
import SvgViewer from "./components/SvgViewer";
import RouteStartBriefing from "./components/RouteStartBriefing";
import { NavLangProvider, useNavLang } from "./i18n/NavLangContext";

const COOKIE_NAME = "museo_session";
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;
const BRIEFING_ACK = "muto_visit_briefing_ack";

type BriefSession = {
  museo: string;
  createdAt: number;
  percorso: string[];
};

function readSessionCookie(): BriefSession | null {
  const match = document.cookie.match(
    new RegExp("(^| )" + COOKIE_NAME + "=([^;]+)")
  );
  if (!match) return null;
  try {
    const s = JSON.parse(decodeURIComponent(match[2]));
    if (!s || typeof s.museo !== "string") return null;
    if (!Array.isArray(s.percorso) || s.percorso.length < 1) return null;
    if (typeof s.createdAt !== "number") return null;
    const age = Date.now() - s.createdAt;
    if (age < 0 || age > SESSION_MAX_AGE) return null;
    return {
      museo: s.museo,
      createdAt: s.createdAt,
      percorso: s.percorso,
    };
  } catch {
    return null;
  }
}

function briefingToken(s: BriefSession) {
  return `${s.museo}::${s.createdAt}`;
}

function AppContent() {
  const { t } = useNavLang();
  const session = useMemo(() => readSessionCookie(), []);
  const [showBriefing, setShowBriefing] = useState(() => {
    if (!session) return false;
    try {
      return sessionStorage.getItem(BRIEFING_ACK) !== briefingToken(session);
    } catch {
      return true;
    }
  });

  const finishBriefing = () => {
    if (session) {
      try {
        sessionStorage.setItem(BRIEFING_ACK, briefingToken(session));
      } catch {
        /* ignore */
      }
    }
    setShowBriefing(false);
  };

  return (
    <main id="navigator-main" className="app-root" aria-label={t("ariaMainNavigator")}>
      <div className="viewer-shell">
        {showBriefing && session ? (
          <RouteStartBriefing session={session} onContinue={finishBriefing} />
        ) : (
          <SvgViewer />
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <NavLangProvider>
      <AppContent />
    </NavLangProvider>
  );
}
