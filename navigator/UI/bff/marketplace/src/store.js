// Store Alpine del marketplace. Sostituisce lo stato React (useState/useEffect/useMemo)
// con un singolo oggetto reattivo. La logica API e i18n e' riusata da api.js / mpLocales.js.
//
// NOTA: implementazione incrementale. Slice 1 = scaffold (header, lingua, API key,
// toast, tab nav, auth, caricamento museo). Le tab catalogo/visite/teacher/profilo
// vengono riempite nelle slice successive.

import { api, enc, setApiKey, clearApiKey } from "./api";
import { readStoredNavLang, writeStoredNavLang, MP_LANG_OPTIONS, mpT, normalizeNavLang } from "./mpLocales";
import { PAGE_SIZE, displayI18nMapLookup } from "./helpers";

export function marketplace() {
  const params = new URLSearchParams(window.location.search);

  return {
    // ── costanti ───────────────────────────────────────────────
    PAGE_SIZE,
    LANG_OPTIONS: MP_LANG_OPTIONS,
    MUSEO: params.get("museo"),

    // ── viewport ───────────────────────────────────────────────
    viewportW: window.innerWidth,
    get isTablet() { return this.viewportW <= 1024; },
    get isMobile() { return this.viewportW <= 768; },

    // ── i18n ───────────────────────────────────────────────────
    lang: readStoredNavLang(),
    mp(key) { return mpT(this.lang, key); },
    setLang(l) {
      this.lang = l;
      writeStoredNavLang(l);
      window.dispatchEvent(new CustomEvent("mu-nav-lang-changed", { detail: l }));
      fetch("/api/users/me/nav-lang", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ navLang: l }),
      }).catch(() => {});
    },

    // ── toast ──────────────────────────────────────────────────
    toast: { msg: "", type: "success", show: false },
    _toastTimer: null,
    showToast(msg, type = "success") {
      this.toast = { msg, type, show: true };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast.show = false; }, 3200);
    },

    // ── API key ────────────────────────────────────────────────
    apiKeyActive: false,
    modalOpen: false,
    apiKeyDraft: "",
    openApiKeyModal() { this.apiKeyDraft = ""; this.modalOpen = true; },
    confirmApiKey() {
      const key = this.apiKeyDraft.trim();
      if (!key) return;
      setApiKey(key);
      this.apiKeyActive = true;
      this.modalOpen = false;
      this.apiKeyDraft = "";
      this.showToast("API Key impostata — ricarico dati");
      this.loadMuseo();
    },
    logoutApiKey() {
      clearApiKey();
      this.apiKeyActive = false;
      this.showToast("API Key rimossa");
    },

    // ── auth / utente ──────────────────────────────────────────
    authChecked: false,
    currentUser: null,
    profileOpen: false,
    get isProfessor() {
      return String(this.currentUser?.ruolo || "").toLowerCase() === "professore";
    },

    // ── teacher builder (slice 4) ──────────────────────────────
    teacherBuilderOpen: false,
    openTeacherBuilder() {
      // TODO slice 4: costruttore visite guidate
      this.teacherBuilderOpen = true;
      this.showToast("Costruttore visite: in arrivo (slice 4)");
    },

    // ── navigazione tab ────────────────────────────────────────
    activeTab: "items",
    switchSection(section) {
      if (section === "visits" && !this.percorsiLoaded) this.loadPercorsi();
      this.activeTab = section;
    },

    // ── dati museo ─────────────────────────────────────────────
    allOggetti: [],
    stanze: [],
    museumLabelI18n: { stanze: {}, percorsi: {} },
    loadingItems: true,
    percorsi: [],
    personalRoutes: [],
    percorsiLoaded: false,
    loadingVisits: false,

    displayStanzaName(nome) {
      return nome ? displayI18nMapLookup(this.museumLabelI18n?.stanze, nome, this.lang) : "";
    },
    displayPercorsoNome(nome) {
      return nome ? displayI18nMapLookup(this.museumLabelI18n?.percorsi, nome, this.lang) : "";
    },

    // ── ciclo di vita ──────────────────────────────────────────
    init() {
      window.addEventListener("resize", () => { this.viewportW = window.innerWidth; });
      this.ensureAuth().then(() => {
        if (this.MUSEO) this.loadMuseo();
      });
    },

    async ensureAuth() {
      try {
        const res = await fetch("/api/users/me", { credentials: "include" });
        if (!res.ok) { window.location.replace("/"); return; }
        const data = await res.json().catch(() => ({}));
        const user = data.user || null;
        this.currentUser = user;
        const nl = user?.navLang;
        if (nl === "en" || nl === "fr" || nl === "it") {
          this.lang = nl;
          writeStoredNavLang(nl);
        }
        this.authChecked = true;
      } catch {
        window.location.replace("/");
      }
    },

    async loadMuseo() {
      if (!this.MUSEO) return;
      this.loadingItems = true;
      try {
        const data = await api(`/musei/${enc(this.MUSEO)}`);
        const oggetti = data.oggetti || [];
        this.allOggetti = oggetti;
        this.stanze = [...new Set(oggetti.map((o) => o.stanza).filter(Boolean))];
        this.museumLabelI18n =
          data.labelI18n && typeof data.labelI18n === "object"
            ? {
                stanze: { ...(data.labelI18n.stanze || {}) },
                percorsi: { ...(data.labelI18n.percorsi || {}) },
              }
            : { stanze: {}, percorsi: {} };
      } catch (e) {
        this.showToast("Errore caricamento museo: " + e.message, "error");
      } finally {
        this.loadingItems = false;
      }
    },

    async loadPercorsi() {
      if (!this.MUSEO) return;
      this.loadingVisits = true;
      try {
        const data = await api(`/musei/${enc(this.MUSEO)}/percorsi`);
        this.percorsi = data.percorsi || [];
        this.percorsiLoaded = true;
      } catch (e) {
        this.showToast("Errore caricamento percorsi: " + e.message, "error");
      } finally {
        this.loadingVisits = false;
      }
    },
  };
}
