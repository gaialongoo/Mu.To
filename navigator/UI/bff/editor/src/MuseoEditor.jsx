import { useState, useMemo, useCallback, useEffect, useRef } from "react";
const API_KEY = typeof __API_KEY__ !== "undefined" ? __API_KEY__ : "";

// ─── CONFIG API ────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...(opts.headers ?? {})
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function apiUploadImage(museo, oggetto, tipo, file) {
  const fd = new FormData();
  fd.append("immagine", file, file.name);
  const res = await fetch(
    `/api/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(oggetto)}/immagini/${encodeURIComponent(tipo)}`,
    {
      method: "POST",
      body: fd,
      headers: { "X-API-Key": API_KEY },
    }
  );
  const errText = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Upload ${res.status}: ${errText}`);
  return JSON.parse(errText);
}

async function apiDeleteImage(museo, oggetto, tipo) {
  const res = await fetch(
    `/api/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(oggetto)}/immagini/${tipo}`,
    {
      method: "DELETE",
      headers: { "X-API-Key": API_KEY },
    }
  );
  if (!res.ok) throw new Error(`Delete ${res.status}`);
}

async function apiListImages(museo, oggetto) {
  const res = await fetch(
    `/api/musei/${encodeURIComponent(museo)}/oggetti/${encodeURIComponent(oggetto)}/immagini`,
    { headers: { "X-API-Key": API_KEY } }
  );
  if (!res.ok) throw new Error(`List ${res.status}`);
  return res.json();
}

// ─── COSTANTI LAYOUT ───────────────────────────────────────────────────────
const ROOM_W = 220, ROOM_H = 180;
const START_X = 100, START_Y = 120;
const GAP_X = 120, GAP_Y = 140;

const TIPO_COLORS = {
  normale:  { fill: "#ffffff", stroke: "#2c3e50" },
  ingresso: { fill: "#a9dfbf", stroke: "#2ecc71" },
  uscita:   { fill: "#f5b7b1", stroke: "#e74c3c" },
  bagno:    { fill: "#aed6f1", stroke: "#3498db" },
  servizio: { fill: "#fad7a0", stroke: "#f39c12" },
};

const OBJ_FILL        = "#3498db";
const OBJ_STROKE      = "#2980b9";
const OBJ_TEXT        = "#000000";
const OBJ_SEL_FILL    = "#1a6fa8";
const OBJ_PICK_STROKE = "#27ae60";

const MUSEO_VUOTO = { nome: "", stanze: [], oggetti: [], percorsi: [] };

// ─── LAYOUT ────────────────────────────────────────────────────────────────
function useLayout(stanze, oggetti) {
  const roomPos = useMemo(() => {
    const m = {};
    for (const s of stanze)
      m[s.nome] = { x: START_X + s.col*(ROOM_W+GAP_X), y: START_Y + s.row*(ROOM_H+GAP_Y), w: ROOM_W, h: ROOM_H };
    return m;
  }, [stanze]);

  const corridors = useMemo(() => {
    const grid = {};
    for (const s of stanze) grid[`${s.row},${s.col}`] = s;
    const list = [];
    for (const s of stanze) {
      const p = roomPos[s.nome]; if (!p) continue;
      const east = grid[`${s.row},${s.col+1}`];
      if (east) {
        const ep = roomPos[east.nome];
        list.push({ x: p.x+ROOM_W, y: p.y+ROOM_H/2-20, w: ep.x-(p.x+ROOM_W), h: 40, a: s.nome, b: east.nome });
      }
      const south = grid[`${s.row+1},${s.col}`];
      if (south) {
        const sp = roomPos[south.nome];
        list.push({ x: p.x+ROOM_W/2-20, y: p.y+ROOM_H, w: 40, h: sp.y-(p.y+ROOM_H), a: s.nome, b: south.nome });
      }
    }
    return list;
  }, [stanze, roomPos]);

  const objPos = useMemo(() => {
    const pos = {};
    for (const s of stanze) {
      const p = roomPos[s.nome]; if (!p) continue;
      const ro = oggetti.filter(o => o.stanza === s.nome);
      const cx = p.x + ROOM_W/2, cy = p.y + ROOM_H/2;
      const r  = Math.min(ROOM_W, ROOM_H) * 0.3;
      ro.forEach((o, i) => {
        const a = (2 * Math.PI * i) / ro.length;
        pos[o.nome] = [cx + r*Math.cos(a), cy + r*Math.sin(a)];
      });
    }
    return pos;
  }, [stanze, oggetti, roomPos]);

  const svgW = useMemo(() => stanze.length ? Math.max(...stanze.map(s=>START_X+s.col*(ROOM_W+GAP_X)+ROOM_W))+200 : 800, [stanze]);
  const svgH = useMemo(() => stanze.length ? Math.max(...stanze.map(s=>START_Y+s.row*(ROOM_H+GAP_Y)+ROOM_H))+200 : 600, [stanze]);

  return { roomPos, corridors, objPos, svgW, svgH };
}

// ─── ROUTING BFS ───────────────────────────────────────────────────────────
function routedPath(fromRoom, toRoom, fromPos, toPos, stanze, corridors, roomPos) {
  if (!fromPos || !toPos) return null;
  if (fromRoom === toRoom)
    return `M ${fromPos[0].toFixed(1)} ${fromPos[1].toFixed(1)} L ${toPos[0].toFixed(1)} ${toPos[1].toFixed(1)}`;
  const adj = {};
  for (const s of stanze) adj[s.nome] = [];
  for (const c of corridors) {
    (adj[c.a] = adj[c.a]||[]).push({ to: c.b, corr: c });
    (adj[c.b] = adj[c.b]||[]).push({ to: c.a, corr: c });
  }
  const prev = { [fromRoom]: null }, edgeUsed = {}, queue = [fromRoom];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toRoom) break;
    for (const { to, corr } of (adj[cur] || []))
      if (!(to in prev)) { prev[to] = cur; edgeUsed[to] = corr; queue.push(to); }
  }
  if (!(toRoom in prev))
    return `M ${fromPos[0].toFixed(1)} ${fromPos[1].toFixed(1)} L ${toPos[0].toFixed(1)} ${toPos[1].toFixed(1)}`;
  const roomPath = [];
  let cur = toRoom;
  while (cur != null) { roomPath.push(cur); cur = prev[cur]; }
  roomPath.reverse();
  const pts = [[...fromPos]];
  for (let i = 0; i < roomPath.length - 1; i++) {
    const A = roomPath[i], B = roomPath[i+1];
    const corr = edgeUsed[B];
    const pA = roomPos[A], pB = roomPos[B];
    let exitA, enterB;
    if      (pB.x > pA.x) { exitA=[pA.x+ROOM_W, pA.y+ROOM_H/2]; enterB=[pB.x,          pB.y+ROOM_H/2]; }
    else if (pB.x < pA.x) { exitA=[pA.x,         pA.y+ROOM_H/2]; enterB=[pB.x+ROOM_W,   pB.y+ROOM_H/2]; }
    else if (pB.y > pA.y) { exitA=[pA.x+ROOM_W/2,pA.y+ROOM_H];   enterB=[pB.x+ROOM_W/2, pB.y];          }
    else                   { exitA=[pA.x+ROOM_W/2,pA.y];           enterB=[pB.x+ROOM_W/2, pB.y+ROOM_H];  }
    pts.push(exitA, [corr.x+corr.w/2, corr.y+corr.h/2], enterB);
  }
  pts.push([...toPos]);
  return smoothPath(pts);
}

function smoothPath(pts) {
  if (pts.length < 2) return "";
  const R = 14;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i-1], cur = pts[i], next = pts[i+1];
    const d1 = Math.hypot(cur[0]-prev[0], cur[1]-prev[1]);
    const d2 = Math.hypot(next[0]-cur[0], next[1]-cur[1]);
    const t1 = d1>0 ? Math.min(R,d1/2)/d1 : 0;
    const t2 = d2>0 ? Math.min(R,d2/2)/d2 : 0;
    const p1 = [cur[0]-(cur[0]-prev[0])*t1, cur[1]-(cur[1]-prev[1])*t1];
    const p2 = [cur[0]+(next[0]-cur[0])*t2, cur[1]+(next[1]-cur[1])*t2];
    d += ` L ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Q ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  d += ` L ${pts[pts.length-1][0].toFixed(1)} ${pts[pts.length-1][1].toFixed(1)}`;
  return d;
}

function buildPercorsoLines(oggettiNomi, oggettiAll, stanze, corridors, roomPos, objPos) {
  const lines = [];
  for (let i = 0; i < oggettiNomi.length - 1; i++) {
    const a = oggettiAll.find(x=>x.nome===oggettiNomi[i]);
    const b = oggettiAll.find(x=>x.nome===oggettiNomi[i+1]);
    if (!a || !b) continue;
    const d = routedPath(a.stanza, b.stanza, objPos[a.nome], objPos[b.nome], stanze, corridors, roomPos);
    if (d) lines.push({ d, key:`${a.nome}→${b.nome}`, idx: i });
  }
  return lines;
}

// ─── PREVIEW LOADER HOOK ──────────────────────────────────────────────────
// refreshKey: incrementato dall'esterno dopo un upload di preview,
// forza il re-fetch e busta la cache del browser con ?v=timestamp
function useObjPreviews(nomeMuseo, oggetti, refreshKey = 0) {
  const [previews, setPreviews] = useState({});

  useEffect(() => {
    if (!nomeMuseo || !oggetti.length) { setPreviews({}); return; }
    let cancelled = false;
    const results = {};

    Promise.all(oggetti.map(async (o) => {
      const baseUrl = `/api/musei/${encodeURIComponent(nomeMuseo)}/oggetti/${encodeURIComponent(o.nome)}/immagini/preview`;
      try {
        const res = await fetch(baseUrl, {
          method: "HEAD",
          headers: { "X-API-Key": API_KEY },
        });
        if (!cancelled && res.ok)
          // se refreshKey > 0 busta la cache HTTP del browser
          results[o.nome] = refreshKey > 0 ? `${baseUrl}?v=${refreshKey}` : baseUrl;
      } catch { /* nessuna preview */ }
    })).then(() => {
      if (!cancelled) setPreviews({ ...results });
    });

    return () => { cancelled = true; };
  }, [nomeMuseo, oggetti, refreshKey]);

  return previews;
}

