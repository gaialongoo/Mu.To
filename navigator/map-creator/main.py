import json
from model import Stanza, Oggetto
from layout import build_layout
from svg_writer import svg_header, svg_footer, draw

# ============================================================
# LEGENDA EDGE_MODE / EDGE_FOCUS
# ============================================================
#
# EDGE_MODE controlla QUALI percorsi vengono disegnati nello SVG
#
# ───────────────────────────────────────────────────────────
# EDGE_MODE = "all"
# ───────────────────────────────────────────────────────────
# Mostra TUTTE le frecce del museo:
#   - frecce ROSSE  → connessioni reali tra oggetti
#   - frecce NERE   → percorsi di servizio (IN / OUT / WC / SHOP)
#
# In questa modalità EDGE_FOCUS viene IGNORATO.
# È utile per:
#   - debug
#   - analisi del grafo
#   - progettazione del layout
#
# Esempio:
#   EDGE_MODE = "all"
#   EDGE_FOCUS = ["Altare Sacro", "OUT"]  # ignorato
#
# ───────────────────────────────────────────────────────────
# EDGE_MODE = "path"
# ───────────────────────────────────────────────────────────
# Mostra UN SOLO percorso minimo tra DUE oggetti specificati
# in EDGE_FOCUS.
#
# EDGE_FOCUS DEVE essere una lista di DUE nomi:
#   EDGE_FOCUS = ["Oggetto A", "Oggetto B"]
#
# Il colore del percorso è:
#   - ROSSO se entrambi sono oggetti normali
#   - NERO  se almeno uno è un servizio (IN / OUT / WC / SHOP)
#
# Esempi:
#   EDGE_MODE = "path"
#   EDGE_FOCUS = ["Altare Sacro", "OUT"]              # percorso nero
#
#   EDGE_MODE = "path"
#   EDGE_FOCUS = ["Altare Sacro", "Totem Mesopotamico"]  # percorso rosso
#
# ───────────────────────────────────────────────────────────
# EDGE_MODE = "services"
# ───────────────────────────────────────────────────────────
# Mostra SOLO le frecce nere verso i servizi
# (IN / OUT / WC / SHOP).
#
# EDGE_FOCUS viene ignorato.
#
# ───────────────────────────────────────────────────────────
# EDGE_MODE = "none"
# ───────────────────────────────────────────────────────────
# Non mostra NESSUNA freccia.
# Solo stanze, corridoi e oggetti.
#
# ============================================================
EDGE_MODE = "path"
EDGE_FOCUS = ["Altare Sacro", "OUT"]

with open("layout.json") as f:
    layout = json.load(f)

with open("museo.json") as f:
    data = json.load(f)

stanze = {}
for nome, info in layout["grid"].items():
    s = Stanza(nome)
    s.row = info["row"]
    s.col = info["col"]
    s.tipo = info.get("tipo", "normale")
    stanze[nome] = s

oggetti = []
for o in data["oggetti"]:
    s = stanze[o["stanza"]]
    obj = Oggetto(o["nome"], s, o["connessi"])
    obj.visibile = o.get("visibile", True)
    s.oggetti.append(obj)
    oggetti.append(obj)

corridoi = build_layout(list(stanze.values()))

for o in oggetti:
    if o.stanza.tipo in ("ingresso", "uscita", "bagno", "servizio"):
        s = o.stanza
        o.pos = (s.x + s.w/2, s.y + s.h/2)

w = max(s.x + s.w for s in stanze.values()) + 200
h = max(s.y + s.h for s in stanze.values()) + 200

svg = svg_header(data["nome"], w, h)
svg = draw(svg, list(stanze.values()), corridoi, oggetti,
           edge_mode=EDGE_MODE, edge_focus=EDGE_FOCUS)
svg += svg_footer()

with open("museo.svg", "w") as f:
    f.write(svg)

print("SVG generato: museo.svg")
