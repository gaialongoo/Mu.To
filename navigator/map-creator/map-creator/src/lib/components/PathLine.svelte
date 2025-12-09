<script>
  export let percorso;
  export let svgWidth;
  export let svgHeight;
  $: pointsStr = percorso?.punti?.map(p => `${p.x*svgWidth},${p.y*svgHeight}`).join(' ') || '';
</script>

<polyline points={pointsStr} stroke="blue" stroke-width="2" fill="none"/>
