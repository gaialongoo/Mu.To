// Store Alpine del marketplace. Sostituisce lo stato React (useState/useEffect/useMemo)
// con un singolo oggetto reattivo. La logica API e i18n e' riusata da api.js / mpLocales.js.
//
// NOTA: implementazione incrementale. Slice 1 = scaffold (header, lingua, API key,
// toast, tab nav, auth, caricamento museo). Le tab catalogo/visite/teacher/profilo
// vengono riempite nelle slice successive.

import { api, enc, setApiKey, clearApiKey, previewUrl } from "./api";
import { readStoredNavLang, writeStoredNavLang, MP_LANG_OPTIONS, mpT, normalizeNavLang } from "./mpLocales";
import {
  PAGE_SIZE, displayI18nMapLookup, formatPrezzo, formatEuroAmount,
  parseAnnoValue, yearInputToSigned, LEVEL_KEY_TO_INDEX, DURATION_KEY_TO_INDEX,
} from "./helpers";

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

    // ── filtri catalogo ────────────────────────────────────────
    search: "", stanzaFilter: "", autoreFilter: "", correnteFilter: "",
    yearFrom: "", yearTo: "", yearFromEra: "ac", yearToEra: "dc",
    appliedSearch: "", appliedStanza: "", appliedAutore: "", appliedCorrente: "",
    appliedYearFrom: "", appliedYearTo: "", appliedYearFromEra: "ac", appliedYearToEra: "dc",
    itemPage: 1,

    // ── modale dettaglio oggetto ───────────────────────────────
    selectedItem: null,
    selectedItemImages: [],
    showAllDescriptions: false,
    selectedGalleryIndex: 0,

    // ── richieste acquisto oggetti ─────────────────────────────
    objectPurchaseRequests: [],
    loadingObjectRequests: false,
    requestingObjectName: null,

    // ── etichette descrizioni (dipendono dalla lingua) ─────────
    get DESCRIPTION_LEVELS() {
      return [this.mp("lvlChild"), this.mp("lvlStudent"), this.mp("lvlExpert"), this.mp("lvlAdvanced")];
    },
    get DESCRIPTION_LENGTHS() {
      return [this.mp("durLabelShort"), this.mp("durLabelMed"), this.mp("durLabelLong")];
    },

    displayStanzaName(nome) {
      return nome ? displayI18nMapLookup(this.museumLabelI18n?.stanze, nome, this.lang) : "";
    },
    displayPercorsoNome(nome) {
      return nome ? displayI18nMapLookup(this.museumLabelI18n?.percorsi, nome, this.lang) : "";
    },

    // ── ciclo di vita ──────────────────────────────────────────
    init() {
      window.addEventListener("resize", () => { this.viewportW = window.innerWidth; });
      this.$watch("profileOpen", (open) => {
        document.body.style.overflow = open ? "hidden" : "";
      });
      this.ensureAuth().then(() => {
        if (!this.authChecked || !this.MUSEO) return;
        this.loadMuseo();
        this.loadObjectPurchaseRequests();
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

    // ── filtri / catalogo ──────────────────────────────────────
    get autori() {
      return [...new Set(this.allOggetti.map((o) => String(o?.autore || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    },
    get correntiArtistiche() {
      return [...new Set(this.allOggetti.map((o) => String(o?.correnteArtistica || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    },
    get filtered() {
      return this.allOggetti.filter((o) => {
        if (this.appliedSearch) {
          const q = this.appliedSearch.toLowerCase();
          const searchable = [o?.nome, o?.autore, o?.correnteArtistica, o?.anno]
            .map((v) => String(v || "").toLowerCase()).join(" ");
          if (!searchable.includes(q)) return false;
        }
        if (this.appliedStanza && o.stanza !== this.appliedStanza) return false;
        if (this.appliedAutore && String(o?.autore || "").trim() !== this.appliedAutore) return false;
        if (this.appliedCorrente && String(o?.correnteArtistica || "").trim() !== this.appliedCorrente) return false;
        const fromSigned = yearInputToSigned(this.appliedYearFrom, this.appliedYearFromEra);
        const toSigned = yearInputToSigned(this.appliedYearTo, this.appliedYearToEra);
        if (fromSigned != null || toSigned != null) {
          const annoOggetto = parseAnnoValue(o?.anno);
          if (annoOggetto == null) return false;
          const minYear = Math.min(fromSigned ?? annoOggetto, toSigned ?? annoOggetto);
          const maxYear = Math.max(fromSigned ?? annoOggetto, toSigned ?? annoOggetto);
          if (annoOggetto < minYear || annoOggetto > maxYear) return false;
        }
        return true;
      });
    },
    get pagedItems() {
      return this.filtered.slice((this.itemPage - 1) * PAGE_SIZE, this.itemPage * PAGE_SIZE);
    },
    get itemPages() { return Math.ceil(this.filtered.length / PAGE_SIZE); },
    applyFilters() {
      this.appliedSearch = this.search;
      this.appliedStanza = this.stanzaFilter;
      this.appliedAutore = this.autoreFilter;
      this.appliedCorrente = this.correnteFilter;
      this.appliedYearFrom = this.yearFrom;
      this.appliedYearTo = this.yearTo;
      this.appliedYearFromEra = this.yearFromEra;
      this.appliedYearToEra = this.yearToEra;
      this.itemPage = 1;
    },
    resetFilters() {
      this.search = ""; this.stanzaFilter = ""; this.autoreFilter = ""; this.correnteFilter = "";
      this.yearFrom = ""; this.yearTo = ""; this.yearFromEra = "ac"; this.yearToEra = "dc";
      this.appliedSearch = ""; this.appliedStanza = ""; this.appliedAutore = ""; this.appliedCorrente = "";
      this.appliedYearFrom = ""; this.appliedYearTo = ""; this.appliedYearFromEra = "ac"; this.appliedYearToEra = "dc";
      this.itemPage = 1;
    },
    previewSrc(o) { return previewUrl(this.MUSEO, o.nome); },
    isTextObject(o) { return String(o?.objectType || "").toLowerCase() === "text"; },
    priceLabel(o) { return formatEuroAmount(o?.prezzo); },

    // ── richieste acquisto oggetti ─────────────────────────────
    makeObjectRequestKey(o) {
      return `${String(o?.nome || "").trim()}::${String(o?.stanza || "").trim()}`;
    },
    get latestObjectRequestByName() {
      const map = new Map();
      for (const req of this.objectPurchaseRequests) {
        const key = `${String(req?.oggetto || "").trim()}::${String(req?.stanza || "").trim()}`;
        if (!key) continue;
        const prev = map.get(key);
        if (!prev || new Date(req?.createdAt || 0) > new Date(prev?.createdAt || 0)) map.set(key, req);
      }
      return map;
    },
    getObjectPurchaseUi(o) {
      const req = this.latestObjectRequestByName.get(this.makeObjectRequestKey(o));
      if (!req) return { label: this.mp("requestBuy"), disabled: false };
      const status = String(req.status || "").toLowerCase();
      if (status === "pending") return { label: this.mp("requestPending"), disabled: true };
      if (status === "approved") return { label: this.mp("requestApproved"), disabled: true };
      return { label: this.mp("requestRejected"), disabled: false };
    },
    purchaseBusy(o) {
      return this.loadingObjectRequests || this.requestingObjectName === this.makeObjectRequestKey(o);
    },
    purchaseLabel(o) {
      if (this.requestingObjectName === this.makeObjectRequestKey(o)) return this.mp("requestSending");
      return this.getObjectPurchaseUi(o).label;
    },
    purchaseDisabled(o) {
      return this.purchaseBusy(o) || this.getObjectPurchaseUi(o).disabled;
    },
    async requestObjectPurchase(o) {
      const nomeOggetto = String(o?.nome || "").trim();
      const nomeStanza = String(o?.stanza || "").trim();
      if (!nomeOggetto || !this.MUSEO) return;
      if (this.purchaseDisabled(o) || this.requestingObjectName) return;
      const key = this.makeObjectRequestKey(o);
      this.requestingObjectName = key;
      try {
        const data = await api("/users/me/oggetti/acquista-richiesta", {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ museo: this.MUSEO, oggetto: nomeOggetto, stanza: nomeStanza }),
        });
        this.showToast(data?.duplicate ? this.mp("requestAlreadySent") : this.mp("requestSent"));
        this.loadObjectPurchaseRequests();
      } catch (e) {
        this.showToast("Errore richiesta acquisto oggetto: " + e.message, "error");
      } finally {
        this.requestingObjectName = null;
      }
    },
    async loadObjectPurchaseRequests() {
      if (!this.MUSEO) return;
      this.loadingObjectRequests = true;
      try {
        const data = await api(`/users/me/oggetti/richieste?museo=${enc(this.MUSEO)}`, { credentials: "include" });
        this.objectPurchaseRequests = Array.isArray(data.richieste) ? data.richieste : [];
      } catch (e) {
        this.objectPurchaseRequests = [];
        this.showToast("Errore caricamento richieste oggetti: " + e.message, "error");
      } finally {
        this.loadingObjectRequests = false;
      }
    },

    // ── modale dettaglio oggetto ───────────────────────────────
    async openItemDetails(o) {
      this.selectedItem = o;
      this.selectedItemImages = [];
      this.showAllDescriptions = false;
      this.selectedGalleryIndex = 0;
      try {
        const full = await api(`/musei/${enc(this.MUSEO)}/oggetti/${enc(o.nome)}`);
        if (full && typeof full === "object") this.selectedItem = { ...(this.selectedItem || {}), ...full };
      } catch { /* fallback su dati card */ }
      const previewFallback = [{ tipo: "preview", url: `/musei/${enc(this.MUSEO)}/oggetti/${enc(o.nome)}/immagini/preview` }];
      try {
        const data = await api(`/musei/${enc(this.MUSEO)}/oggetti/${enc(o.nome)}/immagini`);
        const imgs = Array.isArray(data.immagini) ? data.immagini : [];
        this.selectedItemImages = imgs.length === 0 ? previewFallback : imgs;
      } catch {
        this.selectedItemImages = previewFallback;
      }
    },
    closeItemModal() {
      this.selectedItem = null;
      this.selectedItemImages = [];
      this.showAllDescriptions = false;
      this.selectedGalleryIndex = 0;
    },
    get galleryImages() {
      return this.selectedItemImages.filter((img) => img.tipo !== "preview");
    },
    get galleryActiveIndex() {
      return Math.min(this.selectedGalleryIndex, Math.max(this.galleryImages.length - 1, 0));
    },
    get galleryActiveImage() {
      return this.galleryImages[this.galleryActiveIndex] || null;
    },
    galleryImgSrc(img) {
      if (!img) return "";
      return img.url.startsWith("/api") ? img.url : `/api${img.url}`;
    },
    galleryPrev() {
      const n = this.galleryImages.length;
      this.selectedGalleryIndex = this.selectedGalleryIndex === 0 ? n - 1 : this.selectedGalleryIndex - 1;
    },
    galleryNext() {
      const n = this.galleryImages.length;
      this.selectedGalleryIndex = this.selectedGalleryIndex === n - 1 ? 0 : this.selectedGalleryIndex + 1;
    },

    // descrizione "preferita" in base a livello/durata utente
    get preferredDescription() {
      const o = this.selectedItem;
      if (!o) return null;
      const descrizioni =
        this.lang !== "it" &&
        o?.descrizioniI18n?.[this.lang] &&
        Array.isArray(o.descrizioniI18n[this.lang]) &&
        o.descrizioniI18n[this.lang].length > 0
          ? o.descrizioniI18n[this.lang]
          : (Array.isArray(o?.descrizioni) ? o.descrizioni : []);
      if (descrizioni.length === 0) return null;
      const preferredLevelIndex = LEVEL_KEY_TO_INDEX[this.currentUser?.livello] ?? 1;
      const preferredDurationIndex = DURATION_KEY_TO_INDEX[this.currentUser?.durata] ?? 1;
      const levelIndex = descrizioni[preferredLevelIndex] ? preferredLevelIndex : Math.min(preferredLevelIndex, descrizioni.length - 1);
      const durationGroup = Array.isArray(descrizioni[levelIndex]) ? descrizioni[levelIndex] : [];
      const durationIndex = durationGroup[preferredDurationIndex] ? preferredDurationIndex : Math.min(preferredDurationIndex, Math.max(durationGroup.length - 1, 0));
      return {
        levelLabel: this.DESCRIPTION_LEVELS[levelIndex] || `Livello ${levelIndex + 1}`,
        durationLabel: this.DESCRIPTION_LENGTHS[durationIndex] || `Variante ${durationIndex + 1}`,
        text: durationGroup[durationIndex] || null,
      };
    },
    // matrice descrizioni per la tabella "mostra tutte"
    descCell(lvlIndex, lenIndex) {
      const o = this.selectedItem;
      if (!o) return "—";
      const matrix =
        this.lang !== "it" &&
        o?.descrizioniI18n?.[this.lang] &&
        Array.isArray(o.descrizioniI18n[this.lang]) &&
        o.descrizioniI18n[this.lang].length > 0
          ? o.descrizioniI18n[this.lang]
          : o.descrizioni;
      const group = Array.isArray(matrix?.[lvlIndex]) ? matrix[lvlIndex] : [];
      return group?.[lenIndex] || "—";
    },

    // helper formattazione esposti al markup
    fmtPrezzo(p) { return formatPrezzo(p, (k) => this.mp(k)); },
    fmtEuro(p) { return formatEuroAmount(p); },
  };
}
