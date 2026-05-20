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

A partire dalla versione corrente il **BFF orchestra tutto**: avviando
`server_bff.js` vengono lanciati come processi figli anche `openAPI_server.js`
e `svg_server.js`. I log di entrambi i servizi vengono mostrati nello stesso
terminale con prefisso colorato `[API]` (verde) e `[SVG]` (cyan), e in
shutdown (CTRL+C) il BFF termina anche i figli in modo pulito.

### Avvio unico (consigliato)

```bash
# 1) Una volta sola: installa le dipendenze in ognuna delle tre cartelle
cd server/openAPI && npm install && cd -
cd navigator/map-creator/js_server && npm install && cd -
cd navigator/UI/bff && npm install && npm run build

# 2) Da questo momento basta:
cd navigator/UI/bff
npm start
```

### Avvio manuale (debug, opt-out)

Se vuoi avviare OpenAPI o SVG separatamente (es. per fare debug),
imposta `BFF_SPAWN_INTERNAL=false` nell'`.env`. In quel caso il BFF
non spawna nulla e si limita a fare proxy verso le porte gia' attive.

```bash
# in server/openAPI/.env
BFF_SPAWN_INTERNAL=false
```

Poi avvii i tre processi nei terminali separati come prima
(`node openAPI_server.js`, `node svg_server.js`, `npm start`).

### Variabili rilevanti

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `BFF_SPAWN_INTERNAL` | `true` | Se `false`, il BFF non lancia OpenAPI/SVG. |
| `BFF_API_BOOTSTRAP` | `disk-override` | Forwardato a OpenAPI come `--bootstrap-mode`. Valori: `disk-override`, `mongo`. |
| `API_PORT`, `SVG_PORT`, `BFF_PORT` | 3000/3001/8080 | Porte usate dai servizi e dal proxy. |
| `BFF_FORCE_HTTP` | `false` | Disattiva TLS sul BFF anche se `cert/bff.{crt,key}` sono presenti. |
| `BFF_SKIP_QR_BOOTSTRAP` | `false` | Se `true`, non lancia la generazione QR automatica dopo OpenAPI (`BFF_SPAWN_INTERNAL=true`). |

---

## HTTPS sul BFF (per la fotocamera su iPhone)

iOS Safari rifiuta `getUserMedia` (e quindi lo scanner QR del navigator)
quando la pagina e' servita in chiaro. Per questo il BFF puo' partire **direttamente in HTTPS**
usando un certificato self-signed locale.

I file `navigator/UI/bff/cert/bff.{crt,key}` **non sono nel repo**
(ogni sviluppatore li genera in locale). Il certificato va creato per:

- `localhost`, `127.0.0.1`
- l'IP LAN della macchina di sviluppo (es. `192.168.1.144`)

Se vuoi rigenerarlo per un IP diverso (es. perche' lavori su un'altra rete):

```bash
cd navigator/UI/bff/cert
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1   -keyout bff.key -out bff.crt -days 825 -nodes   -subj "/CN=mu.to-dev"   -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.42"
```

Poi su iPhone apri `https://192.168.1.42:8080` (o la porta del BFF) e
accetta l'avviso del certificato self-signed: a quel punto la fotocamera funziona.

