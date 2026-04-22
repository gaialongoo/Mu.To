# Art Around

Progetto TW 2025/26 per la navigazione museale guidata, con:
- API backend (`server/openAPI`)
- generazione SVG dinamica (`navigator/map-creator/js_server`)
- interfaccia web BFF + viewer (`navigator/UI/bff`)

## Architettura rapida

- **OpenAPI server**: gestisce musei, oggetti, percorsi, layout e immagini.
- **SVG server**: legge dati/layout via API e genera l'SVG del museo.
- **BFF/UI**: espone frontend (homepage, navigator viewer, marketplace, editor).

Flusso tipico:
1. UI chiama `/api/...` sul BFF
2. BFF inoltra a OpenAPI
3. Viewer richiede `/svg/...` al server SVG

---

## Prerequisiti

- Node.js 18+ (consigliato 20+)
- MongoDB attivo
- File `.env` configurato in `server/openAPI/.env`

Variabili importanti (OpenAPI):
- `API_KEY`
- `MONGO_URI`
- `API_PORT`, `API_HOST`

---

## Avvio del progetto

Servono **3 terminali** separati.

### Terminale 1 - OpenAPI server

```bash
cd server/openAPI
npm install
node openAPI_server.js
```

### Terminale 2 - SVG server

```bash
cd navigator/map-creator/js_server
npm install
node svg_server.js
```

### Terminale 3 - BFF/UI

```bash
cd navigator/UI/bff
npm install
npm run build
npm start
```

---

## OpenAPI server: opzioni CLI

Il server supporta opzioni da riga comando:

```bash
node openAPI_server.js --help
node openAPI_server.js --version
node openAPI_server.js --bootstrap-mode <mode>
```

### `--bootstrap-mode`

Modalita disponibili:

- `disk-override` (**default**)
  - Carica da `musei.json` e `layout.json`
  - Sincronizza questi dati su MongoDB all'avvio

- `mongo`
  - Carica da MongoDB (musei + layout)
  - Salva uno snapshot locale in `musei.json` e `layout.json`

Esempi:

```bash
# default
node openAPI_server.js

# esplicito
node openAPI_server.js --bootstrap-mode disk-override
node openAPI_server.js --bootstrap-mode mongo
```

---

## Persistenza dati

### Musei

- Fonte file: `server/openAPI/musei.json`
- Collezione Mongo: `musei.musei_db`

Le modifiche API su musei/oggetti/percorsi aggiornano:
- stato runtime del server
- `musei.json`
- MongoDB

### Layout

- Fonte file: `server/openAPI/layout.json`
- Collezione Mongo: `musei.musei_layout`

Le API layout aggiornano anche il file locale:
- `PUT /musei/:nome_museo/layout` -> Mongo + `layout.json`
- `DELETE /musei/:nome_museo/layout` -> Mongo + `layout.json`
- `DELETE /musei/:nome_museo` -> rimozione museo + layout da Mongo e `layout.json`

---

## Sicurezza API

Quasi tutte le route richiedono header:

```http
X-API-Key: <valore API_KEY nel .env>
```

Esempio:

```bash
curl -k -H "X-API-Key: test" https://localhost:3000/musei
```

---

## Endpoint utili

- `GET /musei` lista musei
- `GET /musei/:nome_museo` museo completo
- `POST /musei` crea museo
- `POST /musei/:nome_museo/oggetti` aggiunge oggetto
- `POST /musei/:nome_museo/percorsi` crea percorso
- `GET /musei/:nome_museo/layout` leggi layout
- `PUT /musei/:nome_museo/layout` aggiorna layout
- `DELETE /musei/:nome_museo/layout` elimina layout

Spec completa: `server/openAPI/extra/musei_api.yaml`

---

## Codici accesso professore

Per creare un account **professore**, in fase di registrazione l'utente puo inserire un **Codice accesso professore**.

- **Codici multipli**: sono supportati piu codici contemporaneamente.
- **Nessun codice in chiaro**: i codici sono salvati su MongoDB **solo come hash (SHA-256)**.
- **Controllo**:
  - se il campo e vuoto -> l'utente viene creato come `utente`
  - se il campo e pieno -> il server calcola `sha256(codice)` e verifica che esista in `utenti.professor_codes` con `enabled: true`
    - se esiste -> ruolo `professore`
    - se non esiste -> errore `codice professore non valido`

### Generare codici professore (script)

Lo script genera codici (stampa a schermo quelli in chiaro) e salva su MongoDB soltanto gli hash.

```bash
cd server/openAPI
npm run gen:prof-codes
```

Opzioni:

```bash
node scripts/generate_professor_codes.js --count 10 --length 12 --prefix PROF
```

Note:
- Salva i codici stampati: **non vengono recuperati** dal DB (perche nel DB c'e solo l'hash).
- Collection: `utenti.professor_codes`.

---

## Troubleshooting rapido

- **401 / 403 API key**: verifica `X-API-Key` e `API_KEY` nel `.env`
- **Mongo non raggiungibile**: controlla `MONGO_URI` e servizio Mongo attivo
- **Viewer con mappa vuota/piccola**: verifica che esista il layout (`GET /musei/<nome>/layout`)
- **Certificato HTTPS locale**: usa `curl -k` in ambiente sviluppo