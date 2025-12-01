const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function testAPI() {
  try {
    // 1️⃣ Lista musei
    let res = await axios.get(`${BASE_URL}/musei`);
    console.log("Lista musei:", res.data.musei);

    // --- Museo di Torino ---
    res = await axios.get(`${BASE_URL}/musei/Museo di Torino`);
    console.log("Museo di Torino:", res.data.nome, "con oggetti:", res.data.oggetti.map(o => o.nome));

    // 2️⃣ Recupero singolo oggetto
    res = await axios.get(`${BASE_URL}/musei/Museo di Torino/oggetti/sarcofago`);
    console.log("Oggetto sarcofago:", res.data);

    // 3️⃣ Percorso tra oggetti collegati
    // sarcofago -> mummia -> collana -> scettro -> maschera
    res = await axios.get(`${BASE_URL}/musei/Museo di Torino/percorso?oggetti=sarcofago,mummia,collana,scettro,maschera`);
    console.log("Percorso sarcofago -> maschera:", res.data.percorso.map(o => o.nome));

    // 4️⃣ Aggiunta nuovo museo
    const nuovoMuseo = {
      nome: "Museo Test",
      citta: "Roma",
      oggetti: [
        { nome: "Test1", stanza: "Sala X", connessi: [], descrizioni: [["Oggetto di prova"]] }
      ]
    };
    res = await axios.post(`${BASE_URL}/musei`, nuovoMuseo);
    console.log(res.data);

    // 5️⃣ Aggiunta oggetto a museo esistente
    const nuovoOggetto = { nome: "Test2", stanza: "Sala Y", connessi: ["Test1"], descrizioni: [["Secondo oggetto di prova"]] };
    res = await axios.post(`${BASE_URL}/musei/Museo Test/oggetti`, nuovoOggetto);
    console.log(res.data);

    // 6️⃣ Modifica oggetto
    const modificaOggetto = { stanza: "Sala Z" };
    res = await axios.put(`${BASE_URL}/musei/Museo Test/oggetti/Test2`, modificaOggetto);
    console.log(res.data);

    // 7️⃣ Eliminazione oggetto
    res = await axios.delete(`${BASE_URL}/musei/Museo Test/oggetti/Test2`);
    console.log(res.data);

    // 8️⃣ Eliminazione museo
    res = await axios.delete(`${BASE_URL}/musei/Museo Test`);
    console.log(res.data);

    console.log("Test completati con successo!");
  } catch (err) {
    if (err.response) {
      console.error("Errore API:", err.response.status, err.response.data);
    } else {
      console.error("Errore:", err.message);
    }
  }
}

testAPI();

