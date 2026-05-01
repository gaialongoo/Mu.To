import { useEffect, useRef, useState } from "react";
import { getStoredNavLang, useNavLang } from "../i18n/NavLangContext";

declare global {
  interface Window {
    getMuseoSession?: () => any;
  }
}

/* ===================== SESSION / COOKIE ===================== */

const COOKIE_NAME = "museo_session";
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

type Session = {
  museo: string;
  percorso: string[];
  createdAt: number;
  livello?: string;
  durata?: string;
  guideRole?: "teacher" | "student";
  guidedVisitId?: string;
  guidedParticipantToken?: string;
  guidedCustomDescriptions?: Record<string, string>;
  guidedTextSteps?: Array<{ id?: string; room: string; text: string }>;
  guidedVirtualObjects?: Record<string, { room: string; label?: string; descrizioni?: string[][] }>;
  guidedFlowNodes?: string[];
};

function getSession(): Session | null {
  const match = document.cookie.match(
    new RegExp("(^| )" + COOKIE_NAME + "=([^;]+)")
  );
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[2]));
  } catch {
    return null;
  }
}

function clearSessionCookies() {
  const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
  document.cookie = `${COOKIE_NAME}=; expires=${expired}; path=/; SameSite=Lax`;
  document.cookie = `museo=; expires=${expired}; path=/; SameSite=Lax`;
  document.cookie = `percorso=; expires=${expired}; path=/; SameSite=Lax`;
}

function isSessionValid(session: Session | null): session is Session {
  if (!session) return false;
  if (!session.museo) return false;
  if (!Array.isArray(session.percorso)) return false;
  if (session.percorso.length < 1) return false;
  const age = Date.now() - session.createdAt;
  return age >= 0 && age <= SESSION_MAX_AGE;
}

/* ===================== CONFIG ===================== */

const SVG_SERVER_BASE = "/svg";
const API_BASE = "/api";
const MOBILE_BREAKPOINT = 768;

/* ===================== STANZA / PATH LOGIC ===================== */

type ParsedStanza = {
  stanza: string;
  svgPath: string | null;
};

function parseStanzaFromUrl(session: Session): ParsedStanza {
  const raw = new URLSearchParams(window.location.search).get("stanza");
  if (!raw) return { stanza: session.percorso[0], svgPath: null };
  const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  const parts = decoded.split("/").map(p => p.trim()).filter(Boolean);
  return {
    stanza: parts[0] ?? session.percorso[0],
    svgPath: parts.length > 1 ? parts.slice(1).join("/") : null,
  };
}

function getCurrentPathEndpointsFromUrl(session: Session): { from: string | null; to: string | null } {
  const { svgPath } = parseStanzaFromUrl(session);
  if (!svgPath) return { from: null, to: null };
  const parts = svgPath.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3 && normalize(parts[0]) === "path") {
    return { from: parts[1] || null, to: parts[2] || null };
  }
  return { from: null, to: null };
}

function computeSvgUrl(session: Session): string {
  const { svgPath } = parseStanzaFromUrl(session);
  const museo = encodeURIComponent(session.museo);
  const base = svgPath
    ? `${SVG_SERVER_BASE}/${museo}/${svgPath}`
    : `${SVG_SERVER_BASE}/${museo}`;
  if (session.guidedVisitId) {
    return `${base}?guidedVisitId=${encodeURIComponent(session.guidedVisitId)}`;
  }
  return base;
}

/* ===================== TYPES ===================== */

type Point = { x: number; y: number };

type Room = {
  label: string;
  rect: SVGRectElement;
  center: Point;
};

type Corridor = {
  rect: SVGRectElement;
  center: Point;
  orientation: "vertical" | "horizontal";
};

type Link = {
  from: Point;
  to: Point;
  label: string;
  corridor: Corridor;
  fromRoom: Room;
};

type RectBox = { x: number; y: number; w: number; h: number };
type NavigatorZoomProfile = {
  extraLeftRatio: number;
  extraRightRatio: number;
  extraTopRatio: number;
  extraBottomRatio: number;
};

type NavigatorGraphCache = {
  // corridorsNearRoom[i] = indici delle corridor con distanza <= 230 da room i
  corridorsNearRoom: number[][];
  // roomsWithinCorridor[j] = indici delle room con distanza < 230 dalla corridor j
  roomsWithinCorridor: number[][];
};

/* ===================== COMPONENT ===================== */

