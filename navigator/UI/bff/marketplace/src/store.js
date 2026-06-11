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
      this.showToast("Costruttore visite: in arrivo (slice 4)");
    },
    startEditTeacherVisit(visit) {
      // TODO slice 4: apre il builder precompilato
      if (visit?.navigationStarted) { this.showToast("Visita gia avviata: non modificabile", "error"); return; }
      this.showToast("Modifica visita: in arrivo (slice 4)");
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

    // ── visite / percorsi ──────────────────────────────────────
    purchasedKeys: [],
    buyingPath: null,
    pathPurchaseConfirm: null,
    selectedPath: null,
    visitPage: 1,
    teacherSavedVisits: [],
    // popup IA
    aiLengthPreset: "medio",
    generatingAiRoute: false,
    aiRouteNameDraft: "",
    aiConstraints: "",
    showAiGenerateModal: false,

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
        this.loadPurchasedPaths();
        this.loadPersonalRoutes();
        if (this.isProfessor) this.loadTeacherSavedVisits();
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

    // ── visite / percorsi ──────────────────────────────────────
    async loadPersonalRoutes() {
      if (!this.MUSEO) return;
      try {
        const data = await api(`/users/me/percorsi/personalizzati?museo=${enc(this.MUSEO)}`, { credentials: "include" });
        this.personalRoutes = Array.isArray(data.percorsiPersonalizzati) ? data.percorsiPersonalizzati : [];
      } catch (e) {
        this.personalRoutes = [];
        this.showToast(`${this.mp("errLoadPersonalRoutes")} ${e.message}`, "error");
      }
    },
    async loadPurchasedPaths() {
      if (!this.MUSEO) return;
      try {
        const data = await api(`/users/me/percorsi?museo=${enc(this.MUSEO)}`, { credentials: "include" });
        this.purchasedKeys = Array.isArray(data.chiaviAcquisto) ? data.chiaviAcquisto : [];
      } catch (e) {
        this.purchasedKeys = [];
        this.showToast("Errore caricamento acquisti: " + e.message, "error");
      }
    },
    get allVisitRoutes() {
      return [
        ...this.percorsi,
        ...this.personalRoutes.map((r) => ({ ...r, oggetti: r.objectNodes || r.oggetti || [], prezzo: 0, isPersonalized: true })),
      ];
    },
    get pagedVisits() {
      return this.allVisitRoutes.slice((this.visitPage - 1) * PAGE_SIZE, this.visitPage * PAGE_SIZE);
    },
    get visitPages() { return Math.ceil(this.allVisitRoutes.length / PAGE_SIZE); },

    makePurchaseKey(p) { return `${this.MUSEO}::${p.nome}`; },
    canAccessPath(p) {
      return Number(p?.prezzo || 0) <= 0 || this.purchasedKeys.includes(this.makePurchaseKey(p));
    },
    // helper VisitCard
    visitIncluded(p) { return Number(p?.prezzo || 0) <= 0; },
    visitCanStart(p) { return this.visitIncluded(p) || this.canAccessPath(p); },
    visitShowBuy(p) { return !this.visitIncluded(p) && !this.canAccessPath(p); },

    requestBuyPath(p) {
      if (!p?.nome) return;
      if (this.canAccessPath(p)) { this.showToast("Percorso gia disponibile"); return; }
      this.pathPurchaseConfirm = p;
    },
    async confirmBuyPath() {
      const p = this.pathPurchaseConfirm;
      if (!p?.nome) return;
      this.pathPurchaseConfirm = null;
      this.buyingPath = p.nome;
      try {
        await api("/users/me/percorsi/acquista", {
          method: "POST", credentials: "include",
          body: JSON.stringify({ museo: this.MUSEO, percorso: p.nome }),
        });
        this.purchasedKeys = [...this.purchasedKeys, this.makePurchaseKey(p)];
        this.showToast(this.mp("pathPurchaseSuccess").replace("{name}", this.displayPercorsoNome(p.nome) || p.nome));
      } catch (e) {
        this.showToast(`${this.mp("pathPurchaseError")} ${e.message}`, "error");
      } finally {
        this.buyingPath = null;
      }
    },

    async generateAiRoute() {
      if (!this.MUSEO || this.generatingAiRoute) return;
      this.generatingAiRoute = true;
      try {
        await api("/users/me/percorsi/personalizzati/genera", {
          method: "POST", credentials: "include",
          body: JSON.stringify({
            museo: this.MUSEO,
            lengthPreset: this.aiLengthPreset,
            nome: this.aiRouteNameDraft.trim(),
            userConstraints: this.aiConstraints.trim(),
          }),
        });
        this.showToast(this.mp("aiRouteCreated"));
        await this.loadPersonalRoutes();
        if (!this.percorsiLoaded) this.percorsiLoaded = true;
        this.activeTab = "visits";
        this.showAiGenerateModal = false;
        this.aiRouteNameDraft = "";
        this.aiConstraints = "";
      } catch (e) {
        this.showToast(`${this.mp("personalRouteGenFail")} ${e.message}`, "error");
      } finally {
        this.generatingAiRoute = false;
      }
    },
    async deleteAiRoute(routeId) {
      if (!window.confirm(this.mp("personalRouteDeleteConfirm"))) return;
      try {
        await api(`/users/me/percorsi/personalizzati/${enc(routeId)}`, { method: "DELETE", credentials: "include" });
        this.loadPersonalRoutes();
        this.showToast(this.mp("personalRouteDeleted"));
      } catch (e) {
        this.showToast(`${this.mp("personalRouteDeleteFail")} ${e.message}`, "error");
      }
    },

    openPathDetails(p) {
      if (this.generatingAiRoute) { this.showToast(this.mp("waitPersonalRouteGenerating"), "error"); return; }
      if (!this.canAccessPath(p)) { this.showToast("Acquista il percorso per visualizzarlo", "error"); return; }
      this.selectedPath = p;
    },
    closePathModal() { this.selectedPath = null; },
    pathObjectRoom(name) {
      const o = this.allOggetti.find((x) => x.nome === name);
      return o?.stanza ? ` — ${this.mp("roomInline")} ${this.displayStanzaName(o.stanza)}` : "";
    },

    setMuseoSessionCookie(sessionObj) {
      try {
        const maxAgeSec = 24 * 60 * 60;
        document.cookie = `museo_session=${encodeURIComponent(JSON.stringify(sessionObj))}; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`;
      } catch { /* ignore */ }
    },
    startNavigatorForRoute(p) {
      if (!this.MUSEO) return;
      if (this.generatingAiRoute) { this.showToast(this.mp("waitPersonalRouteGeneratingNav"), "error"); return; }
      if (!this.canAccessPath(p)) { this.showToast("Acquista il percorso per avviarlo", "error"); return; }
      const isPersonalized = !!p?.isPersonalized || p?.source === "ai_personalized" || !!p?.id;
      if (isPersonalized) {
        const objectNodes = Array.isArray(p?.flowNodes) && p.flowNodes.length > 0
          ? p.flowNodes
          : (Array.isArray(p?.objectNodes) && p.objectNodes.length > 0
            ? p.objectNodes
            : (Array.isArray(p?.oggetti) ? p.oggetti : []));
        const firstNode = objectNodes[0];
        if (!firstNode) { this.showToast(this.mp("personalRouteEmpty"), "error"); return; }
        const personalizedRouteId = String(p?.id || "").trim();
        if (!personalizedRouteId) { this.showToast(this.mp("personalRouteIdMissing"), "error"); return; }
        this.setMuseoSessionCookie({ museo: this.MUSEO, percorso: ["IN", "OUT"], createdAt: Date.now(), personalizedRouteId });
        window.location.href = `/?stanza=${encodeURIComponent("IN")}/path/${encodeURIComponent("IN")}/${encodeURIComponent(firstNode)}`;
        return;
      }
      const oggetti = Array.isArray(p?.oggetti) ? p.oggetti : [];
      const firstObj = oggetti[0];
      if (!firstObj) { this.showToast("Percorso vuoto", "error"); return; }
      this.setMuseoSessionCookie({ museo: this.MUSEO, percorso: ["IN", ...oggetti, "OUT"], createdAt: Date.now() });
      window.location.href = `/?stanza=${encodeURIComponent("IN")}/path/${encodeURIComponent("IN")}/${encodeURIComponent(firstObj)}`;
    },

    async copyToClipboard(value, successMessage) {
      try {
        await navigator.clipboard.writeText(value);
        this.showToast(successMessage);
      } catch {
        window.prompt("Copia manualmente il link:", value);
        this.showToast("Copia automatica non disponibile", "error");
      }
    },

    // ── visite guidate salvate (professore) ────────────────────
    async loadTeacherSavedVisits() {
      if (!this.isProfessor) return;
      try {
        const data = await api("/users/me/guided-visits", { credentials: "include" });
        this.teacherSavedVisits = Array.isArray(data.visits) ? data.visits : [];
      } catch (e) {
        this.teacherSavedVisits = [];
        this.showToast("Errore caricamento visite guidate: " + e.message, "error");
      }
    },
    visitStudentLink(visit) {
      return `${window.location.origin}/?guidedVisit=${encodeURIComponent(visit.id)}&role=student`;
    },
    visitDashboardLink(visit) {
      return `${window.location.origin}/?guidedVisit=${encodeURIComponent(visit.id)}&role=teacher&directNavigator=1&dashboard=1`;
    },
    async deleteTeacherVisit(visitId) {
      if (!window.confirm("Eliminare questa visita guidata?")) return;
      try {
        await api(`/guided-visits/${enc(visitId)}`, { method: "DELETE", credentials: "include" });
        this.showToast("Visita guidata eliminata");
        this.loadTeacherSavedVisits();
      } catch (e) {
        this.showToast("Errore eliminazione visita guidata: " + e.message, "error");
      }
    },

    // helper formattazione esposti al markup
    fmtPrezzo(p) { return formatPrezzo(p, (k) => this.mp(k)); },
    fmtEuro(p) { return formatEuroAmount(p); },
  };
}