Per disattivare temporaneamente HTTPS (es. dietro un reverse proxy che gia' fa TLS),
imposta `BFF_FORCE_HTTP=true` nell'`.env`.

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

### Musei / oggetti / percorsi
- `GET /musei` lista musei
- `GET /musei/:nome_museo` museo completo
- `POST /musei` crea museo
- `POST /musei/:nome_museo/oggetti` aggiunge oggetto
- `PUT /musei/:nome_museo/oggetti/:oggetto` aggiorna oggetto
- `DELETE /musei/:nome_museo/oggetti/:oggetto` cancella oggetto
- `POST /musei/:nome_museo/oggetti/:oggetto/translate-descriptions` traduce le descrizioni IT in EN/FR
- `GET /musei/:nome_museo/percorso?oggetti=A,B,C` BFS multi-tappa
- `GET|POST|DELETE /musei/:nome_museo/percorsi` (+ `/:nome_percorso`) gestione percorsi statici
- `GET|PUT|DELETE /musei/:nome_museo/layout` layout grafico (rooms + corridoi)
- `POST /musei/:nome_museo/layout/translate-labels` traduce le etichette stanze/percorsi

### Immagini (oggetti & stanze)
- `GET|POST|DELETE /musei/:nome_museo/oggetti/:oggetto/immagini[/:tipo]`
- `GET|POST|DELETE /musei/:nome_museo/stanze/:stanza/immagini[/:tipo]`
- Le `GET` di immagini sono pubbliche (senza `X-API-Key`) per permettere il caricamento via `<img>`.

### Utenti
- `POST /users/register|login|logout`
- `GET /users/me`, `PUT /users/me`, `PATCH /users/me/nav-lang`
- `GET /users/me/percorsi`, `POST /users/me/percorsi/acquista`
- `GET /users/me/percorsi/combined?museo=...` percorsi standard + personalizzati visibili
- `GET /users/me/percorsi/personalizzati[?museo=...]`, `GET|DELETE /users/me/percorsi/personalizzati/:id`
- `POST /users/me/percorsi/personalizzati/genera` genera un percorso IA per quel museo
- `GET /users/me/oggetti/richieste`, `POST /users/me/oggetti/acquista-richiesta` (marketplace)
- `GET /users/me/guided-visits` lista visite create dal professore loggato

### Marketplace (admin)
- `GET /admin/marketplace/richieste`, `PATCH /admin/marketplace/richieste/:id`

### Chat IA
- `POST /ai/object-chat` chat sulla scheda di un singolo oggetto
- `POST /ai/museum-chat` "Chiedi alla guida": domande generiche sul museo, posizione, prossima tappa

### QR oggetti
- `POST /qr/validate` valida l'hash di un QR per la coppia (museo, oggetto)

### Visite guidate (professore/studenti)
- `POST /guided-visits`, `PUT /guided-visits/:id`, `DELETE /guided-visits/:id`
- `GET /guided-visits/:id/public` info pubbliche (per landing studente)
- `POST /guided-visits/:id/join` ingresso studente (ritorna `participantToken`)
- `GET /guided-visits/:id/teacher-state` stato per il professore
- `GET /guided-visits/:id/student-state?participantToken=...` polling lato studente
- `POST /guided-visits/:id/participants/:participantId/accept`
- `POST /guided-visits/:id/participants/accept-all`
- `POST /guided-visits/:id/participants/:participantId/remove`
- `POST /guided-visits/:id/navigation` (per `stepIndex`)
- `POST /guided-visits/:id/navigation/by-object` (per `objectName`)
- `POST /guided-visits/:id/navigation/by-node` (per nodo speciale: `IN/OUT/SHOP/WC` o oggetto)
- `POST /guided-visits/:id/quiz/start`, `POST /guided-visits/:id/quiz/submit`
- `GET /guided-visits/:id/results` (voti finali del professore)

Spec completa: `server/openAPI/extra/musei_api.yaml`

---

## Chat IA del navigator

Il navigator espone due chat IA distinte verso lo stesso provider OpenAI-compatibile
(impostato dall'`.env` del server OpenAPI):

### "Dimmi di piu" — chat sulla scheda oggetto
Endpoint: `POST /ai/object-chat`. Risponde **solo** sui dati dell'oggetto
(autore, anno, descrizioni multilivello, immagini disponibili). Le risposte vengono
adattate al profilo utente (livello + durata + interessi + lingua del navigator).

### "Chiedi alla guida" — chat di museo
Endpoint: `POST /ai/museum-chat`. Costruisce un contesto con:
- struttura del museo (stanze, oggetti, label tradotte)
- posizione corrente dello studente (stanza + oggetto + tappa del percorso + percorso completo)
- conversazione precedente (`history`)

E' il backend del bottone **"Chiedi alla guida"** del viewer.
Se il provider IA non e' raggiungibile, le route restituiscono comunque
una risposta di fallback (`source: "fallback"`).

---

## Visite guidate (professori e studenti)

I professori possono creare visite guidate con **step ordinati** (oggetti reali
o "step di solo testo" che il viewer mostra come nodi virtuali `__text__N`),
piu' un **quiz finale** opzionale a risposta multipla.

- Le visite vivono in `users.guided_visits` su MongoDB.
- Lo studente entra con un link tipo `/navigator/?guidedVisit=<id>` e riceve
  un `participantToken` (cookie/local storage), poi fa polling su `student-state`.
- Il professore vede la lista partecipanti, accetta/rifiuta, fa avanzare
  manualmente la visita (`navigation/*`) e gestisce il quiz.
- Quando una visita ha gia' ricevuto un `accept` o `accept-all`,
  diventa **read-only** (`PUT /guided-visits/:id` -> 409).
- Durante una visita guidata il **QR-gate** del viewer e' disattivato:
  in classe non e' pratico far inquadrare il QR a tutti gli studenti.

Comodita' per il professore:
- l'auto-apertura della "Dashboard classe" (URL `?dashboard=1`) chiude
  e marca come visto il tutorial, per non sovrapporsi.
- alla partenza della visita, sia teacher che studenti restano fissati
  sulla stanza speciale `IN` finche' non si avanza al primo oggetto reale.

---

## Marketplace richieste oggetti

Gli utenti standard possono "richiedere" l'aggiunta di un oggetto specifico
in una stanza esistente, a un prezzo fisso (`MARKETPLACE_OBJECT_FIXED_PRICE`,
default 25 EUR). Le richieste vivono in `users.marketplace_object_requests`.

- Utente: `POST /users/me/oggetti/acquista-richiesta` -> stato iniziale `pending`.
- Admin: `GET /admin/marketplace/richieste`, `PATCH /admin/marketplace/richieste/:id`
  con `status: approved|rejected`. Approvare popola anche i dati lato museo.
- Le richieste duplicate (stesso museo+oggetto+stanza ancora `pending`/`approved`)
  vengono deduplicate dal server.

---

## Percorsi personalizzati IA

Un utente loggato puo' chiedere al server di generare un percorso pensato
per il proprio profilo (interessi + livello + durata + lingua del navigator):

```
POST /users/me/percorsi/personalizzati/genera
{ "museo": "Uffizi", "lengthPreset": "medio", "nome": "Visita IA mattina" }
```

- Il server costruisce due chiamate IA (selezione oggetti + descrizioni multilingua),
  con fallback locale se il provider non e' disponibile.
- I percorsi generati restano salvati nel campo `users.percorsiPersonalizzati`
  fino a max ~20 record per utente (cap automatico).
- `GET /users/me/percorsi/combined?museo=...` ritorna percorsi standard visibili
  (gratuiti o gia' acquistati) + percorsi personalizzati di quel museo,
  con un campo `source` (`standard` | `ai_personalized`).
- Rate limit per utente: una chiamata di generazione ogni `PERSONAL_ROUTE_AI_RATE_MS`.

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

## Codici QR oggetti

Ogni oggetto del museo puo' avere un proprio codice QR fisico (stampato e affisso accanto all'opera). Lato **mobile** (touch + viewport <= 900px) il viewer richiede di inquadrare il QR specifico dell'oggetto **prima** di mostrare la scheda con descrizione/chat. Da desktop il comportamento e' invariato (apertura immediata).

- **Per-oggetto**: 1 QR <-> 1 coppia `(museo, oggetto)`. Inquadrare il QR di un'altra opera produce errore.
- **Hash only**: il QR contiene un secret in chiaro `<prefix>-<museo>-<oggetto>-<random>`; su MongoDB e' salvato **solo** `sha256(secret)` nella collection `musei.qr_codes`.
- **Sblocco persistito**: una volta validato, l'oggetto resta sbloccato in `localStorage` (`muto_qr_unlocked_<museo>`) finche' l'utente non fa logout (la `logoutUser()` del viewer ripulisce queste chiavi).
- **Item esenti dal gate**: stanze speciali (`in/out/shop/wc`), nodi virtuali di testo (`__text__...`) e oggetti `objectType="text"` aprono direttamente la scheda anche da mobile.
- **Visite guidate esenti dal gate**: se la sessione ha `guideRole` (teacher/student) o `guidedVisitId`, il QR-gate viene saltato. Motivo: in classe non e' pratico far scansionare il QR a tutti gli studenti; il professore ha gia' validato la presenza fisica.

### Endpoint

```
POST /qr/validate
Headers: X-API-Key: <API_KEY>
Body:    { "codice": "<contenuto QR>", "museo": "<nome>", "oggetto": "<nome>" }

200 -> { "ok": true, "museo": "...", "oggetto": "..." }
404 -> { "error": "Codice QR non valido per quest'opera" }
400 -> parametri mancanti
```

### Generare i QR (CLI)

Lo script crea i secret, fa upsert dei soli hash su MongoDB e genera i PNG dei QR in una cartella di dump (un file per oggetto + un `manifest.json`).

```bash
cd server/openAPI
npm run gen:qr -- --museo Uffizi
```

Opzioni:

```bash
node scripts/generate_qr_codes.js   --museo Uffizi   --oggetti statua,dipinto,anfora   --out ./qr_dump/Uffizi   --length 24   --prefix MUTO   --regenerate
```

```bash
node scripts/generate_qr_codes.js   --all-museums   --skip-existing
```

Con `BFF_SPAWN_INTERNAL=true`, dopo che **OpenAPI** è in ascolto sulla porta configurata il BFF esegue automaticamente `--all-museums --skip-existing` prima di avviare il server SVG (idem CLI sotto): salta solo ciò che ha **MongoDB + PNG** gia' ok; se mancano solo i PNG rigenera (hash aggiornati). Disattiva con `BFF_SKIP_QR_BOOTSTRAP=true`.

- `--museo` — nome del museo come in `musei.json` (obbligatorio salvo con `--all-museums`).
- `--all-museums` — elabora tutti i musei in `musei.json`; con piu' musei `--out` viene ignorato e si usa `qr_dump/<museo>/` per ciascuno.
- `--skip-existing` — salta solo se su MongoDB c'e' un `qr_codes` attivo **e** il PNG esiste gia' in output; se il PNG manca ma il DB ha ancora hash, rimuove i record di quel museo/oggetto e rigenera PNG + nuovo hash.
- `--oggetti` — lista separata da virgola; default = tutti gli oggetti del museo letti da `musei.json` **escludendo gli item di solo testo** (`objectType="text"`, per cui il viewer non chiede mai il QR).
- `--out` — cartella di output (default `server/openAPI/qr_dump/<museo>/`).
- `--length` — lunghezza parte random del secret (default 24, range 8..64).
- `--prefix` — prefisso del secret (default `MUTO`).
- `--regenerate` — rimuove i QR precedenti per gli oggetti specificati prima di reinserirli (utile se devi ristampare).

Output:

```
qr_dump/Uffizi/
  statua.png
  dipinto.png
  anfora.png
  manifest.json
```

Note:
- I secret in chiaro vengono **stampati una sola volta** dallo script: salvali subito se ti servono, perche su Mongo e' memorizzato solo l'hash. Per riemettere il QR di un oggetto basta rilanciare lo script con `--regenerate --oggetti <nome>`.
- La cartella `qr_dump/` e' ignorata da git (vedi `.gitignore`). Il manifest viene riscritto **solo se il contenuto cambia**, cosi' tool tipo nodemon che osservano il progetto non entrano in loop al bootstrap QR.
- Se usi nodemon (o analoghi) sulla cartella `webapp`, escludi comunque `**/server/openAPI/qr_dump/**` dalla watch-list come protezione extra quando generi PNG nuovi.
- Collection: `musei.qr_codes` (campi: `hash`, `museo`, `oggetto`, `enabled`, `createdAt`).

---

## Troubleshooting rapido

- **401 / 403 API key**: verifica `X-API-Key` e `API_KEY` nel `.env`
- **Mongo non raggiungibile**: controlla `MONGO_URI` e servizio Mongo attivo
- **Viewer con mappa vuota/piccola**: verifica che esista il layout (`GET /musei/<nome>/layout`)
- **Certificato HTTPS locale**: usa `curl -k` in ambiente sviluppo
- **QR non valido su mobile**: controlla che il QR provenga dal museo+oggetto giusto e che il record sia presente con `enabled: true` nella collection `musei.qr_codes`. Per saltare il gate in dev, apri il viewer da desktop o disabilita il match `(pointer: coarse) and (max-width: 900px)`.