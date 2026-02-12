import { useEffect, useState } from "react";

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

function isSessionValid(session: Session | null): session is Session {
  if (!session) return false;
  if (!session.museo) return false;
  if (!Array.isArray(session.percorso)) return false;
  if (session.percorso.length < 1) return false;

  const age = Date.now() - session.createdAt;
  return age >= 0 && age <= SESSION_MAX_AGE;
}

/* ===================== CONFIG ===================== */

const SVG_SERVER_BASE = "http://192.168.1.119:3001";
const API_BASE = "/api";

/* ===================== STANZA / PATH LOGIC ===================== */

type ParsedStanza = {
  stanza: string;
  svgPath: string | null;
};

function parseStanzaFromUrl(session: Session): ParsedStanza {
  const raw = new URLSearchParams(window.location.search).get("stanza");

  if (!raw) {
    return {
      stanza: session.percorso[0],
      svgPath: null,
    };
  }

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

/* ===================== COMPONENT ===================== */

export default function SvgViewer() {
  const [session, setSession] = useState<Session | null>(null);
  const [focusedObject, setFocusedObject] = useState<string | null>(null);

  useEffect(() => {
    function syncSession() {
      const s = getSession();
      if (isSessionValid(s)) setSession(s);
      else setSession(null);
    }

    syncSession();
    window.addEventListener("museo-session-ready", syncSession);
    return () =>
      window.removeEventListener("museo-session-ready", syncSession);
  }, []);

  /* ---- carica SVG (dipende da PATH) ---- */
  useEffect(() => {
    if (!session) return;
    loadSvg(computeSvgUrl(session));
  }, [session]);

  /* ---- popstate: ricarica SVG + nav ---- */
  useEffect(() => {
    if (!session) return;

    ensureDefaultStanza(session);

    const onPop = () => {
      loadSvg(computeSvgUrl(session));
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [session]);

  /* ---- overlay oggetto ---- */
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

  if (!session) return <div style={{ padding: 20 }}>Caricamento…</div>;

  return (
    <>
      <div
        id="svg-host"
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      />

      {focusedObject && (
        <ObjectOverlay
          nome={focusedObject}
          session={session}
          onClose={closeObjectFocus}
        />
      )}
    </>
  );
}

/* ===================== SVG LOADER ===================== */

function loadSvg(url: string) {
  const host = document.getElementById("svg-host");


  if (!host) return;

  fetch(url)
    .then(r => r.text())
    .then(svgText => {
      host.innerHTML = svgText;
      const svg = host?.querySelector("svg");
      if (svg) {
        // sposta tutto il contenuto verso l'alto di 500px
        svg.style.transform = "translateY(-200px)";
      }      
      if (!svg) return;

      const navLayer = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      navLayer.setAttribute("id", "nav-layer");
      svg.appendChild(navLayer);

      renderNavigation(svg);
      bindObjectClicks(svg);
    });
}

/* ===================== NAVIGATION ===================== */

function renderNavigation(svg: SVGSVGElement) {
  const navLayer = svg.querySelector("#nav-layer") as SVGGElement;
  if (!navLayer) return;

  navLayer.innerHTML = "";

  const session = getSession();
  if (!session) return;

  const { stanza } = parseStanzaFromUrl(session);

  const corridors = extractCorridors(svg);
  const rooms = extractRooms(svg);

  const current = rooms.find(r => normalize(r.label) === normalize(stanza));
  if (!current) return;

  zoomToRect(svg, current.rect, 10);

  const links = computeLinks(current, rooms, corridors);
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
  let lastRect: SVGRectElement | null = null;

  // Prendi il layer dove vogliamo che le etichette stiano sopra
  const navLayer = svg.querySelector("#nav-layer") as SVGGElement;
  if (!navLayer) throw new Error("Nav layer mancante!");

  for (const el of Array.from(svg.children)) {
    if (el.tagName === "rect") {
      const r = el as SVGRectElement;
      lastRect =
        (r.getAttribute("class") ?? "").includes("stanza") ? r : null;
    }

    if (el.tagName === "text" && lastRect) {
      const t = el as SVGTextElement;
      if ((t.getAttribute("class") ?? "").includes("stanza-label")) {
        // Sposta l'etichetta nel navLayer così sta sopra tutto
        navLayer.appendChild(t);

        rooms.push({
          label: t.textContent!.trim(),
          rect: lastRect,
          center: rectCenter(lastRect),
        });
      }
    }
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

function computeLinks(from: Room, rooms: Room[], corridors: Corridor[]): Link[] {
  const links: Link[] = [];

  for (const c of corridors) {
    if (distance(from.center, c.center) > 230) continue;

    for (const r of rooms) {
      if (r === from) continue;
      if (distance(r.center, c.center) < 230) {
        links.push({
          from: c.center,
          to: r.center,
          label: r.label,
          corridor: c,
        });
      }
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
      ? dy > 0
        ? 90
        : -90
      : dx > 0
      ? 0
      : 180;

  const OFFSET = 35;
  const len = Math.hypot(dx, dy) || 1;

  const x = from.x - (dx / len) * OFFSET;
  const y = from.y - (dy / len) * OFFSET;

  const g = document.createElementNS(ns, "g");
  const img = document.createElementNS(ns, "image");

  const SIZE = 40;
  img.setAttribute("href", "/icons/arrow-right.png");
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

/* ===================== UTILS ===================== */

function rectCenter(r: SVGRectElement): Point {
  const x = +r.getAttribute("x")!;
  const y = +r.getAttribute("y")!;
  const w = +r.getAttribute("width")!;
  const h = +r.getAttribute("height")!;
  return { x: x + w / 2, y: y + h / 2 };
}

function zoomToRect(svg: SVGSVGElement, rect: SVGRectElement, basePad = 20) {
  // dimensioni reali della viewport SVG
  const svgWidth = svg.clientWidth;
  const svgHeight = svg.clientHeight;

  // rettangolo target
  const rectX = +rect.getAttribute("x")!;
  const rectY = +rect.getAttribute("y")!;
  const rectWidth = +rect.getAttribute("width")!;
  const rectHeight = +rect.getAttribute("height")!;

  // calcolo rapporto tra rect e viewport
  const widthRatio = rectWidth / svgWidth;
  const heightRatio = rectHeight / svgHeight;

  // più piccolo il rect rispetto alla pagina => zoom maggiore => più pad
  const dynamicPad = basePad * Math.max(1, 0.5 / Math.min(widthRatio, heightRatio));

  const viewBoxX = rectX - dynamicPad;
  const viewBoxY = rectY - dynamicPad;
  const viewBoxWidth = rectWidth + dynamicPad * 2;
  const viewBoxHeight = rectHeight + dynamicPad * 2;

  svg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
}


function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(s: string) {
  return s.toLowerCase().trim();
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

/* ===================== OBJECT OVERLAY ===================== */

function ObjectOverlay({
  nome,
  session,
  onClose,
}: {
  nome: string;
  session: Session;
  onClose: () => void;
}) {
  const [descrizione, setDescrizione] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      `${API_BASE}/musei/${encodeURIComponent(
        session.museo
      )}/oggetti/${encodeURIComponent(nome)}`
    )
      .then(r => r.json())
      .then(d => {
        const prima = d.descrizioni?.[0]?.[0] ?? null;
        setDescrizione(prima);
      });
  }, [nome, session]);

  // Funzione per aggiornare URL
const updateURL = async (oggettoCorrente: string, oggettoAltro: string) => {
  try {
    // Se è IN o OUT, usiamo direttamente come stanza
    const stanza = oggettoAltro === "IN" || oggettoAltro === "OUT"
      ? oggettoAltro
      : await fetchStanza(oggettoAltro);

    history.replaceState(
      null,
      "",
      `/?stanza=${stanza}/path/${oggettoCorrente}/${oggettoAltro}`
    );

    onClose();
  } catch (err) {
    console.error("Errore updateURL:", err);
  }
};

// Funzione helper per ottenere stanza da API
const fetchStanza = async (oggettoNome: string) => {
  const res = await fetch(
    `${API_BASE}/musei/${encodeURIComponent(session.museo)}/oggetti/${encodeURIComponent(oggettoNome)}`
  );
  if (!res.ok) throw new Error("Oggetto non trovato");
  const oggetto = await res.json();
  return oggetto.stanza ?? "IN"; // fallback
};



  const handleNext = () => {
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index === -1 || index >= percorso.length - 1) return;

    const oggettoCorrente = percorso[index];
    const oggettoSuccessivo = percorso[index + 1];

    updateURL(oggettoCorrente, oggettoSuccessivo);
  };

  const handlePrev = () => {
    const percorso = session.percorso;
    const index = percorso.indexOf(nome);
    if (index <= 0) return;

    const oggettoPrecedente = percorso[index - 1];
    const oggettoCorrente = percorso[index];

    updateURL(oggettoPrecedente, oggettoCorrente);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#fff", padding: 24, borderRadius: 12, minWidth: 300 }}
      >
        <h2>{nome}</h2>
        {descrizione ? <p>{descrizione}</p> : <p>Caricamento…</p>}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button onClick={handlePrev}>Prev</button>
          <button onClick={handleNext}>Next</button>
        </div>
      </div>
    </div>
  );
}



function bindObjectClicks(svg: SVGSVGElement) {
  svg.querySelectorAll<SVGCircleElement>("circle.oggetto").forEach(c => {
    const t = c.nextElementSibling as SVGTextElement | null;
    if (!t) return;
    const nome = t.textContent?.trim();
    if (!nome) return;

    c.style.cursor = "pointer";
    c.addEventListener("pointerdown", e => {
      e.preventDefault();
      openObjectFocus(nome);
    });
  });
}
