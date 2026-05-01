import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NAV_LANG_OPTIONS, VIEWER_STRINGS, type NavLang } from "./viewerLocales";

const LS_KEY = "mu_nav_lang";

function readStoredLang(): NavLang {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "en" || v === "fr" || v === "it") return v;
  } catch {
    /* ignore */
  }
  return "it";
}

type NavLangCtx = {
  lang: NavLang;
  setLang: (l: NavLang) => void;
  t: (key: string) => string;
  langOptions: typeof NAV_LANG_OPTIONS;
};

const Ctx = createContext<NavLangCtx | null>(null);

export function NavLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<NavLang>(readStoredLang);
  /** Evita che la risposta tardiva di GET /users/me sovrascriva la lingua appena scelta. */
  const userPickedLangRef = useRef(false);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (userPickedLangRef.current) return;
        const nl = data?.user?.navLang;
        if (nl === "en" || nl === "fr" || nl === "it") {
          setLangState(nl);
          try {
            localStorage.setItem(LS_KEY, nl);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onLangChanged = (ev: Event) => {
      const d = (ev as CustomEvent<NavLang>).detail;
      if (d !== "en" && d !== "fr" && d !== "it") return;
      userPickedLangRef.current = true;
      setLangState(d);
      try {
        localStorage.setItem(LS_KEY, d);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mu-nav-lang-changed", onLangChanged);
    return () => window.removeEventListener("mu-nav-lang-changed", onLangChanged);
  }, []);

  const setLang = useCallback((l: NavLang) => {
    userPickedLangRef.current = true;
    setLangState(l);
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("mu-nav-lang-changed", { detail: l }));
    fetch("/api/users/me/nav-lang", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navLang: l }),
    }).catch(() => {
      /* ospite o offline: solo locale */
    });
  }, []);

  const t = useCallback(
    (key: string) => VIEWER_STRINGS[lang][key] ?? VIEWER_STRINGS.it[key] ?? key,
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, t, langOptions: NAV_LANG_OPTIONS }),
    [lang, setLang, t]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavLang(): NavLangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNavLang: wrap with NavLangProvider");
  return c;
}

export function getStoredNavLang(): NavLang {
  return readStoredLang();
}