// ─── MODAL PROMPT ─────────────────────────────────────────────────────────
function ModalPrompt({ modal, setModal }) {
  const [value, setValue] = useState(modal.defaultValue ?? "");
  const confirm = () => { setModal(null); modal.onConfirm(value); };
  const cancel  = () => { setModal(null); modal.onConfirm(null); };
  return (
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"#00000066",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={cancel}>
      <div style={{background:"white",borderRadius:12,padding:"28px 32px",minWidth:340,boxShadow:"0 20px 60px #00000055"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,color:"#2c3e50",marginBottom:14,fontWeight:"bold"}}>{modal.message}</div>
        <input autoFocus value={value} onChange={e=>setValue(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")confirm();if(e.key==="Escape")cancel();}}
          style={{width:"100%",padding:"8px 10px",border:"1px solid #dce1e7",borderRadius:6,fontSize:13,boxSizing:"border-box",outline:"none",marginBottom:16}}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={cancel} style={{padding:"7px 18px",borderRadius:6,border:"1px solid #dce1e7",background:"transparent",color:"#95a5a6",fontSize:12,cursor:"pointer"}}>Annulla</button>
          <button onClick={confirm} style={{padding:"7px 18px",borderRadius:6,border:"none",background:"#2c3e50",color:"white",fontSize:12,cursor:"pointer",fontWeight:"bold"}}>OK</button>
        </div>
      </div>
    </div>
  );
}

function ModalConfirm({ modal, setModal }) {
  const confirm = () => { setModal(null); modal.onConfirm(true); };
  const cancel  = () => { setModal(null); modal.onConfirm(false); };
  return (
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"#00000066",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={cancel}>
      <div style={{background:"white",borderRadius:12,padding:"28px 32px",minWidth:360,boxShadow:"0 20px 60px #00000055"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:18,marginBottom:8}}>⚠️</div>
        <div style={{fontSize:15,color:"#2c3e50",marginBottom:8,fontWeight:"bold"}}>{modal.title}</div>
        <div style={{fontSize:13,color:"#7f8c8d",marginBottom:20,lineHeight:1.6}}>{modal.message}</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={cancel} style={{padding:"8px 20px",borderRadius:6,border:"1px solid #dce1e7",background:"transparent",color:"#95a5a6",fontSize:13,cursor:"pointer"}}>Annulla</button>
          <button onClick={confirm} style={{padding:"8px 20px",borderRadius:6,border:"none",background:"#e74c3c",color:"white",fontSize:13,cursor:"pointer",fontWeight:"bold"}}>Elimina definitivamente</button>
        </div>
      </div>
    </div>
  );
}

// ─── IMAGE MANAGER CARD ───────────────────────────────────────────────────
function ImmaginiCard({ nomeMuseo, nomeOggetto, showToast, onPreviewUpdated }) {
  const [immagini, setImmagini]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [uploading, setUploading]       = useState(null);
  const [deleting, setDeleting]         = useState(null);
  const [newTipo, setNewTipo]           = useState("");
  const [previewSrc, setPreviewSrc]     = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const fileInputRef = useRef();
  const replaceRefs  = useRef({});

  const reload = useCallback(async () => {
    if (!nomeMuseo || !nomeOggetto) return;
    setLoading(true);
    try {
      const data = await apiListImages(nomeMuseo, nomeOggetto);
      setImmagini(data.immagini ?? []);
    } catch { setImmagini([]); }
    finally { setLoading(false); }
  }, [nomeMuseo, nomeOggetto]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    setPreviewSrc(null);
    setNewTipo("");
    setSelectedFile(null);
  }, [nomeOggetto]);

  const handleUpload = async (file, tipo) => {
    if (!file) return;
    const tipoFinal = tipo?.trim() || "preview";
    if (tipoFinal !== "preview" && !/^\d+$/.test(tipoFinal)) {
      showToast("✗ Tipo non valido: usa 'preview' o un numero", false);
      return;
    }
    setUploading(tipoFinal);
    try {
      await apiUploadImage(nomeMuseo, nomeOggetto, tipoFinal, file);
      showToast(`✓ Immagine "${tipoFinal}" caricata`);
      await reload();
      // se è una preview, notifica il canvas per aggiornare in tempo reale
      if (tipoFinal === "preview") onPreviewUpdated?.();
      setNewTipo("");
      setPreviewSrc(null);
      setSelectedFile(null);
    } catch (err) {
      showToast(`✗ ${err.message}`, false);
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (tipo) => {
    setDeleting(tipo);
    try {
      await apiDeleteImage(nomeMuseo, nomeOggetto, tipo);
      showToast(`✓ Immagine "${tipo}" eliminata`);
      await reload();
      // se eliminiamo la preview, aggiorna anche il canvas
      if (tipo === "preview") onPreviewUpdated?.();
    } catch (err) {
      showToast(`✗ ${err.message}`, false);
    } finally {
      setDeleting(null);
    }
  };

  const onFileSelected = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setPreviewSrc(URL.createObjectURL(file));
  };

  const imgUrl     = (url)  => `/api${url}`;
  const tipoLabel  = (tipo) => tipo === "preview" ? "🖼 Preview" : `📷 Immagine ${tipo}`;
  const formatSize = (b)    => b > 1024*1024 ? `${(b/1024/1024).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;

  return (
    <Card title="IMMAGINI" color="#16a085">

      {loading && <div style={{fontSize:11,color:"#95a5a6",marginBottom:8}}>⏳ Caricamento...</div>}

      {!loading && immagini.length === 0 && (
        <div style={{fontSize:11,color:"#bdc3c7",fontStyle:"italic",marginBottom:10}}>
          Nessuna immagine caricata
        </div>
      )}

      {immagini.map(img => (
        <div key={img.tipo} style={{border:"1px solid #a2d9ce",borderRadius:6,marginBottom:8,overflow:"hidden",background:"#f0faf8"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px"}}>
            <span style={{fontSize:12,fontWeight:"bold",color:"#16a085",flex:1}}>{tipoLabel(img.tipo)}</span>
            <span style={{fontSize:10,color:"#95a5a6"}}>{formatSize(img.size)}</span>
            <button
              title="Sostituisci"
              onClick={() => replaceRefs.current[img.tipo]?.click()}
              disabled={uploading === img.tipo || deleting === img.tipo}
              style={{padding:"3px 8px",borderRadius:4,border:"1px solid #16a085",background:"white",color:"#16a085",fontSize:11,cursor:"pointer"}}>
              {uploading === img.tipo ? "⏳" : "↑"}
            </button>
            <input
              type="file" accept="image/*" style={{display:"none"}}
              ref={el => replaceRefs.current[img.tipo] = el}
              onChange={e => { const f = e.target.files?.[0]; e.target.value=""; if(f) handleUpload(f, img.tipo); }}
            />
            <button
              title="Elimina"
              onClick={() => handleDelete(img.tipo)}
              disabled={deleting === img.tipo || uploading === img.tipo}
              style={{padding:"3px 8px",borderRadius:4,border:"1px solid #e74c3c",background:"#fdecea",color:"#e74c3c",fontSize:11,cursor:"pointer"}}>
              {deleting === img.tipo ? "⏳" : "✕"}
            </button>
          </div>
          <img
            src={imgUrl(img.url)}
            alt={img.tipo}
            style={{width:"100%",maxHeight:100,objectFit:"cover",display:"block",borderTop:"1px solid #a2d9ce"}}
          />
        </div>
      ))}

      <div style={{marginTop:10,borderTop:"1px solid #a2d9ce",paddingTop:10}}>
        <div style={{fontSize:10,letterSpacing:1,color:"#16a085",marginBottom:6}}>AGGIUNGI NUOVA</div>

        <FLabel>Tipo</FLabel>
        <div style={{display:"flex",gap:6,marginBottom:8}}>
          <button onClick={() => setNewTipo("preview")}
            style={{flex:1,padding:"5px",borderRadius:4,fontSize:11,cursor:"pointer",
              border:`1px solid ${newTipo==="preview"?"#16a085":"#dce1e7"}`,
              background:newTipo==="preview"?"#16a085":"white",
              color:newTipo==="preview"?"white":"#7f8c8d",fontWeight:newTipo==="preview"?"bold":"normal"}}>
            preview
          </button>
          {["1","2","3","4"].map(n => (
            <button key={n} onClick={() => setNewTipo(n)}
              style={{flex:1,padding:"5px",borderRadius:4,fontSize:11,cursor:"pointer",
                border:`1px solid ${newTipo===n?"#16a085":"#dce1e7"}`,
                background:newTipo===n?"#16a085":"white",
                color:newTipo===n?"white":"#7f8c8d",fontWeight:newTipo===n?"bold":"normal"}}>
              {n}
            </button>
          ))}
          <input
            value={!["","preview","1","2","3","4"].includes(newTipo) ? newTipo : ""}
            onChange={e => setNewTipo(e.target.value)}
            placeholder="altro"
            style={{width:44,padding:"4px 6px",border:"1px solid #dce1e7",borderRadius:4,fontSize:11,outline:"none",textAlign:"center"}}
          />
        </div>

        <input
          type="file" accept="image/*" style={{display:"none"}}
          ref={fileInputRef}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if(f) onFileSelected(f); }}
        />

        {previewSrc && (
          <div style={{marginBottom:8,borderRadius:6,overflow:"hidden",border:"1px solid #a2d9ce"}}>
            <img src={previewSrc} alt="anteprima" style={{width:"100%",maxHeight:120,objectFit:"cover",display:"block"}}/>
            <div style={{fontSize:10,color:"#16a085",padding:"4px 8px",background:"#f0faf8"}}>
              Anteprima locale — non ancora caricata
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:6}}>
          <button onClick={() => fileInputRef.current?.click()}
            style={{flex:1,padding:"7px",borderRadius:5,border:"1px dashed #16a085",background:"white",color:"#16a085",fontSize:11,cursor:"pointer"}}>
            {previewSrc ? "📂 Cambia file" : "📂 Scegli file"}
          </button>
          <button
            disabled={!selectedFile || !newTipo.trim() || uploading !== null}
            onClick={() => { if (selectedFile) handleUpload(selectedFile, newTipo); }}
            style={{flex:1,padding:"7px",borderRadius:5,border:"none",fontSize:11,cursor:"pointer",fontWeight:"bold",
              background:(!selectedFile||!newTipo.trim()||uploading!==null)?"#a2d9ce":"#16a085",color:"white"}}>
            {uploading !== null ? "⏳ Upload..." : "↑ Carica"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── PERCORSO EDITOR PANEL ────────────────────────────────────────────────
function PercorsoEditor({ museo, percorso, oggettiEdit, onOggettiChange, onNomeChange, nomeEdit, onSave, onCancel, saving }) {
  const [hovered, setHovered] = useState(null);
  const oggettiDisponibili = museo.oggetti.map(o => o.nome).filter(n => !oggettiEdit.includes(n));
  const removeOggetto = (i) => onOggettiChange(oggettiEdit.filter((_,j) => j !== i));
  const moveUp   = (i) => { if(i===0)return; const a=[...oggettiEdit];[a[i-1],a[i]]=[a[i],a[i-1]];onOggettiChange(a); };
  const moveDown = (i) => { if(i===oggettiEdit.length-1)return; const a=[...oggettiEdit];[a[i],a[i+1]]=[a[i+1],a[i]];onOggettiChange(a); };

  return (
    <Card title={percorso ? "MODIFICA PERCORSO" : "NUOVO PERCORSO"} color="#e67e22">
      <div style={{fontSize:10,color:"#e67e22",background:"#fef9f0",border:"1px solid #fad7a0",borderRadius:4,padding:"5px 8px",marginBottom:10}}>
        💡 Clicca gli oggetti sul canvas per aggiungerli/rimuoverli
      </div>
      <FLabel>Nome percorso</FLabel>
      <input value={nomeEdit} onChange={e=>onNomeChange(e.target.value)} style={INP} placeholder="es. Tour Rinascimento"/>
      <FLabel>Oggetti nel percorso ({oggettiEdit.length})</FLabel>
      {oggettiEdit.length === 0
        ? <div style={{fontSize:11,color:"#bdc3c7",fontStyle:"italic",marginBottom:8}}>Nessun oggetto — clicca sul canvas o usa la lista</div>
        : <div style={{marginBottom:8}}>
            {oggettiEdit.map((n, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 6px",
                background:"#fef9f0",border:"1px solid #fad7a0",borderRadius:4,marginBottom:3}}>
                <span style={{fontSize:10,color:"#e67e22",minWidth:18,textAlign:"center",fontWeight:"bold"}}>{i+1}</span>
                <span style={{flex:1,fontSize:12,color:"#2c3e50"}}>{n}</span>
                <button onClick={()=>moveUp(i)} disabled={i===0} style={{background:"none",border:"none",cursor:i===0?"default":"pointer",color:i===0?"#dce1e7":"#7f8c8d",fontSize:12,padding:"0 2px"}}>▲</button>
                <button onClick={()=>moveDown(i)} disabled={i===oggettiEdit.length-1} style={{background:"none",border:"none",cursor:i===oggettiEdit.length-1?"default":"pointer",color:i===oggettiEdit.length-1?"#dce1e7":"#7f8c8d",fontSize:12,padding:"0 2px"}}>▼</button>
                <button onClick={()=>removeOggetto(i)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>×</button>
              </div>
            ))}
          </div>
      }
      {oggettiDisponibili.length > 0 && (
        <>
          <FLabel>Aggiungi oggetto {hovered ? <span style={{color:"#e67e22"}}>— preview: {hovered}</span> : ""}</FLabel>
          <div style={{border:"1px solid #dce1e7",borderRadius:5,overflow:"hidden",marginBottom:8,maxHeight:120,overflowY:"auto"}}>
            {oggettiDisponibili.map(n => (
              <div key={n}
                onMouseEnter={()=>setHovered(n)} onMouseLeave={()=>setHovered(null)}
                onClick={()=>{ onOggettiChange([...oggettiEdit, n]); setHovered(null); }}
                style={{padding:"5px 10px",fontSize:12,cursor:"pointer",
                  background:hovered===n?"#fad7a0":"white",borderBottom:"1px solid #f0f0f0",
                  color:"#2c3e50",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>{n}</span>
                <span style={{fontSize:10,color:"#bdc3c7"}}>{museo.oggetti.find(o=>o.nome===n)?.stanza}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{display:"flex",gap:8,marginTop:4}}>
        <button onClick={onCancel} style={{flex:1,padding:"7px",borderRadius:5,border:"1px solid #dce1e7",background:"transparent",color:"#95a5a6",fontSize:12,cursor:"pointer"}}>Annulla</button>
        <button onClick={onSave} disabled={saving||!nomeEdit.trim()||oggettiEdit.length===0}
          style={{flex:2,padding:"7px",borderRadius:5,border:"none",
            background:(saving||!nomeEdit.trim()||oggettiEdit.length===0)?"#f5cba7":"#e67e22",
            color:"white",fontSize:12,cursor:"pointer",fontWeight:"bold"}}>
          {saving ? "⏳ Salvataggio..." : percorso ? "↑ Aggiorna" : "✓ Crea percorso"}
        </button>
      </div>
    </Card>
  );
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
export default function MuseoEditor() {
  const [screen, setScreen]             = useState("welcome");
  const [museo, setMuseo]               = useState(MUSEO_VUOTO);
  const [selected, setSelected]         = useState(null);
  const [mode, setMode]                 = useState("select");
  const [showExport, setShowExport]     = useState(false);
  const [apiStatus, setApiStatus]       = useState(null);
  const [museList, setMuseList]         = useState([]);
  const [nuovoNome, setNuovoNome]       = useState("");
  const [nuovaCitta, setNuovaCitta]     = useState("");
  const [loadingMuseo, setLoadingMuseo] = useState(null);
  const [descTab, setDescTab]           = useState(0);
  const [savingAll, setSavingAll]       = useState(false);
  const [deletingMuseo, setDeletingMuseo] = useState(false);
  const [toast, setToast]               = useState(null);
  const [modal, setModal]               = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [nomeStanzaEdit, setNomeStanzaEdit] = useState("");
  const [nomeOggettoEdit, setNomeOggettoEdit] = useState("");

  // ← chiave per forzare il refresh delle preview sul canvas
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  const [percorsoEdit, setPercorsoEdit]         = useState(null);
  const [percorsoNomeEdit, setPercorsoNomeEdit] = useState("");
  const [percorsoOggettiEdit, setPercorsoOggettiEdit] = useState([]);
  const [percorsoSaving, setPercorsoSaving]     = useState(false);
  const [percorsoHoverObj, setPercorsoHoverObj] = useState(null);

  const showPrompt = (message, defaultValue = "") =>
    new Promise(resolve => setModal({ message, defaultValue, onConfirm: resolve }));

  const showConfirm = (title, message) =>
    new Promise(resolve => setConfirmModal({ title, message, onConfirm: resolve }));

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2800);
  };

  const openPercorsoEditor = (p) => {
    setPercorsoEdit(p ?? "nuovo");
    setPercorsoNomeEdit(p?.nome ?? "");
    setPercorsoOggettiEdit(p?.oggetti ? [...p.oggetti] : []);
    setSelected(null);
  };

  const closePercorsoEditor = () => {
    setPercorsoEdit(null);
    setPercorsoNomeEdit("");
    setPercorsoOggettiEdit([]);
    setPercorsoHoverObj(null);
  };

  const { roomPos, corridors, objPos, svgW, svgH } = useLayout(museo.stanze, museo.oggetti);

  // passa previewRefreshKey: quando cambia, il hook ri-fetcha e busta la cache
  const objPreviews = useObjPreviews(museo.nome, museo.oggetti, previewRefreshKey);

  const maxRow   = useMemo(() => Math.max(0,...museo.stanze.map(s=>s.row))+2, [museo.stanze]);
  const maxCol   = useMemo(() => Math.max(0,...museo.stanze.map(s=>s.col))+2, [museo.stanze]);
  const occupied = useMemo(() => new Set(museo.stanze.map(s=>`${s.row},${s.col}`)), [museo.stanze]);

  const percorsoEditLines = useMemo(() => {
    if (!percorsoEdit) return [];
    const lista = percorsoHoverObj && !percorsoOggettiEdit.includes(percorsoHoverObj)
      ? [...percorsoOggettiEdit, percorsoHoverObj]
      : percorsoOggettiEdit;
    return buildPercorsoLines(lista, museo.oggetti, museo.stanze, corridors, roomPos, objPos);
  }, [percorsoEdit, percorsoOggettiEdit, percorsoHoverObj, museo.oggetti, museo.stanze, corridors, roomPos, objPos]);

  const percorsoSelezionato = useMemo(() => {
    if (selected?.type !== "percorso") return null;
    return museo.percorsi.find(p => p.nome === selected.nome) ?? null;
  }, [selected, museo.percorsi]);

  const percorsoViewLines = useMemo(() => {
    if (!percorsoSelezionato) return [];
    return buildPercorsoLines(percorsoSelezionato.oggetti, museo.oggetti, museo.stanze, corridors, roomPos, objPos);
  }, [percorsoSelezionato, museo.oggetti, museo.stanze, corridors, roomPos, objPos]);

  // ─── API ──────────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/musei")
      .then(data => { setMuseList(data?.musei??[]); setApiStatus("ok"); })
      .catch(() => setApiStatus("err"));
  }, []);

  useEffect(() => {
    if (selected?.type === "stanza") {
      const s = museo.stanze.find(s => s.nome === selected.nome);
      if (s) setNomeStanzaEdit(s.nome);
    }
  }, [selected?.nome, selected?.type]);

  useEffect(() => {
    if (selected?.type === "oggetto") {
      const o = museo.oggetti.find(o => o.nome === selected.nome);
      if (o) setNomeOggettoEdit(o.nome);
    }
  }, [selected?.nome, selected?.type]);

  const loadMuseoFromApi = async (nome) => {
    setLoadingMuseo(nome);
    try {
      const [data, layout, percorsiData] = await Promise.all([
        apiFetch(`/musei/${encodeURIComponent(nome)}`),
        apiFetch(`/musei/${encodeURIComponent(nome)}/layout`).catch(()=>null),
        apiFetch(`/musei/${encodeURIComponent(nome)}/percorsi`).catch(()=>null),
      ]);
      if (!data) return;
      const stanze = layout?.grid
        ? Object.entries(layout.grid).map(([n,v])=>({ nome:n, row:v.row, col:v.col, tipo:v.tipo??"normale" }))
        : [];
      setMuseo({
        nome: data.nome, stanze,
        oggetti: (data.oggetti??[]).map(o=>({...o,visibile:true})),
        percorsi: percorsiData?.percorsi ?? data.percorsi ?? [],
      });
      setSelected(null); setScreen("editor");
    } catch(e) { alert(`Errore caricamento: ${e.message}`); }
    finally { setLoadingMuseo(null); }
  };

  const creaMuseoNuovo = async () => {
    const nome = nuovoNome.trim(), citta = nuovaCitta.trim();
    if (!nome) return;
    try {
      await apiFetch("/musei", { method:"POST", body:JSON.stringify({ nome, citta }) });
      setMuseo({ nome, stanze:[], oggetti:[], percorsi:[] });
      setSelected(null); setScreen("editor");
    } catch(e) {
      if (e.message.includes("400")) { setMuseo({ nome, stanze:[], oggetti:[], percorsi:[] }); setScreen("editor"); }
      else alert(`Errore creazione: ${e.message}`);
    }
  };

  const saveMuseoToApi = async () => {
    setSavingAll(true);
    try {
      await apiFetch(`/musei/${encodeURIComponent(museo.nome)}`,
        { method:"PUT", body:JSON.stringify({ nome:museo.nome }) });
      const grid = Object.fromEntries(museo.stanze.map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}]));
      await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/layout`,
        { method:"PUT", body:JSON.stringify({ grid }) });
      await Promise.all(museo.oggetti.map(o =>
        apiFetch(`/musei/${encodeURIComponent(museo.nome)}/oggetti/${encodeURIComponent(o.nome)}`,
          { method:"PUT", body:JSON.stringify({
              stanza: o.stanza, connessi: o.connessi, visibile: o.visibile,
              descrizioni: o.descrizioni ?? Array.from({length:4},()=>Array(3).fill(""))
            })
          }
        )
      ));
      showToast("✓ Tutto salvato!");
    } catch(e) { showToast(`✗ ${e.message}`, false); }
    finally { setSavingAll(false); }
  };

  const updMuseoNome = async (nuovoNomeMuseo) => {
    const vecchio = museo.nome;
    if (!vecchio || vecchio === nuovoNomeMuseo) return;
    setMuseo(m => ({...m, nome: nuovoNomeMuseo}));
    try {
      await apiFetch(`/musei/${encodeURIComponent(vecchio)}`, { method:"PUT", body:JSON.stringify({ nome:nuovoNomeMuseo }) });
      const grid = Object.fromEntries(museo.stanze.map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}]));
      await apiFetch(`/musei/${encodeURIComponent(nuovoNomeMuseo)}/layout`, { method:"PUT", body:JSON.stringify({ grid }) });
      setMuseList(l => l.map(n => n===vecchio ? nuovoNomeMuseo : n));
      showToast(`✓ Museo rinominato in "${nuovoNomeMuseo}"`);
    } catch(err) { showToast(`⚠ Rename solo locale (${err.message})`, false); }
  };

  const eliminaMuseo = async () => {
    const nomeM = museo.nome;
    const confermato = await showConfirm(
      `Eliminare "${nomeM}"?`,
      `Questa azione è irreversibile. Verranno eliminati:\n• Tutte le stanze (${museo.stanze.length})\n• Tutti gli oggetti (${museo.oggetti.length})\n• Tutti i percorsi (${museo.percorsi.length})\n• Il museo stesso dall'API`
    );
    if (!confermato) return;
    setDeletingMuseo(true);
    try {
      await Promise.all(museo.percorsi.map(p =>
        apiFetch(`/musei/${encodeURIComponent(nomeM)}/percorsi/${encodeURIComponent(p.nome)}`, { method:"DELETE" }).catch(()=>{})
      ));
      await Promise.all(museo.oggetti.map(o =>
        apiFetch(`/musei/${encodeURIComponent(nomeM)}/oggetti/${encodeURIComponent(o.nome)}`, { method:"DELETE" }).catch(()=>{})
      ));
      await apiFetch(`/musei/${encodeURIComponent(nomeM)}/layout`,
        { method:"PUT", body:JSON.stringify({ grid: {} }) }
      ).catch(()=>{});
      await apiFetch(`/musei/${encodeURIComponent(nomeM)}`, { method:"DELETE" });
      setMuseList(l => l.filter(n => n !== nomeM));
      setMuseo(MUSEO_VUOTO);
      setSelected(null);
      closePercorsoEditor();
      setScreen("welcome");
      showToast(`✓ Museo "${nomeM}" eliminato`);
    } catch(err) {
      showToast(`✗ Errore eliminazione: ${err.message}`, false);
    } finally {
      setDeletingMuseo(false);
    }
  };

  // ─── PERCORSI API ─────────────────────────────────────────────────────
  const salvaPercorso = async () => {
    const nome = percorsoNomeEdit.trim();
    if (!nome || percorsoOggettiEdit.length === 0) return;
    setPercorsoSaving(true);
    try {
      const esiste = museo.percorsi.find(p => p.nome === nome);
      if (esiste) {
        await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/percorsi/${encodeURIComponent(nome)}`, { method:"DELETE" });
      }
      await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/percorsi`,
        { method:"POST", body:JSON.stringify({ nome, oggetti: percorsoOggettiEdit }) });
      setMuseo(m => ({
        ...m,
        percorsi: [...m.percorsi.filter(p=>p.nome!==nome), { nome, oggetti: percorsoOggettiEdit }]
      }));
      closePercorsoEditor();
      setSelected({ type:"percorso", nome });
      showToast(`✓ Percorso "${nome}" salvato`);
    } catch(err) { showToast(`✗ ${err.message}`, false); }
    finally { setPercorsoSaving(false); }
  };

  const eliminaPercorso = async (nomeP) => {
    try {
      await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/percorsi/${encodeURIComponent(nomeP)}`, { method:"DELETE" });
      setMuseo(m => ({...m, percorsi: m.percorsi.filter(p=>p.nome!==nomeP)}));
      if (selected?.nome === nomeP) setSelected(null);
      showToast(`✓ Percorso "${nomeP}" eliminato`);
    } catch(err) { showToast(`✗ ${err.message}`, false); }
  };

  // ─── MUTATORS ─────────────────────────────────────────────────────────
  const updDescrizione = (nomeOggetto, livello, lunghezza, testo) => {
    setMuseo(m => ({...m, oggetti: m.oggetti.map(o => {
      if (o.nome !== nomeOggetto) return o;
      const desc = Array.from({length:4},(_,i)=>Array.from({length:3},(_,j)=>o.descrizioni?.[i]?.[j]??""));
      desc[livello][lunghezza] = testo;
      return { ...o, descrizioni: desc };
    })}));
  };

  const updStanza = useCallback(async (vecchio, patch) => {
    setMuseo(m => ({...m,
      stanze:  m.stanze.map(s=>s.nome===vecchio?{...s,...patch}:s),
      oggetti: patch.nome ? m.oggetti.map(o=>o.stanza===vecchio?{...o,stanza:patch.nome}:o) : m.oggetti,
    }));
    if (patch.nome) setSelected(s=>s?.nome===vecchio?{...s,nome:patch.nome}:s);
    if (patch.nome) {
      try {
        const nuove = museo.stanze.map(s=>s.nome===vecchio?{...s,...patch}:s);
        const grid = Object.fromEntries(nuove.map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}]));
        await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/layout`,{method:"PUT",body:JSON.stringify({grid})});
        await Promise.all(museo.oggetti.filter(o=>o.stanza===vecchio).map(o=>
          apiFetch(`/musei/${encodeURIComponent(museo.nome)}/oggetti/${encodeURIComponent(o.nome)}`,
            {method:"PUT",body:JSON.stringify({...o,stanza:patch.nome})})
        ));
        showToast(`✓ Stanza rinominata in "${patch.nome}"`);
      } catch(err) { showToast(`⚠ Rename solo locale (${err.message})`, false); }
    }
  }, [museo]);

  const updOggetto = useCallback((vecchio, patch) => {
    setMuseo(m=>({...m,oggetti:m.oggetti.map(o=>{
      if(o.nome===vecchio)return{...o,...patch};
      if(patch.nome&&o.connessi.includes(vecchio))return{...o,connessi:o.connessi.map(c=>c===vecchio?patch.nome:c)};
      return o;
    })}));
    if(patch.nome)setSelected(s=>s?.nome===vecchio?{...s,nome:patch.nome}:s);
  },[]);

  async function syncPercorsiToApi(percorsiVecchi, percorsiNuovi, nomeMuseo) {
    const nuoviMap = Object.fromEntries(percorsiNuovi.map(p => [p.nome, p]));
    const vecchiMap = Object.fromEntries(percorsiVecchi.map(p => [p.nome, p]));
    const daEliminare = percorsiVecchi.filter(p => !nuoviMap[p.nome]);
    const daAggiornare = percorsiNuovi.filter(p => {
      const v = vecchiMap[p.nome];
      return v && JSON.stringify(v.oggetti) !== JSON.stringify(p.oggetti);
    });
    await Promise.all([
      ...daEliminare.map(p =>
        apiFetch(`/musei/${encodeURIComponent(nomeMuseo)}/percorsi/${encodeURIComponent(p.nome)}`, { method:"DELETE" })
      ),
      ...daAggiornare.map(async p => {
        await apiFetch(`/musei/${encodeURIComponent(nomeMuseo)}/percorsi/${encodeURIComponent(p.nome)}`, { method:"DELETE" }).catch(()=>{});
        await apiFetch(`/musei/${encodeURIComponent(nomeMuseo)}/percorsi`, { method:"POST", body:JSON.stringify({ nome:p.nome, oggetti:p.oggetti }) });
      }),
    ]);
  }

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    if (selected.type === "stanza") {
      const oggettiDaEliminare = museo.oggetti.filter(o => o.stanza === selected.nome).map(o => o.nome);
      const percorsiAggiornati = museo.percorsi.map(p => ({
        ...p, oggetti: p.oggetti.filter(n => !oggettiDaEliminare.includes(n))
      })).filter(p => p.oggetti.length > 0);
      setMuseo(m => ({...m,
        stanze:   m.stanze.filter(s => s.nome !== selected.nome),
        oggetti:  m.oggetti.filter(o => o.stanza !== selected.nome),
        percorsi: percorsiAggiornati,
      }));
      setSelected(null);
      try {
        await Promise.all(oggettiDaEliminare.map(n =>
          apiFetch(`/musei/${encodeURIComponent(museo.nome)}/oggetti/${encodeURIComponent(n)}`, { method:"DELETE" })
        ));
        const grid = Object.fromEntries(museo.stanze.filter(s=>s.nome!==selected.nome).map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}]));
        await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/layout`, { method:"PUT", body:JSON.stringify({grid}) });
        await syncPercorsiToApi(museo.percorsi, percorsiAggiornati, museo.nome);
        showToast(`✓ Stanza eliminata`);
      } catch(err) { showToast(`⚠ Eliminazione parziale (${err.message})`, false); }
    } else if (selected.type === "oggetto") {
      const nomeObj = selected.nome;
      const percorsiAggiornati = museo.percorsi.map(p => ({
        ...p, oggetti: p.oggetti.filter(n => n !== nomeObj)
      })).filter(p => p.oggetti.length > 0);
      setMuseo(m => ({...m,
        oggetti:  m.oggetti.filter(o=>o.nome!==nomeObj).map(o=>({...o,connessi:o.connessi.filter(c=>c!==nomeObj)})),
        percorsi: percorsiAggiornati,
      }));
      setSelected(null);
      try {
        await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/oggetti/${encodeURIComponent(nomeObj)}`, { method:"DELETE" });
        await syncPercorsiToApi(museo.percorsi, percorsiAggiornati, museo.nome);
        showToast(`✓ Oggetto eliminato`);
      } catch(err) { showToast(`⚠ Eliminazione parziale (${err.message})`, false); }
    } else if (selected.type === "percorso") {
      await eliminaPercorso(selected.nome);
    }
  }, [selected, museo]);

  const connectTo = useCallback((a,b)=>setMuseo(m=>({...m,oggetti:m.oggetti.map(o=>{
    if(o.nome===a&&!o.connessi.includes(b))return{...o,connessi:[...o.connessi,b]};
    if(o.nome===b&&!o.connessi.includes(a))return{...o,connessi:[...o.connessi,a]};
    return o;
  })})),[]);

  const disconnect = useCallback((a,b)=>setMuseo(m=>({...m,oggetti:m.oggetti.map(o=>{
    if(o.nome===a)return{...o,connessi:o.connessi.filter(c=>c!==b)};
    if(o.nome===b)return{...o,connessi:o.connessi.filter(c=>c!==a)};
    return o;
  })})),[]);

  // ─── CLICK HANDLERS ───────────────────────────────────────────────────
  const onRoomClick = async (e, nome) => {
    e.stopPropagation();
    if (mode==="addObject") {
      const n = await showPrompt("Nome oggetto:", `Oggetto ${museo.oggetti.length+1}`);
      if (!n) return;
      const nuovoOggetto = { nome:n, stanza:nome, connessi:[], visibile:true, descrizioni:Array.from({length:4},()=>Array(3).fill("")) };
      setMuseo(m=>({...m,oggetti:[...m.oggetti,nuovoOggetto]}));
      setSelected({type:"oggetto",nome:n}); setMode("select");
      try {
        await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/oggetti`,
          {method:"POST",body:JSON.stringify({nome:n,stanza:nome,connessi:[],visibile:true,descrizioni:nuovoOggetto.descrizioni})});
      } catch(err){showToast(`⚠ Oggetto solo locale (${err.message})`,false);}
    } else if (!percorsoEdit) {
      setSelected({type:"stanza",nome});
    }
  };

  const onObjClick = (e, nome) => {
    e.stopPropagation();
    if (percorsoEdit) {
      const idx = percorsoOggettiEdit.indexOf(nome);
      if (idx >= 0) setPercorsoOggettiEdit(percorsoOggettiEdit.filter((_,i)=>i!==idx));
      else setPercorsoOggettiEdit([...percorsoOggettiEdit, nome]);
      return;
    }
    if (mode==="connectPick") {
      if(nome!==selected?.nome)connectTo(selected.nome,nome);
      setMode("select");
    } else {
      setSelected({type:"oggetto",nome});
    }
  };

  const onGhostClick = async (row, col) => {
    const n = await showPrompt("Nome stanza:", `Stanza ${museo.stanze.length+1}`);
    if (!n) return;
    const nuova = { nome:n, row, col, tipo:"normale" };
    let prev = [];
    setMuseo(m=>{ prev=m.stanze; return {...m,stanze:[...m.stanze,nuova]}; });
    setSelected({type:"stanza",nome:n}); setMode("select");
    try {
      const grid = Object.fromEntries([...prev,nuova].map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}]));
      await apiFetch(`/musei/${encodeURIComponent(museo.nome)}/layout`,{method:"PUT",body:JSON.stringify({grid})});
      showToast(`✓ Stanza "${n}" creata`);
    } catch(err){showToast(`⚠ Stanza solo locale (${err.message})`,false);}
  };

  // ─── CONNESSIONI ──────────────────────────────────────────────────────
  const connections = useMemo(() => {
    if (selected?.type !== "oggetto") return [];
    const o = museo.oggetti.find(x=>x.nome===selected.nome);
    if (!o) return [];
    return o.connessi.flatMap(cn => {
      const cnObj = museo.oggetti.find(x=>x.nome===cn);
      if (!cnObj) return [];
      const d = routedPath(o.stanza,cnObj.stanza,objPos[o.nome],objPos[cn],museo.stanze,corridors,roomPos);
      return d ? [{d,key:`${o.nome}|${cn}`}] : [];
    });
  }, [selected,museo.oggetti,museo.stanze,objPos,corridors,roomPos]);

  // ─── EXPORT ───────────────────────────────────────────────────────────
  const exportData = useMemo(() => ({
    layout: { grid: Object.fromEntries(museo.stanze.map(s=>[s.nome,{row:s.row,col:s.col,tipo:s.tipo}])) },
    museo:  { nome: museo.nome, oggetti: museo.oggetti, percorsi: museo.percorsi },
  }), [museo]);

  const downloadJSON = (key) => {
    const blob = new Blob([JSON.stringify(exportData[key],null,2)],{type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`${museo.nome}_${key}.json`; a.click();
  };

  const selItem = selected
    ? selected.type==="stanza"   ? museo.stanze.find(s=>s.nome===selected.nome)
    : selected.type==="oggetto"  ? museo.oggetti.find(o=>o.nome===selected.nome)
    : selected.type==="percorso" ? museo.percorsi.find(p=>p.nome===selected.nome)
    : null : null;

  const activePercorsoLines = percorsoEdit ? percorsoEditLines : percorsoViewLines;
  const percorsoAttivoOggetti = percorsoEdit
    ? (percorsoHoverObj && !percorsoOggettiEdit.includes(percorsoHoverObj)
        ? [...percorsoOggettiEdit, percorsoHoverObj]
        : percorsoOggettiEdit)
    : (percorsoSelezionato?.oggetti ?? []);

  const hint = percorsoEdit
    ? "Clicca un oggetto per aggiungerlo/rimuoverlo dal percorso"
    : mode==="addRoom"     ? "Clicca una cella vuota per aggiungere la stanza"
    : mode==="addObject"   ? "Clicca una stanza per aggiungere l'oggetto"
    : mode==="connectPick" ? `Clicca un oggetto da collegare a "${selected?.nome}"`
    : null;

  // ─── RENDER: WELCOME / NUOVO ──────────────────────────────────────────
  if (screen === "welcome" || screen === "nuovo") {
    return (
      <div style={{display:"flex",height:"100vh",background:"#1a252f",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif"}}>
        <div style={{width:520,background:"#2c3e50",borderRadius:16,overflow:"hidden",boxShadow:"0 20px 60px #00000066"}}>
          <div style={{padding:"32px 40px 24px",borderBottom:"1px solid #3d5166"}}>
            <div style={{fontSize:11,letterSpacing:3,color:"#7f8c8d",marginBottom:8}}>MUSEO EDITOR</div>
            <div style={{fontSize:26,fontWeight:"bold",color:"#ecf0f1"}}>{screen==="nuovo"?"Nuovo Museo":"Benvenuto"}</div>
            {screen==="welcome"&&<div style={{fontSize:13,color:"#95a5a6",marginTop:6}}>
              {apiStatus==="ok"?`${museList.length} museo${museList.length!==1?"i":""} trovato${museList.length!==1?"i":""} sul server`:apiStatus==="err"?"Server non raggiungibile":"Connessione in corso..."}
            </div>}
          </div>
          <div style={{padding:"28px 40px 36px"}}>
            {screen==="welcome"&&<>
              <button onClick={()=>setScreen("nuovo")} style={{width:"100%",padding:"14px",borderRadius:8,border:"2px solid #27ae60",background:"#1a3a2a",color:"#2ecc71",fontSize:14,fontWeight:"bold",cursor:"pointer",marginBottom:16,textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:24}}>⊞</span>
                <div><div>Crea nuovo museo</div><div style={{fontSize:11,color:"#27ae60",fontWeight:"normal",marginTop:2}}>Inizia da zero</div></div>
              </button>
              {museList.length>0&&<>
                <div style={{fontSize:10,letterSpacing:2,color:"#7f8c8d",marginBottom:10,marginTop:8}}>OPPURE CARICA ESISTENTE</div>
                <div style={{maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
                  {museList.map(n=>(
                    <button key={n} onClick={()=>loadMuseoFromApi(n)} disabled={loadingMuseo!==null}
                      style={{width:"100%",padding:"12px 16px",borderRadius:8,border:"1px solid #3d5166",background:loadingMuseo===n?"#2980b9":"#34495e",color:"#ecf0f1",fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",opacity:loadingMuseo&&loadingMuseo!==n?0.5:1}}>
                      <span>{n}</span><span style={{fontSize:11,color:"#7f8c8d"}}>{loadingMuseo===n?"⏳ caricamento...":"→ apri"}</span>
                    </button>
                  ))}
                </div>
              </>}
              {apiStatus==="err"&&<div style={{marginTop:16,padding:"12px 16px",borderRadius:8,background:"#2d1515",border:"1px solid #e74c3c",color:"#e74c3c",fontSize:12}}>
                ⚠️ Impossibile raggiungere il server API.
                <button onClick={()=>{setMuseo(MUSEO_VUOTO);setScreen("nuovo");}} style={{display:"block",marginTop:10,padding:"8px 16px",borderRadius:6,border:"1px solid #e74c3c",background:"transparent",color:"#e74c3c",fontSize:12,cursor:"pointer"}}>Continua offline →</button>
              </div>}
            </>}
            {screen==="nuovo"&&<>
              <div style={{fontSize:10,letterSpacing:1,color:"#95a5a6",marginBottom:4}}>NOME MUSEO</div>
              <input autoFocus value={nuovoNome} onChange={e=>setNuovoNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&creaMuseoNuovo()} placeholder="es. Museo Egizio"
                style={{width:"100%",padding:"10px 12px",borderRadius:6,border:"1px solid #3d5166",background:"#34495e",color:"#ecf0f1",fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:16}}/>
              <div style={{fontSize:10,letterSpacing:1,color:"#95a5a6",marginBottom:4}}>CITTÀ</div>
              <input value={nuovaCitta} onChange={e=>setNuovaCitta(e.target.value)} onKeyDown={e=>e.key==="Enter"&&creaMuseoNuovo()} placeholder="es. Torino"
                style={{width:"100%",padding:"10px 12px",borderRadius:6,border:"1px solid #3d5166",background:"#34495e",color:"#ecf0f1",fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:24}}/>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setScreen("welcome")} style={{flex:1,padding:"11px",borderRadius:7,border:"1px solid #3d5166",background:"transparent",color:"#95a5a6",fontSize:13,cursor:"pointer"}}>← Indietro</button>
                <button onClick={creaMuseoNuovo} disabled={!nuovoNome.trim()} style={{flex:2,padding:"11px",borderRadius:7,border:"none",background:nuovoNome.trim()?"#27ae60":"#1e5a34",color:nuovoNome.trim()?"white":"#7f8c8d",fontSize:13,fontWeight:"bold",cursor:nuovoNome.trim()?"pointer":"default"}}>Crea museo</button>
              </div>
            </>}
          </div>
        </div>
      </div>
    );
  }

  // ─── RENDER: EDITOR ───────────────────────────────────────────────────
  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"Arial,sans-serif",overflow:"hidden",position:"relative"}}>

      {modal && <ModalPrompt modal={modal} setModal={setModal} />}
      {confirmModal && <ModalConfirm modal={confirmModal} setModal={setConfirmModal} />}

      {toast && (
        <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,padding:"10px 18px",borderRadius:8,fontSize:13,fontWeight:"bold",
          background:toast.ok?"#27ae60":"#e74c3c",color:"white",boxShadow:"0 4px 16px #00000044"}}>
          {toast.msg}
        </div>
      )}

      {/* ── TOOLBAR ── */}
      <div style={{width:52,background:"#2c3e50",display:"flex",flexDirection:"column",alignItems:"center",padding:"12px 0",gap:6}}>
        {[{m:"select",icon:"↖",tip:"Seleziona"},{m:"addRoom",icon:"⊞",tip:"Aggiungi Stanza"},{m:"addObject",icon:"⊕",tip:"Aggiungi Oggetto"}].map(({m,icon,tip})=>(
          <button key={m} title={tip} onClick={()=>{setMode(m);closePercorsoEditor();}}
            style={{width:38,height:38,borderRadius:6,border:`2px solid ${mode===m&&!percorsoEdit?"#4ade80":"#3d5166"}`,background:mode===m&&!percorsoEdit?"#1a3a2a":"transparent",color:mode===m&&!percorsoEdit?"#4ade80":"#7f8c8d",fontSize:18,cursor:"pointer"}}>
            {icon}
          </button>
        ))}
        <div style={{flex:1}}/>
        <div title={apiStatus==="ok"?"API connessa":apiStatus==="err"?"API non raggiungibile":"..."}
          style={{width:10,height:10,borderRadius:"50%",marginBottom:6,background:apiStatus==="ok"?"#2ecc71":apiStatus==="err"?"#e74c3c":"#f39c12"}}/>
        <button title="Esporta" onClick={()=>setShowExport(v=>!v)}
          style={{width:38,height:38,borderRadius:6,border:`2px solid ${showExport?"#3498db":"#3d5166"}`,background:"transparent",color:showExport?"#3498db":"#7f8c8d",fontSize:18,cursor:"pointer"}}>⤓</button>
      </div>

      {/* ── CANVAS ── */}
      <div style={{flex:1,overflow:"auto",background:"#ecf0f1",position:"relative"}}>
        {hint&&(
          <div style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",zIndex:10,
            background: percorsoEdit?"#e67e22dd":"#2c3e50dd",
            color:"white",padding:"6px 18px",borderRadius:20,fontSize:12,pointerEvents:"none",whiteSpace:"nowrap"}}>
            {hint}
          </div>
        )}
        <svg width={svgW} height={svgH} style={{display:"block",background:"#f8f9fa",cursor:percorsoEdit?"crosshair":"default"}}
          onClick={()=>{ if(!percorsoEdit){setSelected(null);setMode("select");} }}>
          <defs>
            <style>{`
              @keyframes flow-red    { to { stroke-dashoffset: -22; } }
              @keyframes flow-orange { to { stroke-dashoffset: -22; } }
              @keyframes ripple-out  { 0%{opacity:.7;}100%{r:28px;opacity:0;} }
              .conn-path     { animation: flow-red    1.2s linear infinite; }
              .percorso-path { animation: flow-orange 1.0s linear infinite; }
              .rp1 { animation: ripple-out 1.8s ease-out 0s   infinite; }
              .rp2 { animation: ripple-out 1.8s ease-out .6s  infinite; }
              .rp3 { animation: ripple-out 1.8s ease-out 1.2s infinite; }
            `}</style>
            <marker id="arrow-orange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#e67e22"/>
            </marker>
            <marker id="arrow-orange-dim" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#f0a060"/>
            </marker>
            {museo.oggetti.filter(o=>objPreviews[o.nome]&&objPos[o.nome]).map(o=>{
              const [x,y] = objPos[o.nome];
              return (
                <clipPath key={`clip-${o.nome}`} id={`clip-prev-${o.nome.replace(/\s+/g,"_")}`}>
                  <circle cx={x} cy={y} r={15}/>
                </clipPath>
              );
            })}
          </defs>

          {mode==="addRoom"&&!percorsoEdit&&Array.from({length:maxRow},(_,row)=>Array.from({length:maxCol},(_,col)=>{
            if(occupied.has(`${row},${col}`))return null;
            return <rect key={`g${row}-${col}`} x={START_X+col*(ROOM_W+GAP_X)} y={START_Y+row*(ROOM_H+GAP_Y)} width={ROOM_W} height={ROOM_H} rx={8}
              fill="#fff" stroke="#27ae60" strokeWidth={2} strokeDasharray="8 5" opacity={.6} style={{cursor:"pointer"}}
              onClick={e=>{e.stopPropagation();onGhostClick(row,col);}}/>;
          }))}

          {corridors.map((c,i)=><rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill="#ecf0f1" stroke="#95a5a6" strokeWidth={1.5}/>)}

          {museo.stanze.map(s=>{
            const p=roomPos[s.nome]; if(!p) return null;
            const tc=TIPO_COLORS[s.tipo]||TIPO_COLORS.normale;
            const sel=!percorsoEdit&&selected?.type==="stanza"&&selected?.nome===s.nome;
            const inPercorso=percorsoAttivoOggetti.some(on=>museo.oggetti.find(o=>o.nome===on)?.stanza===s.nome);
            return (
              <g key={s.nome} style={{cursor:"pointer"}} onClick={e=>onRoomClick(e,s.nome)}>
                <rect x={p.x} y={p.y} width={ROOM_W} height={ROOM_H} rx={8}
                  fill={tc.fill} stroke={sel?"#f39c12":inPercorso?"#e67e22":tc.stroke} strokeWidth={sel?4:inPercorso?3:3}
                  style={{filter:sel?"drop-shadow(0 0 8px #f39c1288)":inPercorso?"drop-shadow(0 0 6px #e67e2266)":undefined}}/>
                <text x={p.x+ROOM_W/2} y={p.y+20} textAnchor="middle" style={{font:"bold 14px Arial",fill:"#2c3e50",pointerEvents:"none"}}>{s.nome}</text>
              </g>
            );
          })}

          {!percorsoEdit&&connections.map(({d,key})=>(
            <path key={key} d={d} stroke="#e74c3c" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray="10 8" className="conn-path"/>
          ))}

          {activePercorsoLines.map(({d,key,idx})=>{
            const isPreview = percorsoEdit && percorsoHoverObj &&
              !percorsoOggettiEdit.includes(percorsoHoverObj) &&
              idx === percorsoOggettiEdit.length - 1 + (percorsoOggettiEdit.length > 0 ? 1 : 0);
            return (
              <path key={key} d={d}
                stroke={isPreview?"#f0a060":"#e67e22"} strokeWidth={isPreview?2:3} fill="none"
                strokeLinecap="round" strokeDasharray={isPreview?"6 6":"12 6"}
                strokeOpacity={isPreview?0.6:1}
                className="percorso-path"
                markerEnd={`url(#${isPreview?"arrow-orange-dim":"arrow-orange"})`}/>
            );
          })}

          {museo.oggetti.filter(o=>o.visibile).map(o=>{
            const pos=objPos[o.nome]; if(!pos) return null;
            const [x,y]=pos;
            const sel=!percorsoEdit&&selected?.type==="oggetto"&&selected?.nome===o.nome;
            const isPick=!percorsoEdit&&mode==="connectPick"&&!sel;
            const percIdx = percorsoAttivoOggetti.indexOf(o.nome);
            const inPercorso = percIdx >= 0;
            const isHoverPreview = percorsoEdit && percorsoHoverObj===o.nome && !percorsoOggettiEdit.includes(o.nome);
            const isInEdit = percorsoEdit && percorsoOggettiEdit.includes(o.nome);
            const r = inPercorso||isHoverPreview ? 13 : 10;
            const fill = isHoverPreview ? "#f0a060" : isInEdit ? "#e67e22" : sel ? OBJ_SEL_FILL : OBJ_FILL;
            const stroke = isPick ? OBJ_PICK_STROKE : isInEdit||isHoverPreview ? "#d35400" : OBJ_STROKE;
            const hasPreview = objPreviews[o.nome] && !percorsoEdit && !isPick && !isInEdit && !inPercorso;
            return (
              <g key={o.nome} style={{cursor:"pointer"}} onClick={e=>onObjClick(e,o.nome)}>
                {sel&&<>
                  <circle cx={x} cy={y} r={11} fill="none" stroke="#3498db" strokeWidth={2} className="rp1"/>
                  <circle cx={x} cy={y} r={11} fill="none" stroke="#3498db" strokeWidth={2} className="rp2"/>
                  <circle cx={x} cy={y} r={11} fill="none" stroke="#3498db" strokeWidth={2} className="rp3"/>
                </>}
                {isInEdit&&<circle cx={x} cy={y} r={r+4} fill="none" stroke="#e67e22" strokeWidth={1} strokeOpacity={0.4}/>}

                {hasPreview
                  ? <>
                      {/* ── fill="transparent" (non "none"): cattura i click sull'intera area ── */}
                      <circle cx={x} cy={y} r={15}
                        fill="transparent"
                        stroke={sel?"#f39c12":OBJ_STROKE}
                        strokeWidth={sel?3:2}
                        style={{filter:sel?"drop-shadow(0 0 8px #f39c1288)":undefined}}/>
                      <image
                        href={objPreviews[o.nome]}
                        x={x-15} y={y-15} width={30} height={30}
                        clipPath={`url(#clip-prev-${o.nome.replace(/\s+/g,"_")})`}
                        preserveAspectRatio="xMidYMid slice"
                        style={{pointerEvents:"none"}}
                      />
                    </>
                  : <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sel||isPick||isInEdit?3:2}
                      style={{filter:isPick?"drop-shadow(0 0 4px #27ae6099)":isHoverPreview?"drop-shadow(0 0 6px #e67e2288)":undefined}}/>
                }

                {(inPercorso||isInEdit)
                  ? <>
                      <text x={x} y={y+4} textAnchor="middle" style={{font:"bold 10px Arial",fill:"white",pointerEvents:"none"}}>
                        {isHoverPreview ? "+" : percIdx+1}
                      </text>
                      <text x={x} y={y+r+11} textAnchor="middle" style={{font:"9px Arial",fill:isHoverPreview?"#f0a060":"#e67e22",pointerEvents:"none"}}>{o.nome}</text>
                    </>
                  : <text x={x} y={y+3} textAnchor="middle" style={{font:"10px Arial",fill:hasPreview?"#2c3e50":OBJ_TEXT,pointerEvents:"none"}}>{o.nome}</text>
                }
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── PANNELLO DESTRO ── */}
      <div style={{width:290,background:"white",borderLeft:"1px solid #dce1e7",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid #eaecef",background:"#2c3e50"}}>
          <div style={{fontSize:10,letterSpacing:2,color:"#7f8c8d",marginBottom:6}}>MUSEO</div>
          <input value={museo.nome} onChange={e=>setMuseo(m=>({...m,nome:e.target.value}))} onBlur={e=>updMuseoNome(e.target.value)} style={INP}/>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"14px 16px"}}>

          {percorsoEdit !== null && (
            <PercorsoEditor
              museo={museo}
              percorso={percorsoEdit === "nuovo" ? null : percorsoEdit}
              nomeEdit={percorsoNomeEdit}
              oggettiEdit={percorsoOggettiEdit}
              onNomeChange={setPercorsoNomeEdit}
              onOggettiChange={setPercorsoOggettiEdit}
              onHoverObj={setPercorsoHoverObj}
              onSave={salvaPercorso}
              onCancel={closePercorsoEditor}
              saving={percorsoSaving}
            />
          )}

          {!percorsoEdit && selItem && selected.type==="stanza" && (
            <Card title="STANZA" color="#27ae60">
              <FLabel>Nome</FLabel>
              <input
                value={nomeStanzaEdit}
                onChange={e => setNomeStanzaEdit(e.target.value)}
                onBlur={() => {
                  const t = nomeStanzaEdit.trim();
                  if (t && t !== selItem.nome) updStanza(selItem.nome, { nome: t });
                  else setNomeStanzaEdit(selItem.nome);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { setNomeStanzaEdit(selItem.nome); e.currentTarget.blur(); }
                }}
                style={INP}
              />              <FLabel>Tipo</FLabel>
              <select value={selItem.tipo} onChange={e=>updStanza(selItem.nome,{tipo:e.target.value})} style={INP}>
                {["normale","ingresso","uscita","bagno","servizio"].map(t=><option key={t}>{t}</option>)}
              </select>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><FLabel>Riga</FLabel><input type="number" min={0} value={selItem.row} onChange={e=>updStanza(selItem.nome,{row:+e.target.value})} style={INP}/></div>
                <div style={{flex:1}}><FLabel>Col</FLabel><input type="number" min={0} value={selItem.col} onChange={e=>updStanza(selItem.nome,{col:+e.target.value})} style={INP}/></div>
              </div>
              <button onClick={deleteSelected} style={DELBTN}>✕ Elimina stanza</button>
            </Card>
          )}

          {!percorsoEdit && selItem && selected.type==="oggetto" && (<>
            <Card title="OGGETTO" color="#3498db">
              <FLabel>Nome</FLabel>
              <input
                value={nomeOggettoEdit}
                onChange={e => setNomeOggettoEdit(e.target.value)}
                onBlur={() => {
                  const t = nomeOggettoEdit.trim();
                  if (t && t !== selItem.nome) updOggetto(selItem.nome, { nome: t });
                  else setNomeOggettoEdit(selItem.nome);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { setNomeOggettoEdit(selItem.nome); e.currentTarget.blur(); }
                }}
                style={INP}
              />              <FLabel>Stanza</FLabel>
              <select value={selItem.stanza} onChange={e=>updOggetto(selItem.nome,{stanza:e.target.value})} style={INP}>
                {museo.stanze.map(s=><option key={s.nome}>{s.nome}</option>)}
              </select>
              <FLabel>Visibile</FLabel>
              <select value={selItem.visibile?"si":"no"} onChange={e=>updOggetto(selItem.nome,{visibile:e.target.value==="si"})} style={INP}>
                <option value="si">Sì</option><option value="no">No</option>
              </select>
              <div style={{marginTop:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <FLabel>Connessioni ({selItem.connessi.length})</FLabel>
                  <button onClick={()=>setMode("connectPick")} style={{fontSize:11,padding:"3px 10px",borderRadius:4,border:"1px solid #27ae60",background:"#eafaf1",color:"#27ae60",cursor:"pointer"}}>+ Collega</button>
                </div>
                {selItem.connessi.length===0
                  ? <div style={{fontSize:11,color:"#bdc3c7",fontStyle:"italic"}}>Nessuna connessione</div>
                  : selItem.connessi.map(cn=>(
                    <div key={cn} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 8px",background:"#fef9f9",border:"1px solid #fadbd8",borderRadius:4,marginBottom:3}}>
                      <span style={{fontSize:12,color:"#2c3e50"}}>↔ {cn}</span>
                      <button onClick={()=>disconnect(selItem.nome,cn)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>
                    </div>
                  ))
                }
              </div>
              <button onClick={deleteSelected} style={{...DELBTN,marginTop:12}}>✕ Elimina oggetto</button>
            </Card>

            <ImmaginiCard
              nomeMuseo={museo.nome}
              nomeOggetto={selItem.nome}
              showToast={showToast}
              onPreviewUpdated={() => setPreviewRefreshKey(k => k + 1)}
            />

            <Card title="DESCRIZIONI" color="#8e44ad">
              <div style={{fontSize:10,color:"#8e44ad",background:"#f5eef8",border:"1px solid #d2b4de",borderRadius:4,padding:"5px 8px",marginBottom:10}}>
                💾 Le descrizioni vengono salvate con "Salva su API"
              </div>
              <div style={{display:"flex",gap:4,marginBottom:12}}>
                {["🧒","📖","🎓","🔬"].map((icon,i)=>(
                  <button key={i} onClick={()=>setDescTab(i)}
                    style={{flex:1,padding:"4px 2px",fontSize:13,borderRadius:4,cursor:"pointer",border:`1px solid ${descTab===i?"#8e44ad":"#dce1e7"}`,background:descTab===i?"#8e44ad":"transparent",color:descTab===i?"white":"#95a5a6"}}>
                    {icon}
                  </button>
                ))}
              </div>
              {["🔹 Breve","🔸 Medio","🔴 Lungo"].map((lbl,lungh)=>{
                const val = selItem.descrizioni?.[descTab]?.[lungh]??"";
                return (
                  <div key={lungh} style={{marginBottom:10}}>
                    <div style={{fontSize:10,color:"#95a5a6",marginBottom:3}}>{lbl}</div>
                    <textarea value={val} onChange={e=>updDescrizione(selItem.nome,descTab,lungh,e.target.value)} rows={3}
                      style={{width:"100%",padding:"6px 8px",border:"1px solid #dce1e7",borderRadius:5,fontSize:11,boxSizing:"border-box",resize:"vertical",outline:"none",fontFamily:"Arial,sans-serif",lineHeight:1.5}}/>
                  </div>
                );
              })}
            </Card>
          </>)}

          {!percorsoEdit && selItem && selected.type==="percorso" && (
            <Card title="PERCORSO" color="#e67e22">
              <div style={{fontSize:15,fontWeight:"bold",color:"#2c3e50",marginBottom:8}}>{selItem.nome}</div>
              <FLabel>Oggetti ({selItem.oggetti.length})</FLabel>
              {selItem.oggetti.map((n,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",background:"#fef9f0",border:"1px solid #fad7a0",borderRadius:4,marginBottom:3}}>
                  <span style={{fontSize:10,color:"#e67e22",minWidth:18,fontWeight:"bold",textAlign:"center"}}>{i+1}</span>
                  <span style={{fontSize:12,color:"#2c3e50",flex:1}}>{n}</span>
                  <span style={{fontSize:10,color:"#bdc3c7"}}>{museo.oggetti.find(o=>o.nome===n)?.stanza??""}</span>
                </div>
              ))}
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button onClick={()=>openPercorsoEditor(selItem)}
                  style={{flex:1,padding:"7px",borderRadius:5,border:"1px solid #e67e22",background:"white",color:"#e67e22",fontSize:12,cursor:"pointer"}}>✎ Modifica</button>
                <button onClick={()=>eliminaPercorso(selItem.nome)}
                  style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:"#fdecea",color:"#e74c3c",fontSize:12,cursor:"pointer"}}>✕ Elimina</button>
              </div>
            </Card>
          )}

          {!percorsoEdit && !selItem && (
            <div style={{color:"#bdc3c7",fontSize:12,textAlign:"center",marginTop:30,lineHeight:2}}>
              Seleziona una stanza,<br/>un oggetto o un percorso
            </div>
          )}

          <Section label={`Stanze (${museo.stanze.length})`}>
            {museo.stanze.map(s=>(
              <ListRow key={s.nome} active={!percorsoEdit&&selected?.nome===s.nome&&selected?.type==="stanza"} accent={TIPO_COLORS[s.tipo]?.stroke||"#2c3e50"}
                onClick={()=>{if(percorsoEdit)return;setMode("select");setSelected({type:"stanza",nome:s.nome});}}>
                <span>{s.nome}</span><span style={{fontSize:10,color:"#95a5a6"}}>{s.tipo}</span>
              </ListRow>
            ))}
          </Section>

          <Section label={`Oggetti (${museo.oggetti.length})`}>
            {museo.oggetti.map(o=>(
              <ListRow key={o.nome} active={!percorsoEdit&&selected?.nome===o.nome&&selected?.type==="oggetto"} accent="#3498db"
                onClick={()=>{
                  if(percorsoEdit){
                    const idx=percorsoOggettiEdit.indexOf(o.nome);
                    if(idx>=0)setPercorsoOggettiEdit(percorsoOggettiEdit.filter((_,i)=>i!==idx));
                    else setPercorsoOggettiEdit([...percorsoOggettiEdit,o.nome]);
                    return;
                  }
                  setMode("select");setSelected({type:"oggetto",nome:o.nome});
                }}>
                <span>{o.nome}</span><span style={{fontSize:10,color:"#95a5a6"}}>{o.stanza}</span>
              </ListRow>
            ))}
          </Section>

          <Section label={`Percorsi (${museo.percorsi.length})`}>
            <button onClick={()=>openPercorsoEditor(null)}
              style={{width:"100%",marginBottom:8,padding:"6px",borderRadius:5,border:"1px dashed #e67e22",background:"#fef9f0",color:"#e67e22",fontSize:11,cursor:"pointer",fontWeight:"bold"}}>
              + Nuovo percorso
            </button>
            {museo.percorsi.length===0
              ? <div style={{fontSize:11,color:"#bdc3c7",fontStyle:"italic"}}>Nessun percorso</div>
              : museo.percorsi.map(p=>(
                <ListRow key={p.nome} active={!percorsoEdit&&selected?.nome===p.nome&&selected?.type==="percorso"} accent="#e67e22"
                  onClick={()=>{if(percorsoEdit)return;setSelected({type:"percorso",nome:p.nome});}}>
                  <span>🗺 {p.nome}</span>
                  <span style={{fontSize:10,color:"#95a5a6"}}>{p.oggetti.length} oggetti</span>
                </ListRow>
              ))
            }
          </Section>

          {museList.length>0&&(
            <Section label="MUSEI (API)">
              {museList.map(n=>(
                <ListRow key={n} active={museo.nome===n} accent="#9b59b6" onClick={()=>loadMuseoFromApi(n)}>
                  <span>{n}</span><span style={{fontSize:10,color:"#95a5a6"}}>↓ carica</span>
                </ListRow>
              ))}
            </Section>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{borderTop:"1px solid #eaecef",padding:"12px 16px",background:"#f8f9fa"}}>
          {showExport && (
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,letterSpacing:2,color:"#95a5a6",marginBottom:8}}>ESPORTA</div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <EBtn color="#27ae60" onClick={()=>downloadJSON("layout")}>layout.json</EBtn>
                <EBtn color="#3498db" onClick={()=>downloadJSON("museo")}>museo.json</EBtn>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button onClick={saveMuseoToApi} disabled={savingAll||deletingMuseo}
              style={{flex:1,padding:"10px",borderRadius:7,border:"none",
                background:(savingAll||deletingMuseo)?"#7f8c8d":"#2c3e50",color:"white",fontSize:13,
                fontWeight:"bold",cursor:(savingAll||deletingMuseo)?"default":"pointer"}}>
              {savingAll ? "⏳ Salvataggio..." : "↑ Salva su API"}
            </button>
            <button onClick={eliminaMuseo} disabled={savingAll||deletingMuseo}
              title={`Elimina museo "${museo.nome}"`}
              style={{padding:"10px 12px",borderRadius:7,border:"1px solid #e74c3c",
                background:deletingMuseo?"#7f8c8d":"#fdecea",
                color:deletingMuseo?"white":"#e74c3c",fontSize:16,
                cursor:(savingAll||deletingMuseo)?"default":"pointer",flexShrink:0}}>
              {deletingMuseo ? "⏳" : "🗑"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────
const INP    = {width:"100%",padding:"6px 8px",border:"1px solid #dce1e7",borderRadius:5,fontSize:12,boxSizing:"border-box",marginTop:2,marginBottom:8,outline:"none"};
const DELBTN = {width:"100%",padding:"7px",border:"none",borderRadius:5,background:"#fdecea",color:"#e74c3c",fontSize:12,cursor:"pointer"};
const FLabel = ({children})=><div style={{fontSize:10,letterSpacing:1,color:"#95a5a6",marginBottom:2,marginTop:4}}>{children}</div>;
const Card   = ({title,color,children})=>(
  <div style={{background:"#f8f9fa",border:`1px solid ${color}44`,borderRadius:8,padding:12,marginBottom:16,borderTop:`3px solid ${color}`}}>
    <div style={{fontSize:10,letterSpacing:2,color,marginBottom:10}}>{title}</div>
    {children}
  </div>
);
const Section = ({label,children})=>(
  <div style={{marginTop:20}}>
    <div style={{fontSize:10,letterSpacing:1,color:"#95a5a6",marginBottom:6,paddingBottom:4,borderBottom:"1px solid #eaecef"}}>{label}</div>
    {children}
  </div>
);
const ListRow = ({children,active,accent,onClick})=>(
  <div onClick={onClick} style={{padding:"5px 8px",marginBottom:2,borderRadius:4,cursor:"pointer",background:active?"#eaf4fb":"transparent",borderLeft:`3px solid ${active?accent:"transparent"}`,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12}}>
    {children}
  </div>
);
const EBtn = ({children,onClick,color})=>(
  <button onClick={onClick} style={{flex:1,padding:"7px",border:`1px solid ${color}`,borderRadius:5,background:"white",color,fontSize:11,cursor:"pointer"}}>
    {children}
  </button>
);