from flask import Flask, Response, jsonify
from flask_cors import CORS, cross_origin
import json
import requests
import sys
import traceback
import os
import urllib3
import time
from datetime import datetime

from pymongo import MongoClient

from model import Stanza, Oggetto
from layout import build_layout
from svg_writer import svg_header, svg_footer, draw

# ============================================================
# CONFIG
# ============================================================

HOST = "0.0.0.0"
PORT = 3001

JSON_SERVER = "https://127.0.0.1:3000"
REQUEST_TIMEOUT = 5

ENV_PATH = "../../server/openAPI/.env"
API_KEY_NAME = "API_KEY"

EDGE_MODE_DEFAULT = "path"
EDGE_FOCUS_DEFAULT = ["", ""]

# ---- NODE WAIT ----
NODE_HEALTH_ENDPOINT = "/musei"
NODE_WAIT_TIMEOUT = 60      # secondi max
NODE_WAIT_INTERVAL = 2      # secondi

# ---- MONGO ----
MONGO_URI = "mongodb://127.0.0.1:27017"
MONGO_DB = "musei"
MONGO_COLLECTION = "musei_layout"

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================================
# UTILS
# ============================================================

def log(msg, level="INFO"):
    print(f"[{datetime.now().isoformat()}] [{level}] {msg}")

def json_error(status, error, details=None, upstream_status=None):
    payload = {"error": error}
    if details:
        payload["details"] = details
    if upstream_status is not None:
        payload["upstream_status"] = upstream_status
    return jsonify(payload), status

# ============================================================
# LOAD API KEY
# ============================================================

if not os.path.exists(ENV_PATH):
    log(f".env non trovato: {ENV_PATH}", "FATAL")
    sys.exit(1)

API_KEY = None
with open(ENV_PATH) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(API_KEY_NAME + "="):
            API_KEY = line.split("=", 1)[1].strip()
            break

if not API_KEY:
    log("API_KEY non trovata o vuota", "FATAL")
    sys.exit(1)

log("API_KEY caricata correttamente")

# ============================================================
# WAIT FOR NODE SERVER
# ============================================================

def wait_for_node_server():
    log("Attendo che il server Node sia ONLINE...")

    url = f"{JSON_SERVER}{NODE_HEALTH_ENDPOINT}"
    headers = {
        "X-API-KEY": API_KEY,
        "Accept": "application/json"
    }

    start = datetime.now()

    while True:
        try:
            r = requests.get(url, headers=headers, timeout=3, verify=False)
            if r.status_code == 200:
                log("Server Node ONLINE ✅")
                return
            else:
                log(f"Node risponde ma non pronto (status={r.status_code})")
        except Exception:
            log("Server Node non ancora raggiungibile...")

        elapsed = (datetime.now() - start).total_seconds()
        if elapsed > NODE_WAIT_TIMEOUT:
            log("Timeout: server Node non disponibile", "FATAL")
            sys.exit(1)

        time.sleep(NODE_WAIT_INTERVAL)

# ============================================================
# MONGO CONNECTION
# ============================================================

try:
    mongo_client = MongoClient(MONGO_URI)
    mongo_db = mongo_client[MONGO_DB]
    mongo_layouts = mongo_db[MONGO_COLLECTION]
    log(f"Connessione MongoDB OK -> DB='{MONGO_DB}', collection='{MONGO_COLLECTION}'")
except Exception as e:
    log(f"Errore connessione MongoDB: {e}", "FATAL")
    sys.exit(1)

# ============================================================
# WAIT NODE BEFORE STARTING FLASK
# ============================================================

wait_for_node_server()

# ============================================================
# APP
# ============================================================

app = Flask(__name__)
CORS(app)
log(f"SVG SERVER avviato su http://{HOST}:{PORT}")
log(f"JSON SERVER -> {JSON_SERVER}")

# ============================================================
# LAYOUT LOOKUP (MONGO)
# ============================================================

