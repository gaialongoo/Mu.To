const express = require('express');
const fs = require('fs');
const app = express();
const PORT = 5000;

// Leggi il file JSON all'avvio
const museiData = JSON.parse(fs.readFileSync('musei.json', 'utf-8')).musei;

// Endpoint per ottenere tutti i musei
app.get('/musei', (req, res) => {
    res.json({ musei: museiData });
});

// Endpoint per ottenere un museo specifico per nome
app.get('/musei/:nome_museo', (req, res) => {
    const nomeMuseo = req.params.nome_museo.toLowerCase();
    const museo = museiData.find(m => m.nome.toLowerCase() === nomeMuseo);
    if (museo) {
        res.json(museo);
    } else {
        res.status(404).json({ error: "Museo non trovato" });
    }
});

// Avvia il server
app.listen(PORT, () => {
    console.log(`Server in ascolto su http://localhost:${PORT}`);
});
