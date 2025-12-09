<script>
  import { createEventDispatcher } from 'svelte';
  export let oggetto;
  export let svgWidth;
  export let svgHeight;
  const dispatch = createEventDispatcher();

  let xPix = oggetto.posizione.x * svgWidth;
  let yPix = oggetto.posizione.y * svgHeight;
  let dragging = false;

  function handleMouseDown(event) { dragging = true; event.stopPropagation(); }
  function handleMouseUp(event) { dragging = false; event.stopPropagation(); }
  function handleMouseMove(event) {
    if(dragging){
      const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
      xPix = event.clientX - rect.left;
      yPix = event.clientY - rect.top;
      oggetto.posizione.x = xPix / svgWidth;
      oggetto.posizione.y = yPix / svgHeight;
    }
  }
</script>

<g
  on:mousedown={handleMouseDown}
  on:mouseup={handleMouseUp}
  on:mousemove={handleMouseMove}
  style="cursor:grab;"
>
  <circle cx={xPix} cy={yPix} r="8" fill="red"/>
  <text x={xPix+10} y={yPix+4} font-size="12">{oggetto.nome}</text>
</g>