def get_layout_for_museo(nome_museo):
    doc = mongo_layouts.find_one({"_id": nome_museo})

    if not doc:
        raise KeyError(f"Layout non definito per museo '{nome_museo}'")

    if "grid" not in doc or not isinstance(doc["grid"], dict):
        raise ValueError(f"Layout di '{nome_museo}' non contiene una grid valida")

    return doc

# ============================================================
# SVG GENERATOR
# ============================================================

def genera_svg(data, layout, edge_mode, edge_focus):
    stanze = {}
    oggetti = []

    for nome, info in layout["grid"].items():
        s = Stanza(nome)
        s.row = info["row"]
        s.col = info["col"]
        s.tipo = info.get("tipo", "normale")
        stanze[nome] = s

    for o in data.get("oggetti", []):
        if o["stanza"] not in stanze:
            raise ValueError(f"Stanza '{o['stanza']}' non definita nel layout")
        s = stanze[o["stanza"]]
        obj = Oggetto(o["nome"], s, o.get("connessi", []))
        obj.visibile = o.get("visibile", True)
        s.oggetti.append(obj)
        oggetti.append(obj)

    for s in stanze.values():
        if s.tipo in ("ingresso", "uscita", "bagno", "servizio"):
            obj = Oggetto(s.nome, s, [])
            obj.visibile = False
            s.oggetti.append(obj)
            oggetti.append(obj)

    corridoi = build_layout(list(stanze.values()))

    for o in oggetti:
        if o.stanza.tipo in ("ingresso", "uscita", "bagno", "servizio"):
            s = o.stanza
            o.pos = (s.x + s.w / 2, s.y + s.h / 2)

    w = max(s.x + s.w for s in stanze.values()) + 200
    h = max(s.y + s.h for s in stanze.values()) + 200

    svg = svg_header(data.get("nome", "Museo"), w, h)
    svg = draw(
        svg,
        list(stanze.values()),
        corridoi,
        oggetti,
        edge_mode=edge_mode,
        edge_focus=edge_focus
    )
    svg += svg_footer()

    return svg

# ============================================================
# ROUTES
# ============================================================

@app.route("/favicon.ico")
def favicon():
    return "", 204


@app.route("/<nome_museo>", defaults={"edge_mode": None, "f1": None, "f2": None}, methods=["GET", "OPTIONS"])
@app.route("/<nome_museo>/<edge_mode>", defaults={"f1": None, "f2": None}, methods=["GET", "OPTIONS"])
@app.route("/<nome_museo>/<edge_mode>/<f1>/<f2>", methods=["GET", "OPTIONS"])
@cross_origin(
    origins="*",
    allow_headers=["Content-Type", "X-API-KEY"],
    methods=["GET", "OPTIONS"]
)
def museo_svg(nome_museo, edge_mode, f1, f2):
    edge_mode = edge_mode or EDGE_MODE_DEFAULT
    edge_focus = [f1, f2] if f1 and f2 else EDGE_FOCUS_DEFAULT

    try:
        layout_museo = get_layout_for_museo(nome_museo)
    except Exception as e:
        return json_error(404, "Layout museo non trovato", str(e))

    url = f"{JSON_SERVER}/musei/{nome_museo}"
    headers = {
        "X-API-KEY": API_KEY,
        "Accept": "application/json"
    }

    try:
        r = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, verify=False)
    except Exception:
        return json_error(502, "Connessione al server JSON fallita")

    if r.status_code != 200:
        return json_error(r.status_code, "Errore server JSON")

    try:
        data = r.json()
    except Exception:
        return json_error(502, "JSON non valido dal server JSON")

    try:
        svg = genera_svg(data, layout_museo, edge_mode, edge_focus)
    except Exception as e:
        traceback.print_exc()
        return json_error(500, "Errore generazione SVG", str(e))

    return Response(svg, mimetype="image/svg+xml")

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
