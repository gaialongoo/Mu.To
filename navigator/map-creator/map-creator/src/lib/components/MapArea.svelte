<script>
  import ObjectMarker from './ObjectMarker.svelte';
  import PathLine from './PathLine.svelte';

  export let oggetti = [];
  export let percorsi = [];
  export let aree = [];

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let panStart = null;
  let selectedObject = null;
  let dragStart = null;
  let moved = false;

  // Modalità
  let addingMode = false;   // aggiunta oggetti
  let linkingMode = 'none'; // 'none' | 'area' | 'object'
  let linkingStart = null;
  let unlinkMode = false;

  const mappa = { width: 1000, height: 800 };

  // Pan & Zoom
  function handleMouseDown(event) { 
    if(event.button !== 0) return; 
    panStart = { x: event.clientX, y: event.clientY }; 
    moved = false;
  }

  function handleMouseMove(event) {
    if (panStart) {
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      offsetX += dx;
      offsetY += dy;
      panStart = { x: event.clientX, y: event.clientY };
    }
    if (dragStart && selectedObject && !selectedObject.id) {
      const dx = (event.clientX - dragStart.x) / scale / mappa.width;
      const dy = (event.clientY - dragStart.y) / scale / mappa.height;
      selectedObject.posizione.x += dx;
      selectedObject.posizione.y += dy;
      dragStart = { x: event.clientX, y: event.clientY };
    }
  }

  function handleMouseUp(event) { 
    if(!moved && addingMode) { 
      handleAddObject(event);
      addingMode = false;
    }
    panStart = null; 
    dragStart = null;
  }

  function handleWheel(event) { 
    event.preventDefault(); 
    scale *= event.deltaY < 0 ? 1.1 : 0.9; 
  }

  // Aggiunta oggetti
  function handleAddObject(event) {
    if(event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - offsetX) / (mappa.width * scale);
    const y = (event.clientY - rect.top - offsetY) / (mappa.height * scale);

    const nome = prompt('Nome nuovo oggetto?');
    if(nome) oggetti = [...oggetti, { nome, posizione: { x, y }, connessi: [], descrizioni: [] }];
  }
  function startAddingObject() {
    addingMode = true;
  }

  // Gestione aree (stanze)
  function handleAreaClick(area) {
    if (linkingMode === 'area') {
      if (!linkingStart) {
        linkingStart = area;
        selectedObject = area;
        return;
      }
      if (linkingStart && linkingStart !== area) {
        aree = aree.map(a => {
          if (a.id === linkingStart.id && !a.collegamenti.includes(area.id)) {
            return { ...a, collegamenti: [...a.collegamenti, area.id] };
          }
          if (a.id === area.id && !a.collegamenti.includes(linkingStart.id)) {
            return { ...a, collegamenti: [...a.collegamenti, linkingStart.id] };
          }
          return a;
        });
        linkingStart = area;
        selectedObject = area;
      }
    } else {
      selectedObject = area;
    }
  }

  function handleAreaUnlink(area) {
    if (unlinkMode && linkingStart && linkingStart !== area) {
      aree = aree.map(a => {
        if (a.id === linkingStart.id) {
          return { ...a, collegamenti: a.collegamenti.filter(id => id !== area.id) };
        }
        if (a.id === area.id) {
          return { ...a, collegamenti: a.collegamenti.filter(id => id !== linkingStart.id) };
        }
        return a;
      });
      linkingStart = area; 
      selectedObject = area;
    }
  }

  // Gestione oggetti
  function handleObjectMouseDown(event, oggetto) { 
    if(event.button !== 0) return;
    dragStart = { x: event.clientX, y: event.clientY };
    moved = false;
    selectedObject = oggetto; 
    event.stopPropagation(); 
  }

  function handleObjectMouseMove(event, oggetto) {
    if(dragStart && selectedObject === oggetto){
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    }
  }

  function handleObjectMouseUp(event, oggetto) {
    if(!moved){
      handleObjectClick(oggetto);
    }
    dragStart = null;
  }

  function handleObjectClick(oggetto) {
    if (linkingMode === 'object') {
      if (!linkingStart) {
        linkingStart = oggetto;
        selectedObject = oggetto;
        return;
      }
      if (linkingStart && linkingStart !== oggetto) {
        percorsi = [
          ...percorsi, { 
            da: linkingStart.nome, 
            a: oggetto.nome, 
            punti: [ { ...linkingStart.posizione }, { ...oggetto.posizione } ] 
          }
        ];
        linkingStart = oggetto;
        selectedObject = oggetto;
      }
    } else {
      selectedObject = oggetto;
    }
  }

  // Menu funzioni
  function startAreaLinking() {
    linkingMode = 'area';
    linkingStart = selectedObject && selectedObject.id ? selectedObject : null;
  }
  function startObjectLinking() {
    linkingMode = 'object';
    linkingStart = selectedObject && !selectedObject.id ? selectedObject : null;
  }
  function cancelLinking() {
    linkingMode = 'none';
    linkingStart = null;
  }
  function startUnlinkingAreas() {
    unlinkMode = true;
    linkingMode = 'none';
    linkingStart = selectedObject && selectedObject.id ? selectedObject : null;
  }
  function cancelUnlinking() {
    unlinkMode = false;
    linkingStart = null;
  }
</script>

<div style="display:flex;">
  <svg width={mappa.width} height={mappa.height} 
       on:wheel={handleWheel} 
       on:mousedown={handleMouseDown} 
       on:mousemove={handleMouseMove} 
       on:mouseup={handleMouseUp}
       style="border:1px solid #aaa; cursor: grab;"
  >
    <g transform="translate({offsetX},{offsetY}) scale({scale})">

      {#each aree as area (area.id)}
        <rect
          x={area.x*mappa.width} y={area.y*mappa.height}
          width={area.width*mappa.width} height={area.height*mappa.height}
          fill="rgba(0,128,255,0.2)" 
          stroke={selectedObject === area ? "red" : "blue"} 
          stroke-width="2"
          on:click={() => {
            if (unlinkMode) {
              handleAreaUnlink(area);
            } else {
              handleAreaClick(area);
            }
          }} 
          style="cursor:pointer;"
        />
        <text x={area.x*mappa.width+5} y={area.y*mappa.height+15} font-size="12" fill="blue">{area.nome}</text>

        {#each area.collegamenti as collegataId}
          {#if aree.find(a => a.id === collegataId)}
            <line
              x1={area.x*mappa.width + area.width*mappa.width/2}
              y1={area.y*mappa.height + area.height*mappa.height/2}
              x2={aree.find(a => a.id === collegataId).x*mappa.width + aree.find(a => a.id === collegataId).width*mappa.width/2}
              y2={aree.find(a => a.id === collegataId).y*mappa.height + aree.find(a => a.id === collegataId).height*mappa.height/2}
              stroke="gray" stroke-width="3"
            />
          {/if}
        {/each}
      {/each}

      {#each percorsi as percorso (percorso.da + '_' + percorso.a)}
        <PathLine {percorso} svgWidth={mappa.width} svgHeight={mappa.height}/>
      {/each}

            {#each oggetti as oggetto (oggetto.nome)}
        <ObjectMarker {oggetto} svgWidth={mappa.width} svgHeight={mappa.height}
          on:mousedown={(e)=>handleObjectMouseDown(e, oggetto)}
          on:mousemove={(e)=>handleObjectMouseMove(e, oggetto)}
          on:mouseup={(e)=>handleObjectMouseUp(e, oggetto)}
        />
      {/each}

    </g>
  </svg>

  <div style="margin-left:10px; min-width:240px;">
    {#if selectedObject}
      <h3 style="margin:0 0 8px 0;">{selectedObject.nome}</h3>
      {#if selectedObject.id}
        <div style="margin-bottom:8px; font-size:12px; color:#555;">Stanza (ID: {selectedObject.id})</div>
      {:else}
        <div style="margin-bottom:8px; font-size:12px; color:#555;">Oggetto</div>
      {/if}

      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
        <button on:click={() => {
          const newName = prompt("Nuovo nome:", selectedObject.nome);
          if(newName) selectedObject.nome = newName;
        }}>Rinomina</button>

        <button on:click={() => {
          if(selectedObject.id) {
            // rimuove collegamenti che puntano a questa stanza
            aree = aree.map(a => ({
              ...a,
              collegamenti: a.collegamenti.filter(id => id !== selectedObject.id)
            }));
            aree = aree.filter(a => a.id !== selectedObject.id);
          } else {
            // rimuove i percorsi che coinvolgono l'oggetto
            oggetti = oggetti.filter(o => o.nome !== selectedObject.nome);
            percorsi = percorsi.filter(p => p.da !== selectedObject.nome && p.a !== selectedObject.nome);
          }
          selectedObject = null;
          cancelLinking();
          cancelUnlinking();
        }}>Elimina</button>
      </div>

      <div style="border-top:1px solid #ddd; padding-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
        {#if selectedObject.id}
          <!-- Tasti per collegare/scollegare stanze -->
          <button on:click={startAreaLinking} disabled={linkingMode==='area'}>Collega stanza</button>
          <button on:click={startUnlinkingAreas} disabled={unlinkMode}>Scollega</button>
        {:else}
          <!-- Tasti per collegare oggetti -->
          <button on:click={startObjectLinking} disabled={linkingMode==='object'}>Collega oggetto</button>
        {/if}
        <button on:click={() => { cancelLinking(); cancelUnlinking(); }}>Annulla modalità</button>
      </div>

      {#if linkingMode !== 'none' || unlinkMode}
        <div style="margin-top:8px; font-size:12px; color:#333;">
          Modalità: {unlinkMode ? 'Scollega stanze' : (linkingMode==='area' ? 'Collega stanze' : 'Collega oggetti')}
          {#if linkingStart}
            — punto di partenza: {linkingStart.nome}
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Pulsante per aggiungere oggetti -->
    <div style="margin-top:12px;">
      <button on:click={startAddingObject}>Aggiungi oggetto</button>
    </div>
  </div>
</div>
