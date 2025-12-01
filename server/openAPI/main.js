//esempio di main per il testing del parser dei musei
const { caricaMuseiDaJSON } = require("./parser_musei.js");

// Carico il file JSON dei musei
const sistema = caricaMuseiDaJSON("musei.json");

// Test: ottengo il percorso tra oggetti
const percorso = sistema.BFS_museo("Museo di Torino", "sarcofago", "maschera");
console.log("Percorso trovato:", percorso);

// Test: ottengo i dettagli di un oggetto
const sarcofago = sistema.get_museo("Museo di Torino").get_oggetto("sarcofago");
console.log("Descrizione completa:", sarcofago.descrizioni[0][0]);

