//paser base per la creazione dei musei da file
const fs = require("fs");
const { SistemaMusei } = require("./sistema_musei.js");

/**
 * Funzione che carica un file JSON e costruisce il sistema musei
 * @param {string} filePath - percorso del file JSON
 * @returns {SistemaMusei} - oggetto SistemaMusei pronto all'uso
 */
function caricaMuseiDaJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File non trovato: ${filePath}`);
  }

  const rawData = fs.readFileSync(filePath, "utf-8");
  let data;
  try {
    data = JSON.parse(rawData);
  } catch (err) {
    throw new Error("Errore parsing JSON: " + err.message);
  }

  const sistema = new SistemaMusei();

  if (!Array.isArray(data.musei)) {
    throw new Error("Il JSON non contiene un array 'musei'");
  }

  for (const museoData of data.musei) {
    sistema.aggiungi_museo(museoData);
  }

  return sistema;
}

module.exports = { caricaMuseiDaJSON };