export default function SvgViewer() {
  const { t, lang } = useNavLang();

  useEffect(() => {
    const clearPrefs = () => {
      cachedUserPreferences = null;
    };
    window.addEventListener("mu-nav-lang-changed", clearPrefs);
    return () => window.removeEventListener("mu-nav-lang-changed", clearPrefs);
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [availableQuickRooms, setAvailableQuickRooms] = useState({
    shop: false,
    wc: false,
    out: false,
  });

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.classList.add("navigator-map-view");
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const prevViewport = meta?.getAttribute("content") ?? "";
    if (meta) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
      );
    }
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      document.documentElement.classList.remove("navigator-map-view");
      if (meta && prevViewport) meta.setAttribute("content", prevViewport);
    };
  }, []);

  const [focusedObject, setFocusedObject] = useState<string | null>(null);
  // Mobile: default delock (freeExplore=true). Desktop: default lock (freeExplore=false).
  const [freeExplore, setFreeExplore] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  });
  const freeExploreRef = useRef(freeExplore);
  freeExploreRef.current = freeExplore;
  const [currentStanzaLabel, setCurrentStanzaLabel] = useState<string | null>(null);
  const [currentStanzaParam, setCurrentStanzaParam] = useState<string | null>(null);
  const [svgLoadTick, setSvgLoadTick] = useState(0);
  const [roomConfirm, setRoomConfirm] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const isGuidedStudent = session?.guideRole === "student";
  const [guidedQuizState, setGuidedQuizState] = useState<any>(null);
  const [guidedQuizRequired, setGuidedQuizRequired] = useState(false);
  const [guidedQuizSubmitted, setGuidedQuizSubmitted] = useState(false);
  const [guidedQuizAnswers, setGuidedQuizAnswers] = useState<number[]>([]);
  const [guidedQuizSubmitting, setGuidedQuizSubmitting] = useState(false);
  const isGuidedTeacher = session?.guideRole === "teacher";
  const guidedStudentSyncRef = useRef<string>("");
  const [teacherPanelOpen, setTeacherPanelOpen] = useState(false);
  const [teacherVisitState, setTeacherVisitState] = useState<any>(null);
  const [teacherQuizResults, setTeacherQuizResults] = useState<any[]>([]);
  const [teacherShowResults, setTeacherShowResults] = useState(false);
  const isGuidedVisit = !!session?.guidedVisitId;

  const lockedViewBox = useRef<string | null>(null);
  /** Evita reload completo dell'SVG quando cambia solo la stanza (stesso file /svg/...). */
  const lastLoadedSvgUrlRef = useRef<string | null>(null);
  const setRoomConfirmRef = useRef(setRoomConfirm);
  setRoomConfirmRef.current = setRoomConfirm;

  useEffect(() => {
    function syncSession() {
      const s = getSession();
      if (isSessionValid(s)) setSession(s);
      else setSession(null);
    }
    syncSession();
    window.addEventListener("museo-session-ready", syncSession);
    return () => window.removeEventListener("museo-session-ready", syncSession);
  }, []);

  useEffect(() => {
    if (!session) return;
    lastLoadedSvgUrlRef.current = null;
    const url = computeSvgUrl(session);
    loadSvg(
      url,
      session,
      () => setExitConfirmOpen(true),
      () => {
        lastLoadedSvgUrlRef.current = url;
        setSvgLoadTick(t => t + 1);
      },
      !freeExploreRef.current
    );
  }, [session]);

  useEffect(() => {
    if (!session || freeExplore) return;

    const onResize = () => {
      const host = document.getElementById("svg-host");
      const svg = host?.querySelector<SVGSVGElement>("svg");
      if (!svg) return;
      fitSvgToViewport(svg);
      renderNavigation(svg, true);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [session, freeExplore]);

  useEffect(() => {
    if (!session?.museo) return;
    const host = document.getElementById("svg-host");
    const svg = host?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;
    ensureCanonicalStanzaLabels(svg);
    const labels = Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label")).map((el) =>
      normalize(stanzaLabelCanonical(el))
    );
    setAvailableQuickRooms({
      shop: labels.includes("shop"),
      wc: labels.includes("wc"),
      out: labels.includes("out"),
    });
    let cancelled = false;
    fetch(`${API_BASE}/musei/${encodeURIComponent(session.museo)}/layout`)
      .then((r) => r.json())
      .then((layout) => {
        if (cancelled) return;
        applyStanzaLabelDisplay(svg, layout?.labelI18n, lang);
        renderNavigation(svg, !freeExplore);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.museo, svgLoadTick, lang, freeExplore]);

  // HOME: blocca zoom/pan e disabilita la modalità esplora.
  useEffect(() => {
    if (!session) return;
    const sync = () => {
      const rawStanzaParam = new URLSearchParams(window.location.search).get("stanza");
      const { stanza } = parseStanzaFromUrl(session);
      setCurrentStanzaLabel(stanza);
      setCurrentStanzaParam(rawStanzaParam);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [session]);

  useEffect(() => {
    if (!currentStanzaLabel) return;
    if (normalize(currentStanzaLabel) === "home") {
      setFreeExplore(false);
    }
  }, [currentStanzaLabel]);

  useEffect(() => {
    if (!session) return;
    ensureDefaultStanza(session);
    const onPop = () => {
      const rawStanzaParam = new URLSearchParams(window.location.search).get("stanza");
      const { stanza } = parseStanzaFromUrl(session);
      const isHome = normalize(stanza) === "home";
      const stanzaChanged =
        currentStanzaLabel != null &&
        normalize(stanza) !== normalize(currentStanzaLabel);
      const stanzaParamChanged =
        currentStanzaParam != null &&
        (rawStanzaParam ?? "") !== currentStanzaParam;

      const nextUrl = computeSvgUrl(session);
      const host = document.getElementById("svg-host");
      const svg = host?.querySelector<SVGSVGElement>("svg");
      const sameSvgAsset =
        svg != null &&
        lastLoadedSvgUrlRef.current != null &&
        nextUrl === lastLoadedSvgUrlRef.current;

      if (sameSvgAsset) {
        if (isHome || stanzaChanged || stanzaParamChanged) {
          renderNavigation(svg, !freeExplore);
        }
        return;
      }

      if (!freeExplore || isHome || stanzaChanged || stanzaParamChanged) {
        loadSvg(
          nextUrl,
          session,
          () => setExitConfirmOpen(true),
          () => {
            lastLoadedSvgUrlRef.current = nextUrl;
            setSvgLoadTick(t => t + 1);
          },
          !freeExploreRef.current
        );
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [session, freeExplore, currentStanzaLabel, currentStanzaParam]);

  /** In free non disegniamo frecce; tornando in lock vanno ridisegnate sullo stesso SVG. Solo al toggle (il primo load è loadSvg). */
  useEffect(() => {
    if (!session) return;
    const host = document.getElementById("svg-host");
    const svg = host?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;
    renderNavigation(svg, !freeExplore);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evitare render sul vecchio SVG al cambio session/museo
  }, [freeExplore]);

  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      const obj = url.searchParams.get("oggetto");
      setFocusedObject(obj ? decodeURIComponent(obj) : null);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!session || !isGuidedStudent || !session.guidedVisitId || !session.guidedParticipantToken) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const syncStudentState = async () => {
      if (stop) return;
      try {
        const r = await fetch(
          `${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId || "")}/student-state?participantToken=${encodeURIComponent(session.guidedParticipantToken || "")}`
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (d.status === "removed") {
          clearSessionCookies();
          window.location.replace("/");
          return;
        }
        const questions = Array.isArray(d.quiz?.questions) ? d.quiz.questions : [];
        const hasSubmittedQuiz = d.grade != null;
        setGuidedQuizRequired(questions.length > 0);
        setGuidedQuizSubmitted(hasSubmittedQuiz);
        if (d.quizState?.status === "running" && !hasSubmittedQuiz) {
          setGuidedQuizState({ quiz: d.quiz || {}, quizState: d.quizState });
        } else {
          setGuidedQuizState(null);
        }
        const currentObjectName = String(d.currentObjectName || "").trim();
        const previousObjectName = String(d.previousObjectName || "IN").trim() || "IN";
        if (!currentObjectName) return;
        const signature = `${previousObjectName}=>${currentObjectName}`;
        if (guidedStudentSyncRef.current === signature) return;
        guidedStudentSyncRef.current = signature;
        let stanzaObj = "";
        if (String(currentObjectName).startsWith("__text__")) {
          stanzaObj = String(d.currentRoom || "").trim();
          if (!stanzaObj) return;
          const nextUrl = `/?stanza=${encodeURIComponent(stanzaObj)}/path/${encodeURIComponent(previousObjectName)}/${encodeURIComponent(currentObjectName)}`;
          window.history.pushState({}, "", nextUrl);
          window.dispatchEvent(new PopStateEvent("popstate"));
          return;
        } else if (isSpecialRouteNode(currentObjectName)) {
          if (!previousObjectName || isSpecialRouteNode(previousObjectName)) return;
          stanzaObj = await fetchObjectRoom(session.museo, previousObjectName);
        } else {
          stanzaObj = await fetchObjectRoom(session.museo, currentObjectName);
        }
        const nextUrl = `/?stanza=${encodeURIComponent(stanzaObj)}/path/${encodeURIComponent(previousObjectName)}/${encodeURIComponent(currentObjectName)}`;
        window.history.pushState({}, "", nextUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch {
        // ignore temporary polling failures
      } finally {
        if (!stop) timer = setTimeout(syncStudentState, 2500);
      }
    };

    syncStudentState();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, isGuidedStudent]);

  useEffect(() => {
    if (!session || !isGuidedTeacher || !session.guidedVisitId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadTeacherState = async () => {
      if (stop) return;
      try {
        const r = await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId || "")}/teacher-state`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (r.ok) setTeacherVisitState(d.visit || null);
        if (teacherShowResults) {
          const rr = await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId || "")}/results`, { credentials: "include" });
          const rd = await rr.json().catch(() => ({}));
          if (rr.ok) setTeacherQuizResults(Array.isArray(rd.results) ? rd.results : []);
        }
      } catch {
        // ignore transient failures
      } finally {
        if (!stop) timer = setTimeout(loadTeacherState, 2500);
      }
    };
    loadTeacherState();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, isGuidedTeacher, teacherShowResults]);

  useEffect(() => {
    if (!isGuidedTeacher) return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("dashboard") === "1") {
      setTeacherPanelOpen(true);
      qs.delete("dashboard");
      const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    }
  }, [isGuidedTeacher]);

  /* ---- modalità esplora / lock ---- */
  useEffect(() => {
    const host = document.getElementById("svg-host");
    const svg = host?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;

    const objectOverlayBlocksMapGestures = () => focusedObject != null;

    const blockWheel = (e: WheelEvent) => e.preventDefault();
    const blockPinch = (e: TouchEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (e.touches.length >= 2) e.preventDefault();
    };

    if (!freeExplore) {
      if (lockedViewBox.current) {
        svg.setAttribute("viewBox", lockedViewBox.current);
        lockedViewBox.current = null;
      }
      svg.style.cursor = "";
      const navLayerLock = svg.querySelector<SVGGElement>("#nav-layer");
      if (navLayerLock) {
        navLayerLock.querySelectorAll<SVGGElement>("g").forEach(g => {
          g.style.display = "";
        });
      }
      svg.addEventListener("wheel", blockWheel, { passive: false });
      svg.addEventListener("touchmove", blockPinch, { passive: false });
      return () => {
        svg.removeEventListener("wheel", blockWheel);
        svg.removeEventListener("touchmove", blockPinch);
      };
    }

    // FREE MODE
    lockedViewBox.current = svg.getAttribute("viewBox");
    // In modalità libera manteniamo l'inquadratura attuale della stanza:
    // evitiamo il salto automatico alla mappa intera (effetto dezoom).
    svg.style.cursor = "grab";

    const navLayer = svg.querySelector<SVGGElement>("#nav-layer");
    if (navLayer) {
      navLayer.querySelectorAll<SVGGElement>("g").forEach(g => {
        g.style.display = "none";
      });
    }

    const stanzaRects = Array.from(svg.querySelectorAll<SVGRectElement>("rect.stanza"));
    for (const rect of stanzaRects) {
      rect.style.cursor = "grab";
      if (!rect.getAttribute("fill") || rect.getAttribute("fill") === "none") {
        rect.setAttribute("fill", "transparent");
      }
      rect.style.pointerEvents = "all";
    }

    let dragging = false;
    let didDrag = false;
    let isPinching = false;
    let startX = 0;
    let startY = 0;
    let vbSnapshot = { x: 0, y: 0, w: 1, h: 1 };
    let lastPinchDist = 0;

    const getVB = () => {
      const v = svg.getAttribute("viewBox")!.split(" ").map(Number);
      return { x: v[0], y: v[1], w: v[2], h: v[3] };
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return !!target.closest(
        "circle.oggetto, image[data-nome], g.exit-room-cta, .exit-room-cta, text.exit-room-label"
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (isPinching) return;
      if (isInteractiveTarget(e.target)) return;
      dragging = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      vbSnapshot = getVB();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (!dragging || isPinching) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 9) {
        didDrag = true;
        svg.style.cursor = "grabbing";
      }
      if (!didDrag) return;
      const svgRect = svg.getBoundingClientRect();
      const scaleX = vbSnapshot.w / svgRect.width;
      const scaleY = vbSnapshot.h / svgRect.height;
      svg.setAttribute(
        "viewBox",
        `${vbSnapshot.x - dx * scaleX} ${vbSnapshot.y - dy * scaleY} ${vbSnapshot.w} ${vbSnapshot.h}`
      );
    };

    const onPointerUp = () => {
      if (objectOverlayBlocksMapGestures()) return;
      if (!dragging || isPinching) return;
      dragging = false;
      svg.style.cursor = "grab";
      if (didDrag) {
        const consumeNonInteractiveClick = (e: MouseEvent) => {
          if (isInteractiveTarget(e.target)) return;
          e.stopPropagation();
          e.preventDefault();
        };
        window.addEventListener(
          "click",
          consumeNonInteractiveClick,
          { capture: true, once: true }
        );
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      e.preventDefault();
      const { x, y, w, h } = getVB();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      const svgRect = svg.getBoundingClientRect();
      const mx = x + ((e.clientX - svgRect.left) / svgRect.width) * w;
      const my = y + ((e.clientY - svgRect.top) / svgRect.height) * h;
      svg.setAttribute(
        "viewBox",
        `${mx - (mx - x) * factor} ${my - (my - y) * factor} ${w * factor} ${h * factor}`
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (e.touches.length === 2) {
        isPinching = true;
        dragging = false;
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (e.touches.length < 2) {
        isPinching = false;
        lastPinchDist = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (objectOverlayBlocksMapGestures()) return;
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist === 0) { lastPinchDist = dist; return; }
      const factor = lastPinchDist / dist;
      lastPinchDist = dist;
      const { x, y, w, h } = getVB();
      const svgRect = svg.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const mx = x + ((cx - svgRect.left) / svgRect.width) * w;
      const my = y + ((cy - svgRect.top) / svgRect.height) * h;
      svg.setAttribute(
        "viewBox",
        `${mx - (mx - x) * factor} ${my - (my - y) * factor} ${w * factor} ${h * factor}`
      );
    };

    svg.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      for (const rect of stanzaRects) {
        rect.style.cursor = "";
      }
      svg.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("touchmove", onTouchMove);
      svg.style.cursor = "";
    };
  }, [freeExplore, session, currentStanzaLabel, svgLoadTick, focusedObject]);

  const handleRoomConfirm = (label: string) => {
    setRoomConfirm(null);
    const s = getSession();
    if (!s) return;
    const { svgPath } = parseStanzaFromUrl(s);
    const value = svgPath ? `${label}/${svgPath}` : label;
    const url = new URL(window.location.href);
    url.searchParams.set("stanza", value);
    window.history.pushState({}, "", url);
    lockedViewBox.current = null;
    setTimeout(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, 0);
  };

  const handleExitConfirm = () => {
    if (isGuidedStudent && guidedQuizRequired && !guidedQuizSubmitted) {
      setExitConfirmOpen(false);
      alert(t("quizBlockExit"));
      return;
    }
    clearSessionCookies();
    setExitConfirmOpen(false);
    setRoomConfirm(null);
    setFocusedObject(null);
    lockedViewBox.current = null;
    setFreeExplore(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("stanza");
    url.searchParams.delete("oggetto");
    window.location.replace(url.toString());
  };

  const handleQuickRoomNavigate = async (roomLabel: string) => {
    if (!session) return;
    const percorso = Array.isArray(session.percorso) ? session.percorso : [];
    const fallbackFrom = percorso.length > 1 ? percorso[1] : null;
    const { from: fromInUrl } = getCurrentPathEndpointsFromUrl(session);
    const currentFrom =
      focusedObject ||
      fromInUrl ||
      fallbackFrom;

    if (!currentFrom) return;

    try {
      const stanzaFromObj = isSpecialRouteNode(currentFrom)
        ? (currentStanzaLabel || currentFrom)
        : await fetchObjectRoom(session.museo, currentFrom);
      const nextUrl = `/?stanza=${encodeURIComponent(stanzaFromObj)}/path/${encodeURIComponent(currentFrom)}/${encodeURIComponent(roomLabel)}`;
      setFocusedObject(null);
      window.history.pushState({}, "", nextUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Errore navigazione rapida stanza:", err);
    }
  };

  const handleResumePath = async () => {
    if (!session) return;
    const percorso = Array.isArray(session.percorso) ? session.percorso : [];
    const { from: fromInUrl, to: toInUrl } = getCurrentPathEndpointsFromUrl(session);
    const from = fromInUrl;
    if (!from || !isSpecialRouteNode(toInUrl || "")) return;
    const idx = percorso.indexOf(from);
    if (idx < 0 || idx >= percorso.length - 1) return;
    const next = percorso[idx + 1];
    if (!next) return;
    try {
      const stanzaFromObj = isSpecialRouteNode(from)
        ? (currentStanzaLabel || from)
        : await fetchObjectRoom(session.museo, from);
      const nextUrl = `/?stanza=${encodeURIComponent(stanzaFromObj)}/path/${encodeURIComponent(from)}/${encodeURIComponent(next)}`;
      setFocusedObject(null);
      window.history.pushState({}, "", nextUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Errore ripresa percorso:", err);
    }
  };

  const { from: fromInUrl, to: toInUrl } = session ? getCurrentPathEndpointsFromUrl(session) : { from: null, to: null };
  const canResumePath = !!session
    && !!fromInUrl
    && isSpecialRouteNode(toInUrl || "")
    && normalize(toInUrl || "") !== "out"
    && Array.isArray(session.percorso)
    && session.percorso.indexOf(fromInUrl) >= 0
    && session.percorso.indexOf(fromInUrl) < session.percorso.length - 1;

  const submitGuidedQuiz = async () => {
    if (!session?.guidedVisitId || !session?.guidedParticipantToken || !guidedQuizState?.quiz) return;
    try {
      setGuidedQuizSubmitting(true);
      const r = await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId)}/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantToken: session.guidedParticipantToken,
          answers: guidedQuizAnswers,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t("quizSubmitFail"));
      alert(`${t("quizScoreIntro")}${d.grade}/100`);
      setGuidedQuizSubmitted(true);
      setGuidedQuizState(null);
    } catch (err: any) {
      alert(err?.message || t("quizSubmitFail"));
    } finally {
      setGuidedQuizSubmitting(false);
    }
  };

  const teacherPost = async (path: string, body: any = {}) => {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Operazione non riuscita");
    return d;
  };

  const teacherAccept = async (participantId: string) => {
    if (!session?.guidedVisitId) return;
    await teacherPost(`/guided-visits/${encodeURIComponent(session.guidedVisitId)}/participants/${encodeURIComponent(participantId)}/accept`);
  };
  const teacherRemove = async (participantId: string) => {
    if (!session?.guidedVisitId) return;
    await teacherPost(`/guided-visits/${encodeURIComponent(session.guidedVisitId)}/participants/${encodeURIComponent(participantId)}/remove`);
  };
  const teacherAcceptAll = async () => {
    if (!session?.guidedVisitId) return;
    await teacherPost(`/guided-visits/${encodeURIComponent(session.guidedVisitId)}/participants/accept-all`);
  };
  const teacherStartQuiz = async () => {
    if (!session?.guidedVisitId) return;
    const secRaw = prompt(t("quizPromptSeconds"), String(teacherVisitState?.quiz?.timeLimitSec || 120));
    const sec = Number(secRaw);
    await teacherPost(`/guided-visits/${encodeURIComponent(session.guidedVisitId)}/quiz/start`, Number.isFinite(sec) ? { timeLimitSec: sec } : {});
  };

  if (!session) return <div style={{ padding: 20 }}>{t("loading")}</div>;

  const objectDetailOverlayOpen = focusedObject != null;
  const blockMapChromeWhileObjectOpen = objectDetailOverlayOpen
    ? { pointerEvents: "none" as const }
    : {};

  return (
    <div
      className="svg-viewer-root"
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {!isGuidedVisit && (
        <button
          onClick={() => setExitConfirmOpen(true)}
          title={t("exitTitle")}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 1001,
            border: "none",
            borderRadius: 10,
            background: "rgba(200, 32, 32, 0.9)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.05em",
            padding: "8px 12px",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            ...blockMapChromeWhileObjectOpen,
          }}
        >
          {t("exit")}
        </button>
      )}

      {isGuidedTeacher && session?.guidedVisitId && (
        <button
          onClick={() => setTeacherPanelOpen(true)}
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            zIndex: 1001,
            border: "none",
            borderRadius: 10,
            background: "rgba(24,95,165,0.92)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.05em",
            padding: "8px 12px",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            ...blockMapChromeWhileObjectOpen,
          }}
        >
          {t("dashboardClass")}
        </button>
      )}

      <button
        onClick={() => {
          if (normalize(currentStanzaLabel ?? "") === "home") return;
          setFreeExplore(prev => !prev);
        }}
        title={
          normalize(currentStanzaLabel ?? "") === "home"
            ? t("zoomDisabledHome")
            : freeExplore
              ? t("lockView")
              : t("freeExplore")
        }
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 1000,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "none",
          background: freeExplore ? "rgba(15,110,86,0.90)" : "rgba(24,95,165,0.90)",
          color: "#fff",
          fontSize: 20,
          lineHeight: "44px",
          textAlign: "center",
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          transition: "background 0.2s ease, transform 0.15s ease",
          userSelect: "none",
          padding: 0,
          ...blockMapChromeWhileObjectOpen,
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
        disabled={normalize(currentStanzaLabel ?? "") === "home"}
      >
        {freeExplore ? "🔒" : "🗺"}
      </button>

      {freeExplore && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            zIndex: 1000,
            background: "rgba(15,110,86,0.88)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.5,
            padding: "8px 12px",
            borderRadius: 10,
            maxWidth: 180,
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {t("dragHint")}<br />
          {t("pinchHint")}
        </div>
      )}

      {!isGuidedVisit && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 1000,
            display: "flex",
            gap: 8,
            background: "rgba(0,0,0,0.45)",
            padding: "8px 10px",
            borderRadius: 10,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            ...blockMapChromeWhileObjectOpen,
          }}
        >
          {[
            { key: "shop", label: "SHOP" },
            { key: "wc", label: "WC" },
            { key: "out", label: "OUT" },
          ].map((item) => {
            const enabled = availableQuickRooms[item.key as keyof typeof availableQuickRooms];
            return (
              <button
                key={item.key}
                onClick={() => enabled && !isGuidedStudent && handleQuickRoomNavigate(item.label)}
                disabled={!enabled || isGuidedStudent}
                style={{
                  border: "1px solid rgba(255,255,255,0.28)",
                  background: enabled ? "rgba(24,95,165,0.9)" : "rgba(90,90,90,0.4)",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  cursor: enabled && !isGuidedStudent ? "pointer" : "not-allowed",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
      {canResumePath && !isGuidedStudent && (
        <button
          onClick={handleResumePath}
          style={{
            position: "fixed",
            left: 16,
            bottom: 74,
            zIndex: 1001,
            border: "1px solid rgba(255,255,255,0.3)",
            background: "rgba(15,110,86,0.92)",
            color: "#fff",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            ...blockMapChromeWhileObjectOpen,
          }}
        >
          {t("resumePath")}
        </button>
      )}

      <div
        id="svg-host"
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          touchAction: "none",
          pointerEvents: objectDetailOverlayOpen ? "none" : "auto",
        }}
      />

      {roomConfirm && (
        <div
          onClick={() => setRoomConfirm(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff",
              padding: "24px 28px",
              borderRadius: 14,
              minWidth: 280,
              maxWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 13, color: "#666" }}>
              {t("roomConfirmIntro")}
            </p>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 600 }}>
              {roomConfirm}
            </h3>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => handleRoomConfirm(roomConfirm)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                  background: "#185FA5", color: "#fff", fontWeight: 600,
                  fontSize: 14, cursor: "pointer",
                }}
              >
                {t("roomGo")}
              </button>
              <button
                onClick={() => setRoomConfirm(null)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "1.5px solid #ccc", background: "transparent",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitConfirmOpen && (
        <div
          onClick={() => setExitConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff",
              padding: "24px 28px",
              borderRadius: 14,
              minWidth: 280,
              maxWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>
              {t("exitConfirmTitle")}
            </p>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 600 }}>
              {t("exitConfirmBody")}
            </h3>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleExitConfirm}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                  background: "#C72020", color: "#fff", fontWeight: 600,
                  fontSize: 14, cursor: "pointer",
                }}
              >
                {t("exitYes")}
              </button>
              <button
                onClick={() => setExitConfirmOpen(false)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "1.5px solid #ccc", background: "transparent",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {teacherPanelOpen && isGuidedTeacher && (
        <div
          onClick={() => setTeacherPanelOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9400,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(920px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "#fff", color: "#111", borderRadius: 14, padding: "16px 18px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{t("teacherDashboardTitle")}</h3>
              <button onClick={() => setTeacherPanelOpen(false)} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <p style={{ marginTop: 0, color: "#555", marginBottom: 12 }}>
              {teacherVisitState?.nome || "Visita"} - {teacherVisitState?.museo || ""}
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button onClick={() => teacherAcceptAll().catch((e) => alert(e.message))} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", background: "#f8f8f8", cursor: "pointer" }}>
                {t("teacherAcceptAll")}
              </button>
              <button onClick={() => teacherStartQuiz().catch((e) => alert(e.message))} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #185FA5", background: "#185FA5", color: "#fff", cursor: "pointer" }}>
                {t("teacherStartQuiz")}
              </button>
              <button onClick={() => setTeacherShowResults((v) => !v)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>
                {teacherShowResults ? t("teacherHideResults") : t("teacherShowResults")}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, background: "#fafafa" }}>
                <strong>{t("teacherWaiting")}</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {(Array.isArray(teacherVisitState?.participants) ? teacherVisitState.participants : [])
                    .filter((p: any) => p.status === "waiting")
                    .map((p: any) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span>{p.displayName}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => teacherAccept(p.id).catch((e) => alert(e.message))} style={{ border: "1px solid #2f8f4e", background: "#e9fff0", borderRadius: 6, cursor: "pointer" }}>{t("teacherAccept")}</button>
                          <button onClick={() => teacherRemove(p.id).catch((e) => alert(e.message))} style={{ border: "1px solid #a33", background: "#ffecec", borderRadius: 6, cursor: "pointer" }}>{t("teacherReject")}</button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
              <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, background: "#fafafa" }}>
                <strong>{t("teacherInside")}</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {(Array.isArray(teacherVisitState?.participants) ? teacherVisitState.participants : [])
                    .filter((p: any) => p.status === "accepted")
                    .map((p: any, idx: number) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span>{idx + 1}. {p.displayName}</span>
                        <button onClick={() => teacherRemove(p.id).catch((e) => alert(e.message))} style={{ border: "1px solid #a33", background: "#ffecec", borderRadius: 6, cursor: "pointer" }}>{t("teacherRemove")}</button>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {teacherShowResults && (
              <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
                <strong>{t("teacherQuizResults")}</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {teacherQuizResults.length < 1
                    ? <span style={{ color: "#666" }}>{t("teacherNoResults")}</span>
                    : teacherQuizResults
                        .slice()
                        .sort((a, b) => (Number(b.grade) || -1) - (Number(a.grade) || -1))
                        .map((r: any) => (
                          <div key={r.id || r.displayName} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{r.displayName}</span>
                            <span>{r.grade == null ? "-" : `${r.grade}/100`}</span>
                          </div>
                        ))
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {guidedQuizState?.quiz && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9600,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{ width: "min(760px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "#fff", borderRadius: 14, padding: "18px 20px" }}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{guidedQuizState.quiz.title || t("quizFinalTitle")}</h3>
            <p style={{ marginTop: 0, color: "#666", fontSize: 13 }}>
              {t("quizMaxTime")} {guidedQuizState.quizState?.timeLimitSec || guidedQuizState.quiz?.timeLimitSec || 120} {t("quizSeconds")}
            </p>
            {(Array.isArray(guidedQuizState.quiz.questions) ? guidedQuizState.quiz.questions : []).map((q: any, qIdx: number) => (
              <div key={q.id || `q-${qIdx}`} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>{qIdx + 1}. {q.question}</p>
                {(Array.isArray(q.options) ? q.options : []).map((opt: string, optIdx: number) => (
                  <label key={`${qIdx}-${optIdx}`} style={{ display: "block", marginBottom: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name={`guided-quiz-${qIdx}`}
                      checked={guidedQuizAnswers[qIdx] === optIdx}
                      onChange={() => setGuidedQuizAnswers((prev) => {
                        const next = [...prev];
                        next[qIdx] = optIdx;
                        return next;
                      })}
                      style={{ marginRight: 8 }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={submitGuidedQuiz}
              disabled={guidedQuizSubmitting}
              style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: "#185FA5", color: "#fff", cursor: "pointer" }}
            >
              {guidedQuizSubmitting ? t("quizSending") : t("quizSend")}
            </button>
          </div>
        </div>
      )}

      {focusedObject && (
        <ObjectOverlay
          nome={focusedObject}
          session={session}
          onClose={closeObjectFocus}
          showNav={!isGuidedStudent}
          domDataObjectType={readDomDataObjectType(focusedObject)}
        />
      )}
    </div>
  );
}

/* ===================== ROOM LABEL I18N (display only; IDs restano in italiano) ===================== */

function stanzaLabelCanonical(el: SVGTextElement): string {
  const id = el.getAttribute("data-stanza-id");
  if (id != null && id !== "") return id.trim();
  return (el.textContent ?? "").trim();
}

function ensureCanonicalStanzaLabels(svg: SVGSVGElement) {
  for (const el of Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"))) {
    if (!el.getAttribute("data-stanza-id")) {
      const raw = (el.textContent ?? "").trim();
      if (raw) el.setAttribute("data-stanza-id", raw);
    }
  }
}

function applyStanzaLabelDisplay(svg: SVGSVGElement, labelI18n: unknown, navLang: string) {
  const stanze =
    labelI18n &&
    typeof labelI18n === "object" &&
    labelI18n !== null &&
    "stanze" in labelI18n &&
    typeof (labelI18n as { stanze?: unknown }).stanze === "object"
      ? (labelI18n as { stanze: Record<string, { en?: string; fr?: string }> }).stanze
      : null;
  for (const el of Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"))) {
    const canon = stanzaLabelCanonical(el);
    if (!canon) continue;
    if (navLang === "it" || !stanze) {
      el.textContent = canon;
      continue;
    }
    const entry = stanze[canon];
    const raw =
      navLang === "en" ? entry?.en : navLang === "fr" ? entry?.fr : undefined;
    const tr = typeof raw === "string" ? raw.trim() : "";
    el.textContent = tr || canon;
  }
}

/* ===================== ROOM LABEL FINDER ===================== */

function findRoomLabel(svg: SVGSVGElement, rect: SVGRectElement): string | null {
  let sibling = rect.nextElementSibling;
  while (sibling) {
    if (
      sibling.tagName === "text" &&
      (sibling.getAttribute("class") ?? "").includes("stanza-label")
    ) {
      return stanzaLabelCanonical(sibling as SVGTextElement) || null;
    }
    if (
      sibling.tagName === "rect" &&
      (sibling.getAttribute("class") ?? "").includes("stanza")
    ) break;
    sibling = sibling.nextElementSibling;
  }

  const cx = +rect.getAttribute("x")! + +rect.getAttribute("width")! / 2;
  const cy = +rect.getAttribute("y")! + +rect.getAttribute("height")! / 2;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const t of Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"))) {
    const tx = +(t.getAttribute("x") ?? 0);
    const ty = +(t.getAttribute("y") ?? 0);
    const d = Math.hypot(tx - cx, ty - cy);
    if (d < bestDist) { bestDist = d; best = stanzaLabelCanonical(t) || null; }
  }
  if (best) return best;

  return null;
}

/* ===================== SVG LOADER ===================== */

function loadSvg(
  url: string,
  session: Session,
  onExitRequested: () => void,
  onLoaded?: () => void,
  showDirectionArrows = true
) {
  const host = document.getElementById("svg-host");
  if (!host) return;
  fetch(url)
    .then(r => r.text())
    .then(svgText => {
      host.innerHTML = svgText;
      const svg = host.querySelector<SVGSVGElement>("svg");
      if (!svg) return;
      ensureCanonicalStanzaLabels(svg);
      svg.style.transform = "";
      fitSvgToViewport(svg);
      svg.setAttribute("overflow", "visible");
      svg.style.overflow = "visible";

      const navLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      navLayer.setAttribute("id", "nav-layer");
      svg.appendChild(navLayer);

      renderNavigation(svg, showDirectionArrows);
      bindObjectClicks(svg, session);
      renderGuidedTextMarkers(svg, session);
      mountExitInOutRoom(svg, onExitRequested);
      onLoaded?.();
    });
}

function renderGuidedTextMarkers(svg: SVGSVGElement, session: Session) {
  if (session?.guidedVisitId) return;
  const textSteps = Array.isArray(session?.guidedTextSteps) ? session.guidedTextSteps : [];
  if (textSteps.length < 1) return;
  const byRoom = new Map<string, string>();
  for (const step of textSteps) {
    const room = String(step?.room || "").trim();
    if (!room) continue;
    if (!byRoom.has(normalize(room))) byRoom.set(normalize(room), String(step?.text || "").trim());
  }
  if (byRoom.size < 1) return;

  const ns = "http://www.w3.org/2000/svg";
  const rooms = Array.from(svg.querySelectorAll<SVGRectElement>("rect.stanza"));
  const labels = Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"));

  const roomCenterByLabel = new Map<string, { x: number; y: number }>();
  for (const labelEl of labels) {
    const name = normalize(stanzaLabelCanonical(labelEl));
    if (!name || !byRoom.has(name)) continue;
    const tx = Number(labelEl.getAttribute("x") || 0);
    const ty = Number(labelEl.getAttribute("y") || 0);
    let bestRect: SVGRectElement | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const rect of rooms) {
      const cx = Number(rect.getAttribute("x") || 0) + Number(rect.getAttribute("width") || 0) / 2;
      const cy = Number(rect.getAttribute("y") || 0) + Number(rect.getAttribute("height") || 0) / 2;
      const d = Math.hypot(cx - tx, cy - ty);
      if (d < bestDist) {
        bestDist = d;
        bestRect = rect;
      }
    }
    if (!bestRect) continue;
    roomCenterByLabel.set(name, {
      x: Number(bestRect.getAttribute("x") || 0) + Number(bestRect.getAttribute("width") || 0) / 2,
      y: Number(bestRect.getAttribute("y") || 0) + Number(bestRect.getAttribute("height") || 0) / 2,
    });
  }

  const textNodeByRoom = new Map<string, string>();
  for (const [nodeName, nodeData] of Object.entries(session?.guidedVirtualObjects || {})) {
    const room = normalize(String(nodeData?.room || ""));
    if (room && !textNodeByRoom.has(room)) textNodeByRoom.set(room, nodeName);
  }

  for (const [roomLabel] of byRoom.entries()) {
    const center = roomCenterByLabel.get(roomLabel);
    if (!center) continue;
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "guided-text-marker");
    g.style.cursor = "pointer";
    g.style.pointerEvents = "all";
    g.setAttribute("transform", `translate(${center.x}, ${center.y})`);

    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "0");
    c.setAttribute("cy", "0");
    c.setAttribute("r", "10");
    c.setAttribute("class", "oggetto");
    g.appendChild(c);

    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", "0");
    t.setAttribute("y", "3");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    t.setAttribute("class", "oggetto-label");
    t.textContent = "?";
    g.appendChild(t);
    const textNode = textNodeByRoom.get(roomLabel);
    if (textNode) {
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        openObjectFocus(textNode);
      });
    }

    svg.appendChild(g);
  }
}

function fitSvgToViewport(svg: SVGSVGElement) {
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Manteniamo le dimensioni native dell'SVG e limitiamo solo l'overflow
  // per non perdere lo zoom sulla stanza corrente.
  svg.style.maxWidth = "100%";
  svg.style.maxHeight = "100%";
  svg.style.display = "block";
}

/** Tipo oggetto dall'SVG (item testo = "text", mostra "?"): serve a nascondere la chat subito */
function readDomDataObjectType(nome: string): string | null {
  const svg = document.getElementById("svg-host")?.querySelector<SVGSVGElement>("svg");
  if (!svg || !nome) return null;
  for (const el of svg.querySelectorAll<SVGCircleElement>("circle.oggetto[data-object-name]")) {
    if (el.getAttribute("data-object-name") === nome) {
      const t = (el.getAttribute("data-object-type") || "").trim().toLowerCase();
      return t || null;
    }
  }
  for (const el of svg.querySelectorAll<SVGTextElement>("text.oggetto-label[data-object-name]")) {
    if (el.getAttribute("data-object-name") === nome) {
      const t = (el.getAttribute("data-object-type") || "").trim().toLowerCase();
      return t || null;
    }
  }
  for (const el of svg.querySelectorAll<SVGImageElement>("image[data-nome]")) {
    if (el.getAttribute("data-nome") === nome) {
      const t = (el.getAttribute("data-object-type") || "").trim().toLowerCase();
      if (t) return t;
    }
  }
  return null;
}

function mountExitInOutRoom(svg: SVGSVGElement, onExitRequested: () => void) {
  const outLabel = Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"))
    .find(label => normalize(stanzaLabelCanonical(label)) === "out");

  if (!outLabel) return;

  const outRoomRect = Array.from(svg.querySelectorAll<SVGRectElement>("rect.stanza"))
    .find(rect => normalize(findRoomLabel(svg, rect) ?? "") === "out");

  const centerX = outRoomRect
    ? Number(outRoomRect.getAttribute("x") ?? 0) + Number(outRoomRect.getAttribute("width") ?? 0) / 2
    : Number(outLabel.getAttribute("x") ?? 0);
  const centerY = outRoomRect
    ? Number(outRoomRect.getAttribute("y") ?? 0) + Number(outRoomRect.getAttribute("height") ?? 0) / 2
    : Number(outLabel.getAttribute("y") ?? 0);

  const ns = "http://www.w3.org/2000/svg";
  const exitGroup = document.createElementNS(ns, "g");
  exitGroup.setAttribute("class", "exit-room-cta");
  exitGroup.style.cursor = "pointer";

  // Area tap più ampia del solo glifo (mobile)
  const hitW = 120;
  const hitH = 48;
  const hitRect = document.createElementNS(ns, "rect");
  hitRect.setAttribute("x", String(centerX - hitW / 2));
  hitRect.setAttribute("y", String(centerY - hitH / 2));
  hitRect.setAttribute("width", String(hitW));
  hitRect.setAttribute("height", String(hitH));
  hitRect.setAttribute("fill", "transparent");
  hitRect.setAttribute("pointer-events", "all");

  const exitText = document.createElementNS(ns, "text");
  exitText.setAttribute("x", String(centerX));
  exitText.setAttribute("y", String(centerY + 1));
  exitText.setAttribute("text-anchor", "middle");
  exitText.setAttribute("dominant-baseline", "middle");
  exitText.setAttribute("class", "exit-room-label");
  exitText.setAttribute("fill", "#ff2b2b");
  exitText.setAttribute("stroke", "#630000");
  exitText.setAttribute("stroke-width", "1.1");
  exitText.textContent = "EXIT";

  const triggerExit = (e: Event) => {
    e.stopPropagation();
    onExitRequested();
  };
  exitGroup.appendChild(hitRect);
  exitGroup.appendChild(exitText);
  exitGroup.addEventListener("click", triggerExit);
  svg.appendChild(exitGroup);
}

/* ===================== NAVIGATION ===================== */

function renderNavigation(svg: SVGSVGElement, showDirectionArrows = true) {
  const navLayer = svg.querySelector("#nav-layer") as SVGGElement;
  if (!navLayer) return;
  navLayer.innerHTML = "";

  const session = getSession();
  if (!session) return;

  const { stanza, svgPath } = parseStanzaFromUrl(session);
  const corridors = extractCorridors(svg);
  const rooms = extractRooms(svg);

  let current = rooms.find(r => normalize(r.label) === normalize(stanza));
  if (!current) {
    const fallbackStanza = session.percorso[0];
    current = rooms.find(r => normalize(r.label) === normalize(fallbackStanza));
    if (current) {
      const value = svgPath ? `${current.label}/${svgPath}` : current.label;
      const url = new URL(window.location.href);
      url.searchParams.set("stanza", value);
      window.history.replaceState({}, "", url);
    }
  }
  if (!current) return;

  const graphCache = buildNavigatorGraphCache(rooms, corridors);
  const zoomProfile = computeNavigatorZoomProfile(rooms, corridors, graphCache);
  zoomToRect(svg, current.rect, current.label, zoomProfile);

  if (!showDirectionArrows) return;

  const links = computeNavigatorLinks(current, rooms, corridors, graphCache);
  for (const l of links) drawArrowText(navLayer, l);
}

function ensureDefaultStanza(session: Session) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("stanza")) {
    url.searchParams.set("stanza", session.percorso[0]);
    window.history.replaceState({}, "", url);
  }
}

/* ===================== EXTRACTION ===================== */

function extractRooms(svg: SVGSVGElement): Room[] {
  const rooms: Room[] = [];
  const roomRects = Array.from(svg.querySelectorAll<SVGRectElement>("rect.stanza"));
  const labels = Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"));

  for (const labelEl of labels) {
    const label = stanzaLabelCanonical(labelEl);
    if (!label) continue;

    const tx = Number(labelEl.getAttribute("x") ?? 0);
    const ty = Number(labelEl.getAttribute("y") ?? 0);
    const rect = findBestRoomRectForLabel(roomRects, tx, ty);
    if (!rect) continue;

    rooms.push({
      label,
      rect,
      center: rectCenter(rect),
    });
  }
  return rooms;
}

function extractCorridors(svg: SVGSVGElement): Corridor[] {
  return Array.from(svg.querySelectorAll("rect.corridoio")).map(r => ({
    rect: r as SVGRectElement,
    center: rectCenter(r as SVGRectElement),
    orientation:
      +r.getAttribute("height")! > +r.getAttribute("width")!
        ? "vertical"
        : "horizontal",
  }));
}

/* ===================== NAV LOGIC ===================== */

function buildNavigatorGraphCache(rooms: Room[], corridors: Corridor[]): NavigatorGraphCache {
  // Considera collegati stanza↔corridoio solo se i rettangoli sono adiacenti/toccano.
  // Questo evita frecce “spurie” in stanze molto grandi (dove il centro stanza è lontano).
  const TOUCH_EPS = 8;
  const corridorsNearRoom: number[][] = Array.from({ length: rooms.length }, () => []);
  const roomsWithinCorridor: number[][] = Array.from({ length: corridors.length }, () => []);

  // Primo: per ogni room, quali corridor sono abbastanza vicine?
  for (let i = 0; i < rooms.length; i++) {
    const roomBox = rectBox(rooms[i].rect);
    for (let j = 0; j < corridors.length; j++) {
      const corridorBox = rectBox(corridors[j].rect);
      if (distanceRectToRect(corridorBox, roomBox) <= TOUCH_EPS) corridorsNearRoom[i].push(j);
    }
  }

  // Secondo: per ogni corridor, quali room sono abbastanza vicine?
  for (let j = 0; j < corridors.length; j++) {
    const corridorBox = rectBox(corridors[j].rect);
    for (let i = 0; i < rooms.length; i++) {
      const roomBox = rectBox(rooms[i].rect);
      if (distanceRectToRect(corridorBox, roomBox) <= TOUCH_EPS) roomsWithinCorridor[j].push(i);
    }
  }

  return { corridorsNearRoom, roomsWithinCorridor };
}

function distanceRectToRect(a: RectBox, b: RectBox): number {
  const dx = a.x + a.w < b.x ? (b.x - (a.x + a.w)) : (b.x + b.w < a.x ? (a.x - (b.x + b.w)) : 0);
  const dy = a.y + a.h < b.y ? (b.y - (a.y + a.h)) : (b.y + b.h < a.y ? (a.y - (b.y + b.h)) : 0);
  return Math.hypot(dx, dy);
}

function computeNavigatorZoomProfile(
  rooms: Room[],
  corridors: Corridor[],
  graphCache: NavigatorGraphCache
): NavigatorZoomProfile {
  const profile: NavigatorZoomProfile = {
    extraLeftRatio: 0,
    extraRightRatio: 0,
    extraTopRatio: 0,
    extraBottomRatio: 0,
  };

  const arrowOffset = 35;
  const arrowHalfSize = 20;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const isHome = normalize(room.label) === "home";
    if (isHome) continue;

    const rectX = +room.rect.getAttribute("x")!;
    const rectY = +room.rect.getAttribute("y")!;
    const rectW = +room.rect.getAttribute("width")!;
    const rectH = +room.rect.getAttribute("height")!;

    let minX = rectX;
    let maxX = rectX + rectW;
    let minY = rectY;
    let maxY = rectY + rectH;

    // Esamina direttamente tutti i link che esisterebbero per la room i.
    for (const corridorIdx of graphCache.corridorsNearRoom[i]) {
      const corridor = corridors[corridorIdx];
      const from = corridor.center;
      const toRoomIndices = graphCache.roomsWithinCorridor[corridorIdx];

      for (const toIdx of toRoomIndices) {
        if (toIdx === i) continue;
        const toRoom = rooms[toIdx];
        const to = toRoom.center;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const arrowX = from.x - (dx / len) * arrowOffset;
        const arrowY = from.y - (dy / len) * arrowOffset;

        minX = Math.min(minX, arrowX - arrowHalfSize);
        maxX = Math.max(maxX, arrowX + arrowHalfSize);
        minY = Math.min(minY, arrowY - arrowHalfSize);
        maxY = Math.max(maxY, arrowY + arrowHalfSize);
      }
    }

    profile.extraLeftRatio = Math.max(profile.extraLeftRatio, (rectX - minX) / rectW);
    profile.extraRightRatio = Math.max(profile.extraRightRatio, (maxX - (rectX + rectW)) / rectW);
    profile.extraTopRatio = Math.max(profile.extraTopRatio, (rectY - minY) / rectH);
    profile.extraBottomRatio = Math.max(profile.extraBottomRatio, (maxY - (rectY + rectH)) / rectH);
  }

  return profile;
}

function computeNavigatorLinks(
  from: Room,
  rooms: Room[],
  corridors: Corridor[],
  graphCache: NavigatorGraphCache
): Link[] {
  const fromIdx = rooms.indexOf(from);
  if (fromIdx < 0) return [];

  const links: Link[] = [];
  const toRoomIndicesByCorridor: number[][] = graphCache.roomsWithinCorridor;

  for (const corridorIdx of graphCache.corridorsNearRoom[fromIdx]) {
    const corridor = corridors[corridorIdx];
    const fromPoint = corridor.center;

    for (const toIdx of toRoomIndicesByCorridor[corridorIdx]) {
      if (toIdx === fromIdx) continue;
      const toRoom = rooms[toIdx];
      links.push({ from: fromPoint, to: toRoom.center, label: toRoom.label, corridor, fromRoom: from });
    }
  }

  return links;
}

/* ===================== DRAW ARROWS ===================== */

function drawArrowText(layer: SVGGElement, link: Link) {
  const ns = "http://www.w3.org/2000/svg";
  const { from, to, corridor, fromRoom } = link;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const rotation =
    corridor.orientation === "vertical"
      ? dy > 0 ? 90 : -90
      : dx > 0 ? 0 : 180;

  // Dimensione freccia: resta uguale nei casi normali, ma se la stanza/mappa è enorme
  // (viewBox molto grande → 40 unità SVG diventano pochi pixel) la rendiamo leggibile.
  // Clamp anche rispetto allo spessore corridoio per non “invadere” altre stanze.
  const svg = layer.ownerSVGElement;
  const vbParts = (svg?.getAttribute("viewBox") ?? "0 0 800 600").split(" ").map(Number);
  const vbW = vbParts[2] || 800;
  const vbH = vbParts[3] || 600;
  const svgRect = svg?.getBoundingClientRect();
  const pxW = Math.max(1, svgRect?.width ?? 800);
  const pxH = Math.max(1, svgRect?.height ?? 600);
  const unitsPerPx = Math.max(vbW / pxW, vbH / pxH);

  const cW = +corridor.rect.getAttribute("width")!;
  const cH = +corridor.rect.getAttribute("height")!;
  const thickness = corridor.orientation === "vertical" ? cW : cH;

  const minPx = pxW <= 420 ? 32 : 28;
  const maxPx = pxW <= 420 ? 50 : 46;
  const minSizeUnits = minPx * unitsPerPx;
  const maxSizeUnits = maxPx * unitsPerPx;
  const maxFromCorridor = Math.max(minSizeUnits, thickness * 2.6);
  const SIZE = clamp(Math.max(40, minSizeUnits), minSizeUnits, Math.min(maxSizeUnits, maxFromCorridor));
  // Posizione: la freccia deve stare vicino alla stanza corrente (fromRoom) ma
  // *sempre dentro il corridoio* (mai dentro la stanza), indipendentemente
  // dalla direzione verso la stanza target.
  const corridorBox = rectBox(corridor.rect);
  const roomBox = rectBox(fromRoom.rect);
  const door = corridorDoorPoint(roomBox, corridorBox, corridor.orientation);

  const attachThickness = corridor.orientation === "vertical" ? corridorBox.w : corridorBox.h;
  const inset = Math.max(6, attachThickness * 0.55);
  const attachDir = corridorAttachDir(roomBox, corridorBox, corridor.orientation); // verso “dentro corridoio”

  let x = door.x;
  let y = door.y;
  if (corridor.orientation === "vertical") {
    x = door.x;
    y = door.y + attachDir * inset;
  } else {
    x = door.x + attachDir * inset;
    y = door.y;
  }

  const g = document.createElementNS(ns, "g");
  const img = document.createElementNS(ns, "image");
  img.setAttribute("href", "./icons/arrow-right.png");
  img.setAttribute("width", `${SIZE}`);
  img.setAttribute("height", `${SIZE}`);
  g.setAttribute(
    "transform",
    `translate(${x}, ${y}) rotate(${rotation}) translate(${-SIZE / 2}, ${-SIZE / 2})`
  );
  g.addEventListener("pointerdown", e => {
    e.preventDefault();
    goToRoom(link.label);
  });
  g.appendChild(img);
  layer.appendChild(g);
}

function corridorDoorPoint(room: RectBox, corridor: RectBox, orientation: "vertical" | "horizontal"): Point {
  const overlapX0 = Math.max(room.x, corridor.x);
  const overlapX1 = Math.min(room.x + room.w, corridor.x + corridor.w);
  const overlapY0 = Math.max(room.y, corridor.y);
  const overlapY1 = Math.min(room.y + room.h, corridor.y + corridor.h);
  const cx = overlapX1 > overlapX0 ? (overlapX0 + overlapX1) / 2 : corridor.x + corridor.w / 2;
  const cy = overlapY1 > overlapY0 ? (overlapY0 + overlapY1) / 2 : corridor.y + corridor.h / 2;

  if (orientation === "vertical") {
    // Se il corridoio è sotto la stanza, la "porta" è sul top del corridoio; se sopra, sul bottom.
    const corridorIsBelow = corridor.y >= room.y + room.h;
    const y = corridorIsBelow ? corridor.y : corridor.y + corridor.h;
    return { x: cx, y };
  }

  // Horizontal: se corridoio è a destra della stanza → porta a sx del corridoio; se a sinistra → a dx.
  const corridorIsRight = corridor.x >= room.x + room.w;
  const x = corridorIsRight ? corridor.x : corridor.x + corridor.w;
  return { x, y: cy };
}

function corridorAttachDir(room: RectBox, corridor: RectBox, orientation: "vertical" | "horizontal"): 1 | -1 {
  if (orientation === "vertical") {
    // corridoio sotto stanza → entra verso +Y, sopra → entra verso -Y
    return corridor.y >= room.y + room.h ? 1 : -1;
  }
  // corridoio a destra stanza → entra verso +X, a sinistra → entra verso -X
  return corridor.x >= room.x + room.w ? 1 : -1;
}

/* ===================== OBJECT IMAGE REPLACEMENT ===================== */

// Cache modulo: true = preview esiste, false = non esiste, undefined = non verificato.
// Persiste per tutta la sessione browser:
//   - HEAD request fatta una sola volta per oggetto
//   - dal secondo caricamento dell'SVG il cerchio sparisce immediatamente (niente flash)
//   - l'immagine viene servita dalla cache HTTP del browser (Cache-Control: max-age=3600)
const previewExistsCache = new Map<string, boolean>();
// Deduplica le richieste HEAD in corso per lo stesso oggetto.
const previewRequestCache = new Map<string, Promise<boolean>>();
// Cache stanza per oggetto: evita roundtrip ripetuti su Next/Prev.
const objectRoomCache = new Map<string, string>();
const objectRoomRequestCache = new Map<string, Promise<string>>();
let cachedUserPreferences: { livello?: string; durata?: string; navLang?: string } | null = null;
let userPreferencesInFlight: Promise<{ livello?: string; durata?: string; navLang?: string } | null> | null = null;

function previewCacheKey(museo: string, nome: string): string {
  return `${museo}__${nome}`;
}

function objectRoomCacheKey(museo: string, nome: string): string {
  return `${museo}__${nome}`;
}

async function fetchObjectRoom(museo: string, oggettoNome: string): Promise<string> {
  const key = objectRoomCacheKey(museo, oggettoNome);
  const cached = objectRoomCache.get(key);
  if (cached) return cached;

  const inFlight = objectRoomRequestCache.get(key);
  if (inFlight) return inFlight;

  const req = fetch(
    `${API_BASE}/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(oggettoNome)}`
  )
    .then(async (res) => {
      if (!res.ok) throw new Error("Oggetto non trovato");
      const oggetto = await res.json();
      const stanza = String(oggetto?.stanza || "").trim();
      if (!stanza) throw new Error("Stanza mancante");
      objectRoomCache.set(key, stanza);
      return stanza;
    })
    .finally(() => {
      objectRoomRequestCache.delete(key);
    });

  objectRoomRequestCache.set(key, req);
  return req;
}

function prefetchNavigatorSvg(museo: string, fromObj: string, toObj: string) {
  const url = `${SVG_SERVER_BASE}/${encodeURIComponent(museo)}/path/${encodeURIComponent(fromObj)}/${encodeURIComponent(toObj)}`;
  // fire-and-forget: warmup cache per ridurre latenza al click successivo
  fetch(url).catch(() => {});
}

function levelToIndex(livello?: string): number {
  const key = String(livello || "").trim().toLowerCase();
  if (key === "bambino") return 0;
  if (key === "studente") return 1;
  if (key === "esperto") return 2;
  if (key === "avanzato") return 3;
  return 1;
}

function durationToIndex(durata?: string): number {
  const key = String(durata || "").trim().toLowerCase();
  if (key === "corto") return 0;
  if (key === "medio") return 1;
  if (key === "lungo") return 2;
  if (key === "esteso") return 3;
  return 1;
}

function pickDescriptionByPreferences(
  descrizioni: unknown,
  preferences: { livello?: string; durata?: string } | null
): string | null {
  if (!Array.isArray(descrizioni) || descrizioni.length === 0) return null;

  const preferredLevel = levelToIndex(preferences?.livello);
  const preferredDuration = durationToIndex(preferences?.durata);

  const levelGroupRaw = descrizioni[preferredLevel] ?? descrizioni[Math.min(preferredLevel, descrizioni.length - 1)];
  if (!Array.isArray(levelGroupRaw) || levelGroupRaw.length === 0) return null;

  const durIdx = Math.min(preferredDuration, levelGroupRaw.length - 1);
  const text = levelGroupRaw[durIdx];
  if (typeof text === "string" && text.trim().length > 0) return text;

  for (const candidate of levelGroupRaw) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }

  // fallback globale: prima stringa non vuota trovata
  for (const group of descrizioni) {
    if (!Array.isArray(group)) continue;
    for (const candidate of group) {
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
    }
  }

  return null;
}

function pickDescrizioniMatrixForLang(
  d: { descrizioni?: unknown; descrizioniI18n?: Record<string, unknown> } | null | undefined,
  navLang: string
): unknown {
  const lang = navLang === "en" || navLang === "fr" ? navLang : "it";
  const it = d?.descrizioni;
  if (lang === "it") return it;
  const alt = d?.descrizioniI18n?.[lang];
  if (Array.isArray(alt) && alt.length > 0) return alt;
  return it;
}

async function getUserPreferences(): Promise<{ livello?: string; durata?: string; navLang?: string } | null> {
  const session = getSession();
  const navLangLocal = getStoredNavLang();
  const livelloFromSession = typeof session?.livello === "string" ? session.livello : "";
  const durataFromSession = typeof session?.durata === "string" ? session.durata : "";
  if (livelloFromSession || durataFromSession) {
    return { livello: livelloFromSession, durata: durataFromSession, navLang: navLangLocal };
  }

  if (cachedUserPreferences) return { ...cachedUserPreferences, navLang: navLangLocal };
  if (userPreferencesInFlight) return userPreferencesInFlight;

  userPreferencesInFlight = fetch(`${API_BASE}/users/me`, { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      const user = data?.user || {};
      const nl =
        user.navLang === "en" || user.navLang === "fr" || user.navLang === "it"
          ? user.navLang
          : getStoredNavLang();
      try {
        localStorage.setItem("mu_nav_lang", nl);
      } catch {
        /* ignore */
      }
      const prefs = {
        livello: typeof user.livello === "string" ? user.livello : "",
        durata: typeof user.durata === "string" ? user.durata : "",
        navLang: nl,
      };
      cachedUserPreferences = prefs;
      return prefs;
    })
    .catch(() => null)
    .finally(() => {
      userPreferencesInFlight = null;
    });

  return userPreferencesInFlight;
}

function replaceCircleWithImage(
  svg: SVGSVGElement,
  circle: SVGCircleElement,
  nome: string,
  museo: string,
  objectType: string = "normal"
): void {
  const ns = "http://www.w3.org/2000/svg";

  const cx = parseFloat(circle.getAttribute("cx") ?? "0");
  const cy = parseFloat(circle.getAttribute("cy") ?? "0");
  const r  = parseFloat(circle.getAttribute("r")  ?? "10");

  const isVirtualTextNode = String(nome || "").startsWith("__text__");
  const isTextObject = String(objectType || "").toLowerCase() === "text";
  const PREVIEW_SCALE = (isVirtualTextNode || isTextObject) ? 1.6 : 2.5;
  const displayR = r * PREVIEW_SCALE;
  const size = displayR * 2;

  const clipId = `clip-obj-${nome.replace(/\s+/g, "_")}-${Math.round(cx)}-${Math.round(cy)}`;
  const previewUrl = isVirtualTextNode
    ? "/foto/pt.png"
    : `${API_BASE}/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(nome)}/immagini/preview`;
  const cacheKey = previewCacheKey(museo, nome);

  let defsEl = svg.querySelector<SVGDefsElement>("defs");

  // Monta clipPath + image nell'SVG corrente.
  // hideCircleImmediately=true → cache hit: il cerchio sparisce subito senza flash.
  function mountImage(hideCircleImmediately: boolean) {
    if (!defsEl) {
      defsEl = document.createElementNS(ns, "defs") as SVGDefsElement;
      svg.insertBefore(defsEl, svg.firstChild);
    }

    const clipPath = document.createElementNS(ns, "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipCircle = document.createElementNS(ns, "circle");
    clipCircle.setAttribute("cx", String(cx));
    clipCircle.setAttribute("cy", String(cy));
    clipCircle.setAttribute("r",  String(displayR));
    clipPath.appendChild(clipCircle);
    defsEl.appendChild(clipPath);

    const imgEl = document.createElementNS(ns, "image") as SVGImageElement;
    imgEl.setAttribute("x",      String(cx - displayR));
    imgEl.setAttribute("y",      String(cy - displayR));
    imgEl.setAttribute("width",  String(size));
    imgEl.setAttribute("height", String(size));
    imgEl.setAttribute("clip-path", `url(#${clipId})`);
    imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
    imgEl.setAttribute("data-nome", nome);
    imgEl.setAttribute("data-object-type", String(objectType || "normal"));
    imgEl.style.cursor = "pointer";
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openObjectFocus(nome);
    });

    // Label <text> è sempre il nextElementSibling del cerchio
    const labelEl = circle.nextElementSibling as SVGTextElement | null;

    if (hideCircleImmediately) {
      // Cache hit: browser ha già il file → nascondi cerchio e label subito
      circle.style.display = "none";
      if (labelEl) labelEl.style.display = "none";
      imgEl.style.display = "";
    } else {
      // Prima visita: aspetta load prima di nascondere cerchio e label
      imgEl.style.display = "none";
      imgEl.addEventListener("load", () => {
        circle.style.display = "none";
        if (labelEl) labelEl.style.display = "none";
        imgEl.style.display = "";
      });
      imgEl.addEventListener("error", () => {
        imgEl.remove();
        clipPath.remove();
      });
    }

    imgEl.setAttribute("href", previewUrl);
    circle.insertAdjacentElement("afterend", imgEl);
  }

  if (isVirtualTextNode) {
    mountImage(true);
    return;
  }

  const cached = previewExistsCache.get(cacheKey);

  if (cached === true) {
    // Già verificato in sessione: esiste → monta immediatamente, niente flash
    mountImage(true);
    return;
  }

  if (cached === false) {
    // Già verificato: non esiste → lascia cerchio invariato
    return;
  }

  // Prima volta / in-flight dedup:
  // - se c'è già una HEAD in corso per questo oggetto, aspettiamo quella
  // - altrimenti avviamo la HEAD e condividiamo il risultato a tutti i circoli
  const inFlight = previewRequestCache.get(cacheKey);
  if (inFlight) {
    inFlight.then(exists => {
      if (exists) mountImage(false);
    });
    return;
  }

  const req = fetch(previewUrl, { method: "HEAD" })
    .then(res => {
      const ok = !!res.ok;
      previewExistsCache.set(cacheKey, ok);
      return ok;
    })
    .catch(() => {
      previewExistsCache.set(cacheKey, false);
      return false;
    })
    .finally(() => {
      previewRequestCache.delete(cacheKey);
    });

  previewRequestCache.set(cacheKey, req);
  req.then(exists => {
    if (exists) mountImage(false);
  });
}

/* ===================== UTILS ===================== */

function rectCenter(r: SVGRectElement): Point {
  const x = +r.getAttribute("x")!;
  const y = +r.getAttribute("y")!;
  const w = +r.getAttribute("width")!;
  const h = +r.getAttribute("height")!;
  return { x: x + w / 2, y: y + h / 2 };
}

function rectBox(r: SVGRectElement): RectBox {
  const x = +r.getAttribute("x")!;
  const y = +r.getAttribute("y")!;
  const w = +r.getAttribute("width")!;
  const h = +r.getAttribute("height")!;
  return { x, y, w, h };
}

function pointInRect(px: number, py: number, b: RectBox, margin = 4): boolean {
  return (
    px >= b.x - margin &&
    px <= b.x + b.w + margin &&
    py >= b.y - margin &&
    py <= b.y + b.h + margin
  );
}

function findBestRoomRectForLabel(rects: SVGRectElement[], tx: number, ty: number): SVGRectElement | null {
  const containing = rects
    .map(rect => ({ rect, box: rectBox(rect) }))
    .filter(({ box }) => pointInRect(tx, ty, box))
    .sort((a, b) => (a.box.w * a.box.h) - (b.box.w * b.box.h));

  if (containing.length > 0) return containing[0].rect;

  let best: SVGRectElement | null = null;
  let bestDist = Infinity;
  for (const rect of rects) {
    const c = rectCenter(rect);
    const d = Math.hypot(c.x - tx, c.y - ty);
    if (d < bestDist) {
      bestDist = d;
      best = rect;
    }
  }
  return best;
}

function zoomToRect(
  svg: SVGSVGElement,
  rect: SVGRectElement,
  roomLabel: string,
  zoomProfile: NavigatorZoomProfile
) {
  const rectX = +rect.getAttribute("x")!;
  const rectY = +rect.getAttribute("y")!;
  const rectW = +rect.getAttribute("width")!;
  const rectH = +rect.getAttribute("height")!;

  const svgRect = svg.getBoundingClientRect();
  const vbParts = (svg.getAttribute("viewBox") ?? "0 0 800 600").split(" ").map(Number);
  const fallbackW = vbParts[2] || 800;
  const fallbackH = vbParts[3] || 600;
  const svgW = svgRect.width || svg.clientWidth || fallbackW;
  const svgH = svgRect.height || svg.clientHeight || fallbackH;
  const containerAspect = svgW / svgH;
  const isSmallMobile = svgW <= 420;
  const isMobile = svgW <= 700;

  // Padding dinamico: adatta lo zoom alla scala complessiva del museo.
  const mapArea = Math.max(1, fallbackW * fallbackH);
  const roomArea = Math.max(1, rectW * rectH);
  const areaRatio = Math.sqrt(mapArea / roomArea);
  const roomCoverage = roomArea / mapArea;
  const basePadFactor = clamp(0.75 + ((areaRatio - 5) / 2.5) * 0.75, 0.75, 1.5);

  // HOME deve restare identica al comportamento originale.
  if (normalize(roomLabel) === "home") {
    const padX = rectW * basePadFactor;
    const padY = rectH * basePadFactor;
    let vbW = rectW + padX * 2;
    let vbH = rectH + padY * 2;
    if (vbW / vbH < containerAspect) vbW = vbH * containerAspect;
    else vbH = vbW / containerAspect;
    const cx = rectX + rectW / 2;
    const cy = rectY + rectH / 2 + rectH * 0.6;
    svg.setAttribute("viewBox", `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`);
    return;
  }

  // Non-HOME: focus forte sulla stanza singola, soprattutto su mobile.
  // Usiamo un padding base molto più stretto rispetto al passato.
  const targetPad = isSmallMobile ? 0.05 : isMobile ? 0.08 : 0.16;
  const padFactor = clamp(Math.min(basePadFactor, targetPad), 0.04, 0.24);

  // Le stanze molto grandi non devono "ereditare" margini enormi dai navigator:
  // riduciamo/cappiamo gli extra in base alla copertura della stanza.
  const isLargeRoom = roomCoverage >= 0.1;
  const extraScale = isLargeRoom ? 0.25 : roomCoverage >= 0.06 ? 0.5 : 1;
  const extraCap = isSmallMobile ? 0.16 : isMobile ? 0.2 : 0.24;
  const extraLeft = clamp(zoomProfile.extraLeftRatio * extraScale, 0, extraCap);
  const extraRight = clamp(zoomProfile.extraRightRatio * extraScale, 0, extraCap);
  const extraTop = clamp(zoomProfile.extraTopRatio * extraScale, 0, extraCap);
  const extraBottom = clamp(zoomProfile.extraBottomRatio * extraScale, 0, extraCap);

  const padLeft = rectW * (padFactor + extraLeft);
  const padRight = rectW * (padFactor + extraRight);
  const padTop = rectH * (padFactor + extraTop);
  const padBottom = rectH * (padFactor + extraBottom + (isMobile ? 0.01 : 0));
  let vbW = rectW + padLeft + padRight;
  let vbH = rectH + padTop + padBottom;

  if (vbW / vbH < containerAspect) vbW = vbH * containerAspect;
  else vbH = vbW / containerAspect;

  const contentMinX = rectX - padLeft;
  const contentMinY = rectY - padTop;
  const contentW = rectW + padLeft + padRight;
  const contentH = rectH + padTop + padBottom;
  const cx = contentMinX + contentW / 2;
  const cy = contentMinY + contentH / 2;

  svg.setAttribute("viewBox", `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`);
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isSpecialRouteNode(name: string): boolean {
  const key = normalize(name || "");
  return key === "in" || key === "out" || key === "shop" || key === "wc";
}

/* ===================== URL HELPERS ===================== */

function goToRoom(label: string) {
  const session = getSession();
  if (!session) return;
  const { svgPath } = parseStanzaFromUrl(session);
  const value = svgPath ? `${label}/${svgPath}` : label;
  const url = new URL(window.location.href);
  url.searchParams.set("stanza", value);
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function openObjectFocus(nome: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("oggetto", nome);
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function closeObjectFocus() {
  const url = new URL(window.location.href);
  url.searchParams.delete("oggetto");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/* ===================== OBJECT CLICKS ===================== */

function bindObjectClicks(svg: SVGSVGElement, session: Session) {
  svg.querySelectorAll<SVGCircleElement>("circle.oggetto").forEach(circle => {
    const t = circle.nextElementSibling as SVGTextElement | null;
    const dataName = circle.getAttribute("data-object-name")
      || t?.getAttribute("data-object-name")
      || "";
    const dataType = circle.getAttribute("data-object-type")
      || t?.getAttribute("data-object-type")
      || "normal";
    const nome = (dataName || t?.textContent || "").trim();
    if (!nome) return;

    circle.style.cursor = "pointer";

    // ← era pointerdown + preventDefault: su Android richiedeva tap lungo
    circle.addEventListener("click", e => {
      e.stopPropagation();
      openObjectFocus(nome);
    });

    replaceCircleWithImage(svg, circle, nome, session.museo, dataType);
  });
}

/* ===================== OBJECT OVERLAY ===================== */

function ObjectOverlay({
  nome,
  session,
  onClose,
  showNav,
  domDataObjectType,
}: {
  nome: string;
  session: Session;
  onClose: () => void;
  showNav: boolean;
  domDataObjectType: string | null;
}) {
  const { t, lang } = useNavLang();
  const QUICK_QUESTIONS_INITIAL = [
    t("qWhat"),
    t("qMore"),
    t("qExplain"),
    t("qAuthor"),
    t("qHistory"),
  ];
  const QUICK_FOLLOW_UP_ONLY = t("qMore");
  const [descrizione, setDescrizione] = useState<string | null>(null);
  const [autore, setAutore] = useState<string>("");
  const [correnteArtistica, setCorrenteArtistica] = useState<string>("");
  const [anno, setAnno] = useState<string>("");
  const [immagini, setImmagini]       = useState<{ tipo: string; url: string }[]>([]);
  const [slideIdx, setSlideIdx]       = useState(0);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [fetchedObjectType, setFetchedObjectType] = useState<string | null>(null);
  const percorso = Array.isArray(session?.guidedFlowNodes) && session.guidedFlowNodes.length > 0
    ? session.guidedFlowNodes
    : (Array.isArray(session?.percorso) ? session.percorso : []);
  const pathIndex = percorso.indexOf(nome);
  const isObjectInPath = pathIndex !== -1;
  const virtualObject = session?.guidedVirtualObjects?.[nome];
  /** Tappe testo guidate: id `__text__…` anche se il cookie non espone più guidedVirtualObjects */
  const isGuidedVirtualTextItem =
    String(nome || "").startsWith("__text__") || !!virtualObject;
  /** Item solo testo nel museo (etichetta "?", `data-object-type="text"` nell’SVG) */
  const isMuseumTextOnlyItem =
    String(domDataObjectType || "").toLowerCase() === "text" ||
    String(fetchedObjectType || "").toLowerCase() === "text";
  const showObjectChat = !isGuidedVirtualTextItem && !isMuseumTextOnlyItem;
  const objectTitle = virtualObject
    ? String(virtualObject.label || "").trim() || t("itemTextFallback")
    : nome;

  useEffect(() => {
    setSlideIdx(0);
    setFetchedObjectType(null);
    if (virtualObject) {
      setAutore("");
      setCorrenteArtistica("");
      setAnno("");
      getUserPreferences()
        .then((prefs) =>
          setDescrizione(
            pickDescriptionByPreferences(
              pickDescrizioniMatrixForLang({ descrizioni: virtualObject.descrizioni }, lang),
              prefs
            )
          )
        )
        .catch(() => setDescrizione(null));
      setImmagini([]);
      return;
    }
    const guidedText = String(session?.guidedCustomDescriptions?.[nome] || "").trim();
    // Carica dettagli oggetto (descrizione + meta dati autore/corrente).
    Promise.all([
      fetch(
        `${API_BASE}/musei/${encodeURIComponent(session.museo)}/oggetti/${encodeURIComponent(nome)}`
      ).then(r => r.json()),
      getUserPreferences(),
    ])
      .then(([d, prefs]) => {
        setFetchedObjectType(String(d?.objectType || "normal").trim().toLowerCase() || "normal");
        setAutore(String(d?.autore || "").trim());
        setCorrenteArtistica(String(d?.correnteArtistica || "").trim());
        setAnno(String(d?.anno || "").trim());
        if (guidedText) {
          setDescrizione(guidedText);
          return;
        }
        const best = pickDescriptionByPreferences(
          pickDescrizioniMatrixForLang(d, lang),
          prefs
        );
        setDescrizione(best);
      })
      .catch(() => {
        setFetchedObjectType(null);
        setAutore("");
        setCorrenteArtistica("");
        setAnno("");
        setDescrizione(guidedText || null);
      });

    // carica lista immagini, esclude preview
    fetch(
      `${API_BASE}/musei/${encodeURIComponent(session.museo)}/oggetti/${encodeURIComponent(nome)}/immagini`
    )
      .then(r => r.json())
      .then(d => {
        const lista = (d.immagini ?? []).filter(
          (img: { tipo: string }) => img.tipo !== "preview"
        );
        setImmagini(lista);
      })
      .catch(() => setImmagini([]));
  }, [nome, session, virtualObject, lang]);

  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setChatLoading(false);
  }, [nome]);

  useEffect(() => {
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index === -1) return;

    const curr = percorso[index];
    const prev = index > 0 ? percorso[index - 1] : null;
    const next = index < percorso.length - 1 ? percorso[index + 1] : null;

    // Pre-carico stanza corrente e adiacenti per evitare fetch al click.
    fetchObjectRoom(session.museo, curr).catch(() => {});
    if (prev) fetchObjectRoom(session.museo, prev).catch(() => {});
    if (next) fetchObjectRoom(session.museo, next).catch(() => {});

    // Preload delle prossime SVG probabili (prev/next).
    if (prev) prefetchNavigatorSvg(session.museo, prev, curr);
    if (next) prefetchNavigatorSvg(session.museo, curr, next);
  }, [nome, session]);

  const updateURL = async (oggettoCorrente: string, oggettoAltro: string) => {
    try {
      const getNodeRoom = async (node: string) => {
        if (String(node || "").startsWith("__text__")) {
          return String(session.guidedVirtualObjects?.[node]?.room || "").trim();
        }
        if (isSpecialRouteNode(node)) return "";
        return fetchObjectRoom(session.museo, node);
      };
      const stanzaFrom = await getNodeRoom(oggettoCorrente);
      history.pushState(null, "", `/?stanza=${encodeURIComponent(stanzaFrom || "IN")}/path/${encodeURIComponent(oggettoCorrente)}/${encodeURIComponent(oggettoAltro)}`);
      onClose();
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Errore updateURL:", err);
    }
  };

  const syncTeacherNavigationByObject = async (targetObject: string) => {
    if (session.guideRole !== "teacher" || !session.guidedVisitId) return;
    try {
      await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId)}/navigation/by-object`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectName: targetObject }),
      });
    } catch (err) {
      console.error("Errore sync navigazione docente:", err);
    }
  };
  const syncTeacherNavigationByStep = async (stepIndex: number) => {
    if (session.guideRole !== "teacher" || !session.guidedVisitId) return;
    try {
      await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId)}/navigation`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex }),
      });
    } catch (err) {
      console.error("Errore sync navigazione step docente:", err);
    }
  };
  const fetchTeacherVisitState = async () => {
    if (session.guideRole !== "teacher" || !session.guidedVisitId) return null;
    try {
      const r = await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId)}/teacher-state`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      return d.visit || null;
    } catch {
      return null;
    }
  };
  const routeForStep = (steps: any[], targetIdx: number): { from: string; to: string } | null => {
    const target = steps[targetIdx];
    if (!target) return null;
    let to = "";
    if (target.type === "object" && target.objectName) {
      to = String(target.objectName);
    } else if (target.type === "text") {
      to = `__text__${targetIdx + 1}`;
    } else {
      return null;
    }
    let from = "IN";
    for (let i = targetIdx - 1; i >= 0; i--) {
      const s = steps[i];
      if (s?.type === "object" && s?.objectName) {
        from = s.objectName;
        break;
      }
      if (s?.type === "text") {
        from = `__text__${i + 1}`;
        break;
      }
    }
    return { from, to };
  };
  const syncTeacherNavigationByNode = async (nodeName: string) => {
    if (session.guideRole !== "teacher" || !session.guidedVisitId) return;
    try {
      await fetch(`${API_BASE}/guided-visits/${encodeURIComponent(session.guidedVisitId)}/navigation/by-node`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeName }),
      });
    } catch (err) {
      console.error("Errore sync navigazione nodo docente:", err);
    }
  };

  const handleNext = async () => {
    if (session.guideRole === "teacher" && session.guidedVisitId) {
      const visit = await fetchTeacherVisitState();
      const steps = Array.isArray(visit?.steps) ? visit.steps : [];
      const currentIdx = Number(visit?.currentStepIndex) || 0;
      if (steps.length < 1 || currentIdx >= steps.length - 1) {
        const percorso = session.percorso;
        const index = percorso.indexOf(nome);
        if (index === percorso.length - 2) {
          await syncTeacherNavigationByNode("OUT");
          const stanzaObj = await fetchObjectRoom(session.museo, nome);
          history.pushState(null, "", `/?stanza=${stanzaObj}/path/${encodeURIComponent(nome)}/${encodeURIComponent("OUT")}`);
          onClose();
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        return;
      }
      const nextIdx = currentIdx + 1;
      await syncTeacherNavigationByStep(nextIdx);
      const route = routeForStep(steps, nextIdx);
      if (route) updateURL(route.from, route.to);
      return;
    }
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index === -1 || index >= percorso.length - 2) {
      if (session.guideRole === "teacher" && index === percorso.length - 2) {
        await syncTeacherNavigationByNode("OUT");
        const stanzaObj = await fetchObjectRoom(session.museo, nome);
        history.pushState(null, "", `/?stanza=${stanzaObj}/path/${encodeURIComponent(nome)}/${encodeURIComponent("OUT")}`);
        onClose();
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      return;
    }
    const target = percorso[index + 1];
    await syncTeacherNavigationByObject(target);
    updateURL(percorso[index], target);
  };

  const handlePrev = async () => {
    if (session.guideRole === "teacher" && session.guidedVisitId) {
      const visit = await fetchTeacherVisitState();
      const steps = Array.isArray(visit?.steps) ? visit.steps : [];
      const currentIdx = Number(visit?.currentStepIndex) || 0;
      if (steps.length < 1 || currentIdx <= 0) return;
      const prevIdx = currentIdx - 1;
      await syncTeacherNavigationByStep(prevIdx);
      const route = routeForStep(steps, prevIdx);
      if (route) updateURL(route.from, route.to);
      return;
    }
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index <= 1) return;
    const target = percorso[index - 1];
    await syncTeacherNavigationByObject(target);
    const source = index - 2 >= 0 ? percorso[index - 2] : "IN";
    updateURL(source, target);
  };

  const prevSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlideIdx(i => (i - 1 + immagini.length) % immagini.length);
  };

  const nextSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlideIdx(i => (i + 1) % immagini.length);
  };

  const sendObjectQuestion = async (rawQuestion: string) => {
    if (!showObjectChat) return;
    const question = String(rawQuestion || "").trim();
    if (!question || chatLoading) return;
    setChatLoading(true);
    setChatMessages((prev) => [...prev, { role: "user", text: question }]);
    let prefs: { livello?: string; durata?: string } | null = null;
    try {
      prefs = await getUserPreferences();
    } catch {
      prefs = null;
    }
    try {
      const r = await fetch(`${API_BASE}/ai/object-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          museo: session.museo,
          oggetto: nome,
          question,
          livello: prefs?.livello || session.livello || "",
          durata: prefs?.durata || session.durata || "",
          navLang: lang,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || t("aiRequestFail"));
      const answer = String(d?.answer || "").trim() || t("aiNoAnswer");
      setChatMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: `${t("aiErrorPrefix")} ${err?.message || t("aiUnknownError")}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        overscrollBehavior: "contain",
        touchAction: "none",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "relative",
          background: "#fff",
          borderRadius: 14,
          minWidth: 300,
          maxWidth: 420,
          width: "90vw",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          boxShadow: "0 12px 48px rgba(0,0,0,0.35)",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
        }}
      >
        <button
          type="button"
          aria-label={t("closeSheet")}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 20,
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "none",
            padding: 0,
            background: "rgba(255,255,255,0.97)",
            color: "#c72020",
            fontSize: 18,
            lineHeight: 1,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 1px 6px rgba(0,0,0,0.2)",
          }}
        >
          ×
        </button>
        {/* ── Slider immagini ── */}
        {immagini.length > 0 && (
          <div style={{ position: "relative", background: "#111", flexShrink: 0 }}>
            <img
              src={`${API_BASE}${immagini[slideIdx].url}`}
              alt={immagini[slideIdx].tipo}
              style={{
                width: "100%",
                maxHeight: 260,
                objectFit: "contain",
                display: "block",
              }}
            />

            {/* frecce — visibili solo se ci sono più immagini */}
            {immagini.length > 1 && (
              <>
                <button
                  onClick={prevSlide}
                  style={{
                    position: "absolute", left: 8, top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.45)", color: "#fff",
                    border: "none", borderRadius: "50%",
                    width: 34, height: 34, fontSize: 18,
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    backdropFilter: "blur(4px)",
                  }}
                >‹</button>
                <button
                  onClick={nextSlide}
                  style={{
                    position: "absolute", right: 8, top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.45)", color: "#fff",
                    border: "none", borderRadius: "50%",
                    width: 34, height: 34, fontSize: 18,
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    backdropFilter: "blur(4px)",
                  }}
                >›</button>

                {/* dots */}
                <div style={{
                  position: "absolute", bottom: 8, left: 0, right: 0,
                  display: "flex", justifyContent: "center", gap: 6,
                }}>
                  {immagini.map((_, i) => (
                    <div
                      key={i}
                      onClick={e => { e.stopPropagation(); setSlideIdx(i); }}
                      style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: i === slideIdx ? "#fff" : "rgba(255,255,255,0.4)",
                        cursor: "pointer", transition: "background 0.2s",
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* etichetta tipo */}
            <div style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(0,0,0,0.5)", color: "#fff",
              fontSize: 11, padding: "2px 8px", borderRadius: 10,
              backdropFilter: "blur(4px)",
            }}>
              {immagini[slideIdx].tipo}
            </div>
          </div>
        )}

        {/* ── Testo ── */}
        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700 }}>{objectTitle}</h2>
          {showObjectChat && (
            <div style={{ marginBottom: 10, display: "grid", gap: 2 }}>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "#666" }}><strong>{t("author")}</strong> {autore || t("nd")}</p>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "#666" }}><strong>{t("year")}</strong> {anno || t("nd")}</p>
              {correnteArtistica && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "#666" }}><strong>{t("movement")}</strong> {correnteArtistica}</p>}
            </div>
          )}
          {descrizione
            ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#444" }}>{descrizione}</p>
            : <p style={{ margin: 0, fontSize: 14, color: "#aaa" }}>{t("loadingDesc")}</p>
          }

          {showObjectChat && (
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #e8ecf1",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: "#1a2b3c", textTransform: "uppercase" }}>
                {t("aiQuestions")}
              </p>
              <span style={{ fontSize: 10, color: "#7a8794" }}>{t("aiQuestionsHint")}</span>
            </div>

            {!chatLoading && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {(chatMessages.length === 0 ? QUICK_QUESTIONS_INITIAL : [QUICK_FOLLOW_UP_ONLY]).map((q, qi) => (
                  <button
                    key={`${q}-${qi}`}
                    type="button"
                    disabled={chatLoading}
                    onClick={() => sendObjectQuestion(q)}
                    style={{
                      border: "1px solid #c5d8ed",
                      background: "linear-gradient(180deg, #fff 0%, #f5f9fd 100%)",
                      color: "#1a4d7a",
                      borderRadius: 999,
                      padding: "7px 12px",
                      fontSize: 11,
                      lineHeight: 1.35,
                      textAlign: "left",
                      cursor: chatLoading ? "not-allowed" : "pointer",
                      boxShadow: "0 1px 2px rgba(24,95,165,0.06)",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                borderRadius: 12,
                padding: 10,
                background: "#eef2f7",
                border: "1px solid #dce4ee",
                marginBottom: 10,
                touchAction: "pan-y",
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
              }}
            >
              {chatMessages.length === 0 && !chatLoading && (
                <p style={{ margin: 0, color: "#6b7c8c", fontSize: 12, lineHeight: 1.45 }}>
                  {t("aiHelpInitial")}
                </p>
              )}
              {chatMessages.length > 0 && !chatLoading && (
                <p style={{ margin: "0 0 8px", color: "#6b7c8c", fontSize: 11, lineHeight: 1.4 }}>
                  {t("aiHelpFollow")}
                </p>
              )}
              {chatMessages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  style={{
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      maxWidth: "92%",
                      padding: "8px 11px",
                      borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                      fontSize: 12,
                      lineHeight: 1.5,
                      background: msg.role === "user" ? "#185FA5" : "#fff",
                      color: msg.role === "user" ? "#fff" : "#2c3e50",
                      boxShadow: msg.role === "user" ? "0 2px 8px rgba(24,95,165,0.25)" : "0 1px 3px rgba(0,0,0,0.06)",
                      border: msg.role === "user" ? "none" : "1px solid #e4eaf2",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <p style={{ margin: 0, fontSize: 11, color: "#185FA5", fontStyle: "italic" }}>
                  {t("aiThinking")}
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = chatInput.trim();
                if (!value) return;
                setChatInput("");
                sendObjectQuestion(value);
              }}
              style={{ display: "flex", gap: 8, alignItems: "stretch" }}
            >
              <input
                type="text"
                inputMode="text"
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="off"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t("questionPlaceholder")}
                style={{
                  flex: 1,
                  border: "1px solid #cfd8e3",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 16,
                  lineHeight: 1.35,
                  outline: "none",
                  background: "#fff",
                  touchAction: "manipulation",
                }}
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  border: "none",
                  borderRadius: 10,
                  background: chatLoading || !chatInput.trim() ? "#9db4cc" : "#185FA5",
                  color: "#fff",
                  padding: "0 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t("send")}
              </button>
            </form>
          </div>
          )}
        </div>

        {/* ── Navigazione percorso ── */}
        {showNav && isObjectInPath && (
          <div style={{
            display: "flex", justifyContent: "space-between",
            padding: "12px 24px", borderTop: "1px solid #eee", flexShrink: 0,
            background: "#fff", position: "sticky", bottom: 0, zIndex: 1,
          }}>
            <button
              onClick={handlePrev}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: "1.5px solid #ccc", background: "transparent",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >{t("prev")}</button>
            <button
              onClick={handleNext}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: "none", background: "#185FA5", color: "#fff",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >{t("next")}</button>
          </div>
        )}
      </div>
    </div>
  );
}