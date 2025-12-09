<script>
  import MapArea from '$lib/components/MapArea.svelte';

  let mappa = { svg: 'museo.svg', width: 1000, height: 800 };
  let oggetti = [];
  let percorsi = [];
  let aree = [];

  function handleLoadJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      const data = JSON.parse(e.target.result);
      if (!data.musei || data.musei.length === 0) return;
      const museo = data.musei[0];

      // Ignora SVG quando carico JSON
      mappa.svg = '';

      // Stanze
      const stanzeUniche = [...new Set(museo.oggetti.map(o => o.stanza))];
      const stanzeMap = {};
      aree = stanzeUniche.map((stanza, i) => {
        const area = {
          id: `stanza_${i}`,
          nome: stanza,
          x: 0.05 + (i % 3) * 0.3,
          y: 0.05 + Math.floor(i / 3) * 0.3,
          width: 0.25,
          height: 0.25,
          collegamenti: []
        };
        stanzeMap[stanza] = area;
        return area;
      });

      // Oggetti
      oggetti = museo.oggetti.map(o => {
        const area = stanzeMap[o.stanza];
        return {
          nome: o.nome,
          stanza: o.stanza,
          posizione: {
            x: area.x + area.width / 2 + (Math.random() - 0.5) * 0.1,
            y: area.y + area.height / 2 + (Math.random() - 0.5) * 0.1
          },
          connessi: o.connessi,
          descrizioni: o.descrizioni
        };
      });

      // Connessioni tra oggetti e stanze
      percorsi = [];
      oggetti.forEach(o => {
        o.connessi.forEach(c => {
          const target = oggetti.find(obj => obj.nome === c);
          if (target) {
            if (!percorsi.find(p => (p.da === target.nome && p.a === o.nome) || (p.da === o.nome && p.a === target.nome))) {
              percorsi.push({
                da: o.nome,
                a: target.nome,
                punti: [
                  { ...o.posizione },
                  { ...target.posizione }
                ]
              });
            }

            // Connessione tra stanze
            const stanzaA = stanzeMap[o.stanza];
            const stanzaB = stanzeMap[target.stanza];
            if (stanzaA.id !== stanzaB.id && !stanzaA.collegamenti.includes(stanzaB.id)) {
              stanzaA.collegamenti.push(stanzaB.id);
            }
          }
        });
      });
    };
    reader.readAsText(file);
  }
</script>

<h1>Map Editor Completo</h1>

<div style="margin-bottom:10px;">
  <button on:click={() => saveMap()}>Salva Mappa</button>
  <input type="file" accept=".json" on:change={handleLoadJSON}/>
</div>

<MapArea {mappa} {oggetti} {percorsi} {aree}/>
