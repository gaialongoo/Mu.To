import { useEffect, useRef, useState } from "react";

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

function computeSvgUrl(session: Session): string {
  const { svgPath } = parseStanzaFromUrl(session);
  const museo = encodeURIComponent(session.museo);
  return svgPath
    ? `${SVG_SERVER_BASE}/${museo}/${svgPath}`
    : `${SVG_SERVER_BASE}/${museo}`;
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
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  const [focusedObject, setFocusedObject] = useState<string | null>(null);
  const [freeExplore, setFreeExplore] = useState(false);
  const [currentStanzaLabel, setCurrentStanzaLabel] = useState<string | null>(null);
  const [roomConfirm, setRoomConfirm] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const lockedViewBox = useRef<string | null>(null);
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
    loadSvg(computeSvgUrl(session), session, () => setExitConfirmOpen(true));
  }, [session]);

  // HOME: blocca zoom/pan e disabilita la modalità esplora.
  useEffect(() => {
    if (!session) return;
    const sync = () => {
      const { stanza } = parseStanzaFromUrl(session);
      setCurrentStanzaLabel(stanza);
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
      const { stanza } = parseStanzaFromUrl(session);
      const isHome = normalize(stanza) === "home";
      if (!freeExplore || isHome) {
        loadSvg(computeSvgUrl(session), session, () => setExitConfirmOpen(true));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [session, freeExplore]);

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

  /* ---- modalità esplora / lock ---- */
  useEffect(() => {
    const host = document.getElementById("svg-host");
    const svg = host?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;

    const blockWheel = (e: WheelEvent) => e.preventDefault();
    const blockPinch = (e: TouchEvent) => {
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

    if (!svg.getAttribute("data-full-viewbox")) {
      try {
        const bbox = svg.getBBox();
        const pad = 80;
        svg.setAttribute(
          "data-full-viewbox",
          `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
        );
      } catch {
        const vb = svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [0, 0, 800, 600];
        const pad = 200;
        svg.setAttribute(
          "data-full-viewbox",
          `${vb[0] - pad} ${vb[1] - pad} ${vb[2] + pad * 2} ${vb[3] + pad * 2}`
        );
      }
    }

    svg.setAttribute("viewBox", svg.getAttribute("data-full-viewbox")!);
    svg.style.cursor = "grab";

    const navLayer = svg.querySelector<SVGGElement>("#nav-layer");
    if (navLayer) {
      navLayer.querySelectorAll<SVGGElement>("g").forEach(g => {
        g.style.display = "none";
      });
    }

    const stanzaRects = Array.from(svg.querySelectorAll<SVGRectElement>("rect.stanza"));
    const stanzaHandlers = new Map<SVGRectElement, (e: Event) => void>();

    for (const rect of stanzaRects) {
      const label = findRoomLabel(svg, rect);
      if (!label) continue;
      rect.style.cursor = "pointer";
      if (!rect.getAttribute("fill") || rect.getAttribute("fill") === "none") {
        rect.setAttribute("fill", "transparent");
      }
      rect.style.pointerEvents = "all";
      const handler = (e: Event) => {
        e.stopPropagation();
        setRoomConfirmRef.current(label);
      };
      rect.addEventListener("click", handler);
      stanzaHandlers.set(rect, handler);
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

    const onPointerDown = (e: PointerEvent) => {
      if (isPinching) return;
      dragging = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      vbSnapshot = getVB();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || isPinching) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 5) {
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
      if (!dragging || isPinching) return;
      dragging = false;
      svg.style.cursor = "grab";
      if (didDrag) {
        window.addEventListener(
          "click",
          (e) => { e.stopPropagation(); e.preventDefault(); },
          { capture: true, once: true }
        );
      }
    };

    const onWheel = (e: WheelEvent) => {
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
      if (e.touches.length < 2) {
        isPinching = false;
        lastPinchDist = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
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
      for (const [rect, handler] of stanzaHandlers) {
        rect.removeEventListener("click", handler);
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
  }, [freeExplore, session]);

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
    setFreeExplore(false);
    setTimeout(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, 0);
  };

  const handleExitConfirm = () => {
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

  if (!session) return <div style={{ padding: 20 }}>Caricamento…</div>;

  return (
    <>
      <button
        onClick={() => setExitConfirmOpen(true)}
        title="Esci dal percorso"
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
        }}
      >
        EXIT
      </button>

      <button
        onClick={() => {
          if (normalize(currentStanzaLabel ?? "") === "home") return;
          setFreeExplore(prev => !prev);
        }}
        title={
          normalize(currentStanzaLabel ?? "") === "home"
            ? "Zoom disabilitato in HOME"
            : freeExplore
              ? "Torna alla stanza"
              : "Esplora mappa"
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
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      >
        {freeExplore ? "🔒" : "🗺"}
      </button>

      {freeExplore && (
        <div
          style={{
            position: "fixed",
            bottom: 72,
            right: 16,
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
          Trascina per spostarti<br />
          Pizzica per zoomare<br />
          <span style={{ opacity: 0.8 }}>Tocca una stanza per andarci</span>
        </div>
      )}

      <div
        id="svg-host"
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "visible",
          touchAction: "none",
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
              Vuoi spostarti in
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
                Vai
              </button>
              <button
                onClick={() => setRoomConfirm(null)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "1.5px solid #ccc", background: "transparent",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Annulla
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
              Sei sicuro di uscire dalla navigazione attuale?
            </p>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 600 }}>
              Perderai tutti i progressi del percorso in corso.
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
                SI
              </button>
              <button
                onClick={() => setExitConfirmOpen(false)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "1.5px solid #ccc", background: "transparent",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {focusedObject && (
        <ObjectOverlay
          nome={focusedObject}
          session={session}
          onClose={closeObjectFocus}
          showNav={!freeExplore}
        />
      )}
    </>
  );
}

/* ===================== ROOM LABEL FINDER ===================== */

function findRoomLabel(svg: SVGSVGElement, rect: SVGRectElement): string | null {
  let sibling = rect.nextElementSibling;
  while (sibling) {
    if (
      sibling.tagName === "text" &&
      (sibling.getAttribute("class") ?? "").includes("stanza-label")
    ) {
      return sibling.textContent?.trim() ?? null;
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
    if (d < bestDist) { bestDist = d; best = t.textContent?.trim() ?? null; }
  }
  if (best) return best;

  return null;
}

/* ===================== SVG LOADER ===================== */

function loadSvg(url: string, session: Session, onExitRequested: () => void) {
  const host = document.getElementById("svg-host");
  if (!host) return;
  fetch(url)
    .then(r => r.text())
    .then(svgText => {
      host.innerHTML = svgText;
      const svg = host.querySelector<SVGSVGElement>("svg");
      if (!svg) return;
      svg.style.transform = "";
      svg.setAttribute("overflow", "visible");
      svg.style.overflow = "visible";

      const navLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      navLayer.setAttribute("id", "nav-layer");
      svg.appendChild(navLayer);

      renderNavigation(svg);
      bindObjectClicks(svg, session);
      mountExitInOutRoom(svg, onExitRequested);
    });
}

function mountExitInOutRoom(svg: SVGSVGElement, onExitRequested: () => void) {
  const outLabel = Array.from(svg.querySelectorAll<SVGTextElement>("text.stanza-label"))
    .find(label => normalize(label.textContent ?? "") === "out");

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

  exitGroup.appendChild(exitText);
  exitGroup.addEventListener("click", (e) => {
    e.stopPropagation();
    onExitRequested();
  });
  svg.appendChild(exitGroup);
}

/* ===================== NAVIGATION ===================== */

function renderNavigation(svg: SVGSVGElement) {
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
    const label = labelEl.textContent?.trim();
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
  const THRESH = 230;
  const corridorsNearRoom: number[][] = Array.from({ length: rooms.length }, () => []);
  const roomsWithinCorridor: number[][] = Array.from({ length: corridors.length }, () => []);

  // Primo: per ogni room, quali corridor sono abbastanza vicine?
  for (let i = 0; i < rooms.length; i++) {
    const rc = rooms[i].center;
    for (let j = 0; j < corridors.length; j++) {
      const cc = corridors[j].center;
      if (distance(rc, cc) <= THRESH) corridorsNearRoom[i].push(j);
    }
  }

  // Secondo: per ogni corridor, quali room sono abbastanza vicine?
  for (let j = 0; j < corridors.length; j++) {
    const cc = corridors[j].center;
    for (let i = 0; i < rooms.length; i++) {
      const rc = rooms[i].center;
      if (distance(rc, cc) < THRESH) roomsWithinCorridor[j].push(i);
    }
  }

  return { corridorsNearRoom, roomsWithinCorridor };
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
      links.push({ from: fromPoint, to: toRoom.center, label: toRoom.label, corridor });
    }
  }

  return links;
}

/* ===================== DRAW ARROWS ===================== */

function drawArrowText(layer: SVGGElement, link: Link) {
  const ns = "http://www.w3.org/2000/svg";
  const { from, to, corridor } = link;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const rotation =
    corridor.orientation === "vertical"
      ? dy > 0 ? 90 : -90
      : dx > 0 ? 0 : 180;
  const OFFSET = 35;
  const len = Math.hypot(dx, dy) || 1;
  const x = from.x - (dx / len) * OFFSET;
  const y = from.y - (dy / len) * OFFSET;

  const g = document.createElementNS(ns, "g");
  const img = document.createElementNS(ns, "image");
  const SIZE = 40;
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

/* ===================== OBJECT IMAGE REPLACEMENT ===================== */

// Cache modulo: true = preview esiste, false = non esiste, undefined = non verificato.
// Persiste per tutta la sessione browser:
//   - HEAD request fatta una sola volta per oggetto
//   - dal secondo caricamento dell'SVG il cerchio sparisce immediatamente (niente flash)
//   - l'immagine viene servita dalla cache HTTP del browser (Cache-Control: max-age=3600)
const previewExistsCache = new Map<string, boolean>();
// Deduplica le richieste HEAD in corso per lo stesso oggetto.
const previewRequestCache = new Map<string, Promise<boolean>>();

function previewCacheKey(museo: string, nome: string): string {
  return `${museo}__${nome}`;
}

function replaceCircleWithImage(
  svg: SVGSVGElement,
  circle: SVGCircleElement,
  nome: string,
  museo: string
): void {
  const ns = "http://www.w3.org/2000/svg";

  const cx = parseFloat(circle.getAttribute("cx") ?? "0");
  const cy = parseFloat(circle.getAttribute("cy") ?? "0");
  const r  = parseFloat(circle.getAttribute("r")  ?? "10");

  const PREVIEW_SCALE = 2.5; // ← cambia per ingrandire/ridurre le anteprime
  const displayR = r * PREVIEW_SCALE;
  const size = displayR * 2;

  const clipId = `clip-obj-${nome.replace(/\s+/g, "_")}-${Math.round(cx)}-${Math.round(cy)}`;
  const previewUrl = `${API_BASE}/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(nome)}/immagini/preview`;
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

  // Padding dinamico: adatta lo zoom alla scala complessiva del museo.
  const mapArea = Math.max(1, fallbackW * fallbackH);
  const roomArea = Math.max(1, rectW * rectH);
  const areaRatio = Math.sqrt(mapArea / roomArea);
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

  const isSmallMobile = svgW <= 420;
  const isMobile = svgW <= 700;

  // Zoom costante per il museo: aggiunge la riserva massima necessaria per
  // ospitare i navigator laterali in qualunque stanza non-home.
  const mobileBoost = isSmallMobile ? 1.18 : isMobile ? 1.1 : 1;
  const padFactor = clamp(basePadFactor * mobileBoost, 0.75, 1.7);

  const padLeft = rectW * (padFactor + zoomProfile.extraLeftRatio);
  const padRight = rectW * (padFactor + zoomProfile.extraRightRatio);
  const padTop = rectH * (padFactor + zoomProfile.extraTopRatio);
  const padBottom = rectH * (padFactor + zoomProfile.extraBottomRatio + (isMobile ? 0.04 : 0));
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

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
    if (!t) return;
    const nome = t.textContent?.trim();
    if (!nome) return;

    circle.style.cursor = "pointer";

    // ← era pointerdown + preventDefault: su Android richiedeva tap lungo
    circle.addEventListener("click", e => {
      e.stopPropagation();
      openObjectFocus(nome);
    });

    replaceCircleWithImage(svg, circle, nome, session.museo);
  });
}

/* ===================== OBJECT OVERLAY ===================== */

function ObjectOverlay({
  nome,
  session,
  onClose,
  showNav,
}: {
  nome: string;
  session: Session;
  onClose: () => void;
  showNav: boolean;
}) {
  const [descrizione, setDescrizione] = useState<string | null>(null);
  const [immagini, setImmagini]       = useState<{ tipo: string; url: string }[]>([]);
  const [slideIdx, setSlideIdx]       = useState(0);

  useEffect(() => {
    setSlideIdx(0);

    // carica descrizione
    fetch(
      `${API_BASE}/musei/${encodeURIComponent(session.museo)}/oggetti/${encodeURIComponent(nome)}`
    )
      .then(r => r.json())
      .then(d => {
        const prima = d.descrizioni?.[0]?.[0] ?? null;
        setDescrizione(prima);
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
  }, [nome, session]);

  const fetchStanza = async (oggettoNome: string): Promise<string> => {
    const res = await fetch(
      `${API_BASE}/musei/${encodeURIComponent(session.museo)}/oggetti/${encodeURIComponent(oggettoNome)}`
    );
    if (!res.ok) throw new Error("Oggetto non trovato");
    const oggetto = await res.json();
    return oggetto.stanza ?? session.percorso[0];
  };

  const updateURL = async (oggettoCorrente: string, oggettoAltro: string) => {
    try {
      const stanzaOggetto = await fetchStanza(oggettoCorrente);
      history.pushState(null, "", `/?stanza=${stanzaOggetto}/path/${oggettoCorrente}/${oggettoAltro}`);
      onClose();
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Errore updateURL:", err);
    }
  };

  const handleNext = () => {
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index === -1 || index >= percorso.length - 1) return;
    updateURL(percorso[index], percorso[index + 1]);
  };

  const handlePrev = () => {
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index <= 0) return;
    updateURL(percorso[index - 1], percorso[index]);
  };

  const prevSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlideIdx(i => (i - 1 + immagini.length) % immagini.length);
  };

  const nextSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlideIdx(i => (i + 1) % immagini.length);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          minWidth: 300,
          maxWidth: 420,
          width: "90vw",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 48px rgba(0,0,0,0.35)",
        }}
      >
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
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700 }}>{nome}</h2>
          {descrizione
            ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#444" }}>{descrizione}</p>
            : <p style={{ margin: 0, fontSize: 14, color: "#aaa" }}>Caricamento…</p>
          }
        </div>

        {/* ── Navigazione percorso ── */}
        {showNav && (
          <div style={{
            display: "flex", justifyContent: "space-between",
            padding: "12px 24px", borderTop: "1px solid #eee", flexShrink: 0,
          }}>
            <button
              onClick={handlePrev}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: "1.5px solid #ccc", background: "transparent",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >← Precedente</button>
            <button
              onClick={handleNext}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: "none", background: "#185FA5", color: "#fff",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >Successivo →</button>
          </div>
        )}
      </div>
    </div>
  );
}