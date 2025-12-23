import { useEffect, useState } from "react";

/* ===================== SESSION / COOKIE ===================== */

const COOKIE_NAME = "museo_session";
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

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
  if (typeof session.museo !== "string") return false;
  if (!Array.isArray(session.percorso)) return false;
  if (session.percorso.length < 2) return false;
  if (!session.createdAt) return false;

  const age = Date.now() - session.createdAt;
  return age >= 0 && age <= SESSION_MAX_AGE;
}

/* ===================== CONFIG ===================== */

const SVG_SERVER_BASE = "http://192.168.1.119:3001";

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

  // 🔒 carica la sessione
  useEffect(() => {
    const s = getSession();
    console.log("SESSIONE LETTA DA REACT:", s);

    if (isSessionValid(s)) {
      setSession(s);
    }
  }, []);

  // 🔒 carica SVG
  useEffect(() => {
    if (!session) return;

    const svgUrl = `${SVG_SERVER_BASE}/${encodeURIComponent(session.museo)}`;
    loadSvg(svgUrl);
  }, [session]);
  
  // 🔒 gestisci cambio stanza via popstate
  useEffect(() => {
    if (!session) return;
    
    ensureDefaultStanza(session);
    
    const onPop = () => {
      const host = document.getElementById("svg-host");
      const svg = host?.querySelector("svg") as SVGSVGElement | null;
      if (svg) renderNavigation(svg);
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [session]);

  if (!session) {
    return <div style={{ padding: 20 }}>Caricamento…</div>;
  }

  return (
    <div
      id="svg-host"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    />
  );
}

/* ===================== SVG LOADER ===================== */

function loadSvg(url: string) {
  const host = document.getElementById("svg-host");
  if (!host) return;

  fetch(url)
    .then((r) => r.text())
    .then((svgText) => {
      host.innerHTML = svgText;

      const svg = host.querySelector("svg") as SVGSVGElement | null;
      if (!svg) return;

      const navLayer = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      navLayer.setAttribute("id", "nav-layer");
      svg.appendChild(navLayer);

      renderNavigation(svg);
    })
    .catch((err) => {
      console.error("Errore SVG:", err);
      host.innerHTML = "<div style='padding:20px'>Errore SVG</div>";
    });
}

/* ===================== RENDER NAVIGATION ===================== */

function renderNavigation(svg: SVGSVGElement) {
  const navLayer = svg.querySelector("#nav-layer") as SVGGElement;
  if (!navLayer) return;

  navLayer.innerHTML = "";

  const ORIGINAL_VIEWBOX = svg.getAttribute("viewBox") ?? "0 0 1200 1780";

  const raw = new URLSearchParams(window.location.search).get("stanza");
  if (!raw) {
    svg.setAttribute("viewBox", ORIGINAL_VIEWBOX);
    return;
  }

  const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  const stanza = decoded.split("/")[0];

  const rooms = extractRooms(svg);
  const corridors = extractCorridors(svg);

  const current = rooms.find(
    (r) => normalize(r.label) === normalize(stanza)
  );
  if (!current) return;

  zoomToRect(svg, current.rect, 60);

  const links = computeLinks(current, rooms, corridors);
  for (const l of links) {
    drawArrowText(navLayer, l);
  }
}

/* ===================== DEFAULT STANZA ===================== */

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
  const children = Array.from(svg.children);
  let lastRect: SVGRectElement | null = null;

  for (const el of children) {
    if (el.tagName === "rect") {
      const r = el as SVGRectElement;
      if ((r.getAttribute("class") ?? "").includes("stanza")) {
        lastRect = r;
      } else {
        lastRect = null;
      }
    }

    if (el.tagName === "text" && lastRect) {
      const t = el as SVGTextElement;
      if ((t.getAttribute("class") ?? "").includes("stanza-label")) {
        const label = t.textContent?.trim();
        if (label) {
          rooms.push({
            label,
            rect: lastRect,
            center: rectCenter(lastRect),
          });
        }
      }
    }
  }
  return rooms;
}

