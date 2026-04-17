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
      .oggetto-label {{ font:10px Arial; fill:black; text-anchor:middle; pointer-events:none; }}

      /* ===== PERCORSI ANIMATI ===== */

      .conn-obj {{
        stroke:#e74c3c;
        stroke-width:4;
        fill:none;
        stroke-linecap:round;
        stroke-dasharray:12 10;
        animation: flow-red 1.2s linear infinite;
      }}

      .conn-obj-debug {{
        stroke:black;
        stroke-width:3;
        fill:none;
        stroke-linecap:round;
        stroke-dasharray:6 6;
        animation: flow-black 0.9s linear infinite;
        opacity:0.85;
      }}

      @keyframes flow-red {{
        from {{ stroke-dashoffset: 0; }}
        to   {{ stroke-dashoffset: -22; }}
      }}

      @keyframes flow-black {{
        from {{ stroke-dashoffset: 0; }}
        to   {{ stroke-dashoffset: -12; }}
      }}
    </style>
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

    def push_point(p):
        if not p:
            return
        if pts and pts[-1][0] == p[0] and pts[-1][1] == p[1]:
            return
        pts.append(p)

    for i in range(len(path) - 1):
        A, B = path[i], path[i + 1]
        c = corr_map[(A, B)]

        from_door = infer_legacy_door(A, B)
        to_door = infer_legacy_door(B, A)

        push_point(from_door)
        for p in corridor_transit_points(c, from_door, to_door):
            push_point(p)
        push_point(to_door)

        if i + 1 < len(path) - 1:
            C = path[i + 2]
            next_from_door = infer_legacy_door(B, C)
            for p in room_transit_points(B, to_door, next_from_door):
                push_point(p)

    push_point(t.pos)
    return pts


def infer_legacy_door(from_room, to_room):
    if to_room.col > from_room.col:
        return from_room.porta["E"]
    if to_room.col < from_room.col:
        return from_room.porta["W"]
    if to_room.row > from_room.row:
        return from_room.porta["S"]
    return from_room.porta["N"]


def corridor_transit_points(corr, from_door, to_door):
    if not corr or not from_door or not to_door:
        return []
    if (corr.w or 0) >= (corr.h or 0):
        y = corr.y + corr.h / 2
        return [(from_door[0], y), (to_door[0], y)]
    x = corr.x + corr.w / 2
    return [(x, from_door[1]), (x, to_door[1])]


def room_transit_points(room, in_door, out_door):
    if not room or not in_door or not out_door:
        return []
    if in_door[0] == out_door[0] or in_door[1] == out_door[1]:
        return [out_door]

    bend_a = (in_door[0], out_door[1])
    bend_b = (out_door[0], in_door[1])
    center = (room.x + room.w / 2, room.y + room.h / 2)
    dist_a = abs(bend_a[0] - center[0]) + abs(bend_a[1] - center[1])
    dist_b = abs(bend_b[0] - center[0]) + abs(bend_b[1] - center[1])
    bend = bend_a if dist_a <= dist_b else bend_b

    return [bend, out_door]


# ---------- DRAW ----------

def draw(svg, stanze, corridoi, oggetti, edge_mode="all", edge_focus=None):

    # ---------- STANZE ----------
    for s in stanze:
        cls = f"stanza {s.tipo}" if s.tipo != "normale" else "stanza"
        svg += f'\n<rect x="{s.x}" y="{s.y}" width="{s.w}" height="{s.h}" rx="8" class="{cls}"/>'
        svg += f'\n<text x="{s.x + s.w / 2}" y="{s.y + 16}" class="stanza-label" text-anchor="middle">{s.nome}</text>'

    # ---------- CORRIDOI ----------
    for c in corridoi:
        svg += f'\n<rect x="{c.x}" y="{c.y}" width="{c.w}" height="{c.h}" class="corridoio"/>'

    # ---------- PERCORSI (SOTTO) ----------

    if edge_mode == "path":
        if edge_focus and len(edge_focus) == 2:
            a = find_object(oggetti, edge_focus[0])
            b = find_object(oggetti, edge_focus[1])
            if a and b:
                d = rounded_path(route_between(a, b, stanze, corridoi))
                cls = "conn-obj-debug" if is_special(a) or is_special(b) else "conn-obj"
                svg += f'\n<path d="{d}" class="{cls}"/>'

    elif edge_mode != "none":
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

        for o, t, cls in edges:
            if edge_mode == "services" and not (is_special(o) or is_special(t)):
                continue
            d = rounded_path(route_between(o, t, stanze, corridoi))
            svg += f'\n<path d="{d}" class="{cls}"/>'

    # ---------- OGGETTI (SOPRA A TUTTO) ----------
    for o in oggetti:
        if o.visibile:
            x, y = o.pos
            svg += f'\n<circle cx="{x}" cy="{y}" r="10" class="oggetto"/>'
            svg += f'\n<text x="{x}" y="{y + 3}" class="oggetto-label">{o.nome}</text>'

    return svg
