from collections import deque

# ---------- HELPERS ----------

def is_special(o):
    return o.stanza.tipo in ("ingresso", "uscita", "bagno", "servizio")


def find_object(oggetti, nome):
    return next((o for o in oggetti if o.nome == nome), None)


# ---------- SVG ----------

def svg_header(title, w, h):
    return f'''<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 {w} {h}" width="{w}" height="{h}">
  <defs>
    <style>
      .stanza {{ fill:#fff; stroke:#2c3e50; stroke-width:3; }}
      .stanza.ingresso {{ fill:#a9dfbf; stroke:#2ecc71; }}
      .stanza.uscita {{ fill:#f5b7b1; stroke:#e74c3c; }}
      .stanza.bagno {{ fill:#aed6f1; stroke:#3498db; }}
      .stanza.servizio {{ fill:#fad7a0; stroke:#f39c12; }}

      .stanza-label {{ font:bold 14px Arial; fill:#2c3e50; }}

      .corridoio {{ fill:#ecf0f1; stroke:#95a5a6; stroke-width:2; }}

      .oggetto {{ fill:#3498db; stroke:#2980b9; stroke-width:2; }}
      .oggetto-label {{ font:10px Arial; fill:black; text-anchor:middle; }}

      .conn-obj {{
        stroke:#e74c3c;
        stroke-width:3;
        fill:none;
        stroke-dasharray:8,5;
        marker-end:url(#arrow-red);
      }}

      .conn-obj-debug {{
        stroke:black;
        stroke-width:3;
        fill:none;
        stroke-dasharray:4,4;
        marker-end:url(#arrow-black);
      }}
    </style>

    <marker id="arrow-red" markerWidth="12" markerHeight="12"
            refX="10" refY="4" orient="auto">
      <polygon points="0 0, 12 4, 0 8" fill="#e74c3c"/>
    </marker>

    <marker id="arrow-black" markerWidth="12" markerHeight="12"
            refX="10" refY="4" orient="auto">
      <polygon points="0 0, 12 4, 0 8" fill="black"/>
    </marker>
  </defs>
'''
def svg_footer():
    return "</svg>"


# ---------- ROUTING ----------

def rounded_path(points):
    d = [f"M {points[0][0]:.1f} {points[0][1]:.1f}"]
    for x, y in points[1:]:
        d.append(f"L {x:.1f} {y:.1f}")
    return " ".join(d)


def route_between(o, t, stanze, corridoi):
    graph = {s: [] for s in stanze}
    corr_map = {}

    for c in corridoi:
        graph[c.a].append(c.b)
        graph[c.b].append(c.a)
        corr_map[(c.a, c.b)] = c
        corr_map[(c.b, c.a)] = c

    q = deque([o.stanza])
    prev = {o.stanza: None}

    while q:
        cur = q.popleft()
        if cur == t.stanza:
            break
        for n in graph[cur]:
            if n not in prev:
                prev[n] = cur
                q.append(n)

    path = []
    cur = t.stanza
    while cur:
        path.append(cur)
        cur = prev[cur]
    path.reverse()

    pts = [o.pos]

    for i in range(len(path) - 1):
        A, B = path[i], path[i+1]
        c = corr_map[(A, B)]

        if B.col > A.col: pts.append(A.porta["E"])
        elif B.col < A.col: pts.append(A.porta["W"])
        elif B.row > A.row: pts.append(A.porta["S"])
        else: pts.append(A.porta["N"])

        pts.append((c.x + c.w/2, c.y + c.h/2))

        if A.col > B.col: pts.append(B.porta["E"])
        elif A.col < B.col: pts.append(B.porta["W"])
        elif A.row > B.row: pts.append(B.porta["S"])
        else: pts.append(B.porta["N"])

        if i + 1 < len(path) - 1:
            pts.append((B.x + B.w/2, B.y + B.h/2))

    pts.append(t.pos)
    return pts


# ---------- DRAW ----------

def draw(svg, stanze, corridoi, oggetti, edge_mode="all", edge_focus=None):

    # stanze
    for s in stanze:
        cls = f"stanza {s.tipo}" if s.tipo != "normale" else "stanza"
        svg += f'\n<rect x="{s.x}" y="{s.y}" width="{s.w}" height="{s.h}" rx="8" class="{cls}"/>'
        svg += f'\n<text x="{s.x+s.w/2}" y="{s.y-6}" class="stanza-label" text-anchor="middle">{s.nome}</text>'

    # corridoi
    for c in corridoi:
        svg += f'\n<rect x="{c.x}" y="{c.y}" width="{c.w}" height="{c.h}" class="corridoio"/>'

    # oggetti
    for o in oggetti:
        if o.visibile:
            x, y = o.pos
            svg += f'\n<circle cx="{x}" cy="{y}" r="10" class="oggetto"/>'
            svg += f'\n<text x="{x}" y="{y+3}" class="oggetto-label">{o.nome}</text>'

    # -------- PATH MODE (1 solo percorso) --------
    if edge_mode == "path":
        if not edge_focus or len(edge_focus) != 2:
            return svg

        a = find_object(oggetti, edge_focus[0])
        b = find_object(oggetti, edge_focus[1])
        if not a or not b:
            return svg

        d = rounded_path(route_between(a, b, stanze, corridoi))
        cls = "conn-obj-debug" if is_special(a) or is_special(b) else "conn-obj"
        svg += f'\n<path d="{d}" class="{cls}"/>'
        return svg


    # -------- ALTRE MODALITÀ --------
    if edge_mode == "none":
        return svg


    # costruzione edges (come prima)
    specials = [o for o in oggetti if is_special(o)]
    drawn = set()
    edges = []

    for o in oggetti:
        if not is_special(o):
            for name in o.connessi:
                t = next((x for x in oggetti if x.nome == name), None)
                if not t or is_special(t):
                    continue
                key = tuple(sorted((o.nome, t.nome)))
                if key in drawn:
                    continue
                drawn.add(key)
                edges.append((o, t, "conn-obj"))

        for s in specials:
            if s is o:
                continue
            key = tuple(sorted((o.nome, s.nome)))
            if key in drawn:
                continue
            drawn.add(key)
            edges.append((o, s, "conn-obj-debug"))


    # disegno edges
    for o, t, cls in edges:
        if edge_mode == "services" and not (is_special(o) or is_special(t)):
            continue

        d = rounded_path(route_between(o, t, stanze, corridoi))
        svg += f'\n<path d="{d}" class="{cls}"/>'

    return svg

