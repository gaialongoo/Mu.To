# Insegnamento di Tecnologie Web
# CdS In Informatica   
# (A.A. 2025-26)

# Progetto ArtAround 18-33  
_cancellare le dizioni non rilevanti_ 
 
# READ ME DEL PROGETTO ARTAROUND
_una copia IDENTICA di questo file deve trovarsi nella directory del progetto_

## Nome del gruppo: 
_Mu.To_


## Membri del gruppo 
_(ripetere le righe seguenti secondo necessità)_  

* Nome e cognome: `Nicolò Giuliani`, matricola: `0001171301`, mail: `nicolo.giuliani6@studio.unibo.it`
* Nome e cognome: `Gaia Longo`, matricola: `0001160298`, mail: `gaia.longo3@studio.unibo.it`
* LLM (nome e versione e licenza): `Claude Opus 4.8` (Anthropic), licenza proprietaria/commerciale (assistente di sviluppo, via Claude Code)

_Il primo membro della lista verrà considerato come punto di contatto primario. Sarà la persona 
incaricata di spedire mail (sempre e solo dall'indirizzo studio.unibo.it) e tenere contatti con i docenti. Ogni mail deve sempre includere tutti i componenti del gruppo in cc, e deve essere indirizzata a tutti i docenti del corso:_ 

* fabio.vitali@unibo.it
* andrea.schimmenti2@unibo.it
* gianmarco.spinaci2@unibo.it
* remo.grillo@unibo.it

## Tipo progetto
 18-33
_Cancellare le dizioni non rilevanti_

## Data di disponibilità delle applicazioni
29 giugno - 30 giugno
_ Al massimo 15 giorni dopo la data di sottomissione del file README_

## Locazione del progetto:

* URI del marketplace: `https://site242552.tw.cs.unibo.it/marketplace?museo=<NomeMuseo>`
* URI del navigator: `https://site242552.tw.cs.unibo.it/`
* Altri URI rilevanti:
  * Editor musei: `https://site242552.tw.cs.unibo.it/editor`
  * API REST (server openAPI, proxata dal BFF): `https://site242552.tw.cs.unibo.it/api`
  * Health check BFF: `https://site242552.tw.cs.unibo.it/health`

## Organizzazione dei sorgenti

Struttura delle directory del progetto:

```
Mu.To/
├── server/
│   └── openAPI/                API REST principale (Node.js + Express + MongoDB)
│       ├── openAPI_server.js   server applicativo (oggetti, percorsi, utenti,
│       │                       visite guidate, generazione IA, marketplace)
│       ├── extra/
│       │   └── musei_api.yaml  documentazione API in formato OpenAPI 3 / Swagger
│       │                       (apribile con Swagger Editor/UI: editor.swagger.io)
│       └── scripts/            utility CLI (bootstrap admin, codici professore, QR)
│
├── navigator/
│   ├── UI/
│   │   └── bff/                applicazione server-side intermedia (BFF)
│   │       ├── server_bff.js   serve le SPA e fa da proxy verso /api
│   │       ├── marketplace/    SPA Marketplace  (Alpine.js + vanilla JS)
│   │       ├── viewer/         SPA Navigator/Viewer  (React + TypeScript)
│   │       ├── editor/         SPA Editor musei  (React)
│   │       ├── lib/  img/  cert/
│   │       └── dist/ (per ogni SPA: build di produzione servita dal BFF)
│   │
│   └── map-creator/            generazione layout/mappe dei musei
│       └── js_server/          server Node/Express (layout, generazione SVG)
│
├── foto/                       asset immagini di backup
└── README.txt / README.md
```

Ogni SPA (`marketplace`, `viewer`, `editor`) ha sorgenti in `src/` e viene compilata
con Vite in `dist/`, che il BFF serve come contenuto statico. Le chiamate `/api`
vengono inoltrate dal BFF al server openAPI (porta 3000) iniettando la `X-API-Key`.


## Tecnologie utilizzate
_Inserire qui il linguaggio utilizzato, il o i framework utilizzati e ogni pacchetto NPM installato a parte quelli preinstallati_

#### Server-side
* **Linguaggio:** JavaScript (Node.js)
* **Framework:** Express
* **Database:** MongoDB
* **API openAPI** — pacchetti NPM: `express`, `mongodb`, `multer` (upload immagini),
  `sharp` (elaborazione immagini), `qrcode` (generazione QR), `axios`, `cors`, `dotenv`
* **BFF (server_bff.js)** — pacchetti NPM: `express`, `undici`, `dotenv`
* **map-creator / js_server** (generazione SVG) — `express`, `mongodb`, `cors`, `node-fetch`, `dotenv`
* **IA:** provider **Groq** (API OpenAI-compatibile), modello `llama-3.3-70b-versatile`,
  configurabile via env (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`)

#### Applicazione marketplace
* **Linguaggio:** JavaScript (ES modules)
* **Nessun framework UI pesante.** Reattività con **Alpine.js** (micro-libreria) +
  JavaScript vanilla; CSS scritto a mano
* **Build:** Vite (solo bundler/dev-server, non framework UI)
* **Pacchetti NPM installati a parte:** `alpinejs`; `vite` (dev)

#### Applicazione navigator
* **Viewer (navigator):** TypeScript + **React 19** (`react`, `react-dom`), build con Vite.
  Pacchetti: `qr-scanner` (scansione QR), `vosk-browser` (riconoscimento vocale offline)
* **Editor (creazione/modifica musei):** **React 19** (`react`, `react-dom`), build con Vite


## Contributo individuale
#### Nicolò Giuliani: backend API, logica SVG server + navigator
#### Gaia Longo: home, marketplace, frontend
Molte parti sono state sviluppate da entrambi, come editor, db (persone, oggetti, percorsi, musei), la logica della IA
#### LLM: scrittura di alcune parti del codice, test-debug del codice


















