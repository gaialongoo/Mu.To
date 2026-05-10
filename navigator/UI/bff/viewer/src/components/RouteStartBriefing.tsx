import { useEffect, useState } from "react";
import { useNavLang } from "../i18n/NavLangContext";

const API_BASE = "/api";

export type BriefingSessionPick = {
  museo: string;
  createdAt: number;
};

type MuseumBriefing = {
  nome: string;
  citta: string;
  indirizzo: string;
  palazzo: string;
  istruzioniAccesso: string;
};

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (!value.trim()) return null;
  return (
    <div className="route-briefing__row">
      <div className="route-briefing__label">{label}</div>
      <div className="route-briefing__value">{value}</div>
    </div>
  );
}

export default function RouteStartBriefing({
  session,
  onContinue,
}: {
  session: BriefingSessionPick;
  onContinue: () => void;
}) {
  const { t } = useNavLang();
  const [data, setData] = useState<MuseumBriefing | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_BASE}/musei/${encodeURIComponent(session.museo)}`
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(String(d?.error || "fetch"));
        if (cancelled) return;
        setData({
          nome: String(d.nome ?? session.museo),
          citta: String(d.citta ?? ""),
          indirizzo: String(d.indirizzo ?? ""),
          palazzo: String(d.palazzo ?? ""),
          istruzioniAccesso: String(d.istruzioniAccesso ?? ""),
        });
      } catch {
        if (!cancelled) {
          setData({
            nome: session.museo,
            citta: "",
            indirizzo: "",
            palazzo: "",
            istruzioniAccesso: "",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.museo]);

  const museumLine =
    data != null ? [data.nome, data.citta].filter(Boolean).join(" · ") : null;

  return (
    <div className="route-briefing" role="region" aria-labelledby="route-briefing-heading">
      <div className="route-briefing__scroll">
        <p className="route-briefing__kicker">{t("visitBriefingTitle")}</p>
        <h1 id="route-briefing-heading" className="route-briefing__head">{t("visitBriefingSubtitle")}</h1>

        {data == null ? (
          <p className="route-briefing__loading">{t("visitBriefingLoading")}</p>
        ) : (
          <>
            <p className="route-briefing__intro">
              {t("visitBriefingIntro")}
            </p>
            <p className="route-briefing__museum">{museumLine}</p>

            {[data.indirizzo, data.palazzo, data.istruzioniAccesso].some((x) =>
              x.trim()
            ) ? (
              <div className="route-briefing__card">
                <InfoRow label={t("visitBriefingAddr")} value={data.indirizzo} />
                <InfoRow
                  label={t("visitBriefingBuilding")}
                  value={data.palazzo}
                />
                <InfoRow
                  label={t("visitBriefingNotes")}
                  value={data.istruzioniAccesso}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="route-briefing__footer">
        <button
          type="button"
          className="route-briefing__cta"
          onClick={onContinue}
          disabled={data == null}
        >
          {t("visitBriefingContinue")}
        </button>
      </div>
    </div>
  );
}
