# Mu.To
progetto tw 2025/26

ciao nico il readme è tutto ciò che farò ma sar bava spero tu sia fiero d me

# Avvio del progetto

Per avviare l’intero sistema sono necessari **tre terminali separati**, ognuno dedicato a un server diverso.  
---

## Terminale 1 

```bash
cd server/openAPI
node openAPI_server.js
```

## Terminale 2
```bash 
cd navigator/map-creator/js_server
node svg-server.js
```

## Terminale 3
```bash
cd navigator/UI/bff
npm install (solo la prima volta)
npm run build 
npm start
```