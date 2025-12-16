import json
from model import Stanza, Oggetto
from layout import build_layout
from svg_writer import svg_header, svg_footer, draw

# ============================================================
# LEGENDA EDGE_MODE / EDGE_FOCUS
#
# EDGE_MODE = "all"      → tutte le frecce
# EDGE_MODE = "none"     → nessuna freccia
# EDGE_MODE = "services" → solo frecce nere (IN/OUT/WC/SHOP)
# EDGE_MODE = "path"     → UN SOLO percorso tra due oggetti
#
# EDGE_FOCUS serve SOLO con EDGE_MODE = "path"
#   EDGE_FOCUS = ["Altare Sacro", "OUT"]
# ============================================================

EDGE_MODE = "path"
EDGE_FOCUS = ["mummia", "collana"]
# EDGE_MODE = "path"
# EDGE_FOCUS = ["Altare Sacro", "OUT"]

# ------------------------------------------------------------
# CARICAMENTO JSON
# ------------------------------------------------------------

with open("layout.json") as f:
    layout = json.load(f)

with open("museo.json") as f:
    data = json.load(f)

# ------------------------------------------------------------
# CREAZIONE STANZE
# ------------------------------------------------------------

stanze = {}
for nome, info in layout["grid"].items():
    s = Stanza(nome)
    s.row = info["row"]
    s.col = info["col"]
    s.tipo = info.get("tipo", "normale")
    stanze[nome] = s

# ------------------------------------------------------------
# CREAZIONE OGGETTI REALI (solo museo.json)
# ------------------------------------------------------------

oggetti = []

for o in data["oggetti"]:
    if o["stanza"] not in stanze:
        raise ValueError(f"Stanza '{o['stanza']}' non definita in layout.json")

    s = stanze[o["stanza"]]
    obj = Oggetto(o["nome"], s, o["connessi"])
    obj.visibile = o.get("visibile", True)
    s.oggetti.append(obj)
    oggetti.append(obj)

# ------------------------------------------------------------
# CREAZIONE AUTOMATICA OGGETTI DI SERVIZIO
# (IN / OUT / WC / SHOP)
# ------------------------------------------------------------

for s in stanze.values():
    if s.tipo in ("ingresso", "uscita", "bagno", "servizio"):
        obj = Oggetto(s.nome, s, [])
        obj.visibile = False
        s.oggetti.append(obj)
        oggetti.append(obj)

# ------------------------------------------------------------
# LAYOUT STANZE + CORRIDOI
# ------------------------------------------------------------

corridoi = build_layout(list(stanze.values()))

# ------------------------------------------------------------
# CENTRA OGGETTI DI SERVIZIO NELLA STANZA
# ------------------------------------------------------------

for o in oggetti:
    if o.stanza.tipo in ("ingresso", "uscita", "bagno", "servizio"):
        s = o.stanza
        o.pos = (s.x + s.w / 2, s.y + s.h / 2)

# ------------------------------------------------------------
# DIMENSIONI SVG
# ------------------------------------------------------------

w = max(s.x + s.w for s in stanze.values()) + 200
h = max(s.y + s.h for s in stanze.values()) + 200

# ------------------------------------------------------------
# GENERAZIONE SVG
# ------------------------------------------------------------

svg = svg_header(data["nome"], w, h)
svg = draw(
    svg,
    list(stanze.values()),
    corridoi,
    oggetti,
    edge_mode=EDGE_MODE,
    edge_focus=EDGE_FOCUS
)
svg += svg_footer()

with open("museo.svg", "w") as f:
    f.write(svg)

print("SVG generato: museo.svg")