function extractCorridors(svg: SVGSVGElement): Corridor[] {
  return Array.from(svg.querySelectorAll("rect.corridoio")).map((r) => {
    const w = +r.getAttribute("width")!;
    const h = +r.getAttribute("height")!;
    return {
      rect: r as SVGRectElement,
      center: rectCenter(r as SVGRectElement),
      orientation: h > w ? "vertical" : "horizontal",
    };
  });
}

/* ===================== NAV LOGIC ===================== */

function computeLinks(
  from: Room,
  rooms: Room[],
  corridors: Corridor[]
): Link[] {
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

/* ===================== DRAW FRECCE ===================== */

function drawArrowText(layer: SVGGElement, link: Link) {
  const ns = "http://www.w3.org/2000/svg";

  const { from, to, corridor } = link;
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // PNG base → punta a DESTRA
  let rotation = 0;
  if (corridor.orientation === "vertical") {
    rotation = dy > 0 ? 90 : -90;
  } else {
    rotation = dx > 0 ? 0 : 180;
  }

  const OFFSET = 35;
  const len = Math.hypot(dx, dy) || 1;

  const x = from.x - (dx / len) * OFFSET;
  const y = from.y - (dy / len) * OFFSET;

  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "nav-arrow-group");
  g.style.pointerEvents = "all";

  const img = document.createElementNS(ns, "image");
  const SIZE = 40;
  img.setAttribute("href", "/icons/arrow-right.png");
  img.setAttribute("width", `${SIZE}`);
  img.setAttribute("height", `${SIZE}`);
  img.setAttribute("x", "0");
  img.setAttribute("y", "0");
  img.setAttribute("class", "nav-arrow-img");
  img.style.pointerEvents = "all";

  g.setAttribute(
    "transform",
    `translate(${x}, ${y}) rotate(${rotation}) translate(${-SIZE / 2}, ${-SIZE / 2})`
  );

  const animMove = document.createElementNS(ns, "animateTransform");
  animMove.setAttribute("attributeName", "transform");
  animMove.setAttribute("type", "translate");
  animMove.setAttribute("additive", "sum");
  animMove.setAttribute("values", "0 0; 7 0; 0 0");
  animMove.setAttribute("dur", "1.6s");
  animMove.setAttribute("repeatCount", "indefinite");

  const animOpacity = document.createElementNS(ns, "animate");
  animOpacity.setAttribute("attributeName", "opacity");
  animOpacity.setAttribute("values", "1; 0.75; 1");
  animOpacity.setAttribute("dur", "1.6s");
  animOpacity.setAttribute("repeatCount", "indefinite");

  const go = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    goToRoom(link.label);
  };

  g.addEventListener("pointerdown", go, { passive: false });
  g.addEventListener("touchstart", go as any, { passive: false });

  g.appendChild(img);
  g.appendChild(animMove);
  g.appendChild(animOpacity);
  layer.appendChild(g);
}

/* ===================== GEOMETRY & UTILS ===================== */

function rectCenter(r: SVGRectElement): Point {
  const x = +r.getAttribute("x")!;
  const y = +r.getAttribute("y")!;
  const w = +r.getAttribute("width")!;
  const h = +r.getAttribute("height")!;
  return { x: x + w / 2, y: y + h / 2 };
}

function zoomToRect(svg: SVGSVGElement, rect: SVGRectElement, pad: number) {
  const x = +rect.getAttribute("x")!;
  const y = +rect.getAttribute("y")!;
  const w = +rect.getAttribute("width")!;
  const h = +rect.getAttribute("height")!;
  svg.setAttribute(
    "viewBox",
    `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`
  );
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function goToRoom(label: string) {
  const url = new URL(window.location.href);

  const raw = url.searchParams.get("stanza") ?? "";
  const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  const parts = decoded.split("/").map((p) => p.trim());

  const path = parts.length > 1 ? "/" + parts.slice(1).join("/") : "";

  url.searchParams.set("stanza", `${label}${path}`);
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}