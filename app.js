/* =========================
   Config
========================= */
/** Pega aquí la URL de tu Web App (termina en /exec) */
const API_BASE = "https://script.google.com/macros/s/AKfycbyok9F36_O9MwjE2lfE9M1gMViWu0KY0Z7wkolfmvmg-xU0an1K3vRY4YtUduqh-P1w/exec";

/* =========================
   Utils
========================= */
const $ = (s, c=document)=>c.querySelector(s);

function setText(id, val){
  const el = document.getElementById(id);
  if (el) el.textContent = (val ?? "—").toString();
}

/** Construye URL con params respetando si ya trae ? */
function withParams(base, paramsObj={}){
  const u = new URL(base);
  Object.entries(paramsObj).forEach(([k,v])=>{
    if (v!==undefined && v!==null) u.searchParams.set(k, v);
  });
  return u.toString();
}

function priorityScore(r){
  let s = 0;
  const crit = (r["Criticidad"]||"").toLowerCase();
  const freq = (r["Frecuencia"]||"").toLowerCase();
  const nivel= (r["Nivel de limpieza"]||"").toLowerCase();
  if (crit==="alta") s+=50; else if (crit==="media") s+=25; else s+=10;
  if (freq==="diaria") s+=30; else if (freq==="semanal") s+=20; else if (freq==="mensual") s+=10;
  if (nivel==="profunda") s+=10;
  if (!r["Fecha"]) s+=20; // empuja tareas sin historial
  return s;
}
function itemKey(r){ return [r["Área"]||"", r["Sub-área/Elemento"]||"", r["Tarea"]||""].join("||"); }

/* =========================
   Estado
========================= */
let RAW = [];
let QUEUE = [];
let DONE_TODAY = 0;

/* =========================
   API (GET / POST)
========================= */
async function fetchChecklist(){
  const url = withParams(API_BASE, { mode: "checklist" });
  const r = await fetch(url, { cache:"no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${r.status}: ${text.slice(0,180)}…`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`GET JSON inválido: ${text.slice(0,180)}…`); }
  if (!data || !Array.isArray(data.rows)) throw new Error("Respuesta inválida: falta rows[]");
  return data.rows;
}

async function postToggle(area, subarea, tarea, setHecho){
  // Enviamos text/plain para evitar preflight CORS. En tu doPost usas JSON.parse(e.postData.contents)
  const r = await fetch(API_BASE, {
    method:"POST",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify({
      mode: "toggle",
      key: { area, subarea, tarea },
      setHecho: !!setHecho
    })
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`POST ${r.status}: ${text}`); }
  if (!r.ok || !data.ok) throw new Error(data?.error || `POST ${r.status}: ${text}`);
  return data; // {ok:true, row, fecha}
}

/* =========================
   Filtros / Cola
========================= */
function buildQueue(){
  const fArea = $("#f-area")?.value.trim() || "";
  const fTipo = $("#f-tipo")?.value.trim() || "";
  const fFreq = $("#f-frecuencia")?.value.trim() || "";

  let rows = RAW.filter(r => String(r["Hecho"]).toUpperCase() !== "TRUE");
  if (fArea) rows = rows.filter(r => r["Área"]===fArea);
  if (fTipo) rows = rows.filter(r => r["Tipo de tarea"]===fTipo);
  if (fFreq) rows = rows.filter(r => r["Frecuencia"]===fFreq);

  rows.sort((a,b)=> priorityScore(b) - priorityScore(a));
  QUEUE = rows;

  const mins = rows.reduce((acc,r)=> acc + (parseInt(r["Tiempo estimado (min)"])||0), 0);
  setText("badgePend", `Pend: ${rows.length}`);
  setText("badgeCurso", `Tiempo: ${mins} min`);
}

function fillFilters(){
  const areas = [...new Set(RAW.map(r=> r["Área"]).filter(Boolean))].sort();
  const sel = $("#f-area");
  if (sel) sel.innerHTML = `<option value="">Todas las áreas</option>` + areas.map(a=>`<option>${a}</option>`).join("");

  const tSel = $("#f-tipo");
  if (tSel && tSel.options.length<=1){
    ["Rutinaria","Profunda","Desinfección","Reposición","Control","Seguridad"].forEach(v=>{
      const o=document.createElement("option");o.value=v;o.textContent=v;tSel.appendChild(o);
    });
  }
  const fSel = $("#f-frecuencia");
  if (fSel && fSel.options.length<=1){
    ["Diaria","Semanal","Mensual","Según necesidad","Cuando aplique"].forEach(v=>{
      const o=document.createElement("option");o.value=v;o.textContent=v;fSel.appendChild(o);
    });
  }
}

/* =========================
   Render tarjeta
========================= */
function renderCard(){
  const empty = $("#emptyState");
  const card  = $("#cardBody");
  const pill  = $("#pillPriority");
  const r = QUEUE[0];

  if (!r){
    empty.classList.remove("hidden");
    card.style.display = "none";
    return;
  }
  empty.classList.add("hidden");
  card.style.display = "block";

  setText("taskTitle", r["Tarea"]);
  setText("area",     r["Área"]);
  setText("subarea",  r["Sub-área/Elemento"]);
  setText("tipo",     r["Tipo de tarea"]);
  setText("frecuencia", r["Frecuencia"]);
  setText("nivel",    r["Nivel de limpieza"]);
  setText("criticidad", r["Criticidad"]);
  setText("sla",      r["SLA (máx horas)"]);
  setText("min",      r["Tiempo estimado (min)"]);
  setText("fecha",    r["Fecha"] || "—");
  setText("insumos",  r["Insumos requeridos"] || "—");
  setText("epp",      r["EPP requerido"] || "—");
  setText("obs",      r["Observaciones"] || "—");

  const score = priorityScore(r);
  pill.textContent = `Prioridad ${score}`;
  pill.className = "pill";
  if (score>=80) pill.classList.add("high");
  else if (score>=60) pill.classList.add("med");
  else pill.classList.add("low");
}

/* =========================
   Acciones
========================= */
async function marcarHecho(){
  if(!QUEUE.length) return;
  const r = QUEUE.shift();
  setText("statusMsg","Guardando…");

  try{
    const resp = await postToggle(r["Área"], r["Sub-área/Elemento"], r["Tarea"], true);
    const k = itemKey(r);
    RAW = RAW.map(x => itemKey(x)===k ? ({...x, "Hecho":"TRUE", "Fecha": resp.fecha || x["Fecha"]}) : x);
    DONE_TODAY++;
    setText("badgeComp", `Hechas hoy: ${DONE_TODAY}`);
    setText("statusMsg","Guardado ✓");
  }catch(e){
    QUEUE.unshift(r);
    console.error(e);
    setText("statusMsg", `Error al guardar: ${e.message}`);
    return;
  }
  buildQueue(); renderCard();
}

function saltar(){
  if(!QUEUE.length) return;
  const r = QUEUE.shift();
  QUEUE.push(r);
  renderCard();
}

/* =========================
   Interacciones & Swipe
========================= */
function addEvents(){
  $("#btn-hecho")?.addEventListener("click", marcarHecho);
  $("#btn-saltar")?.addEventListener("click", saltar);
  $("#btn-filtrar")?.addEventListener("click", ()=>{ buildQueue(); renderCard(); });
  $("#btn-reset")?.addEventListener("click", ()=>{
    if ($("#f-area")) $("#f-area").value="";
    if ($("#f-tipo")) $("#f-tipo").value="";
    if ($("#f-frecuencia")) $("#f-frecuencia").value="";
    buildQueue(); renderCard();
  });

  const card = $("#cardBody");
  if (card){
    let startX=0;
    card.addEventListener("pointerdown", e=> startX=e.clientX);
    card.addEventListener("pointerup",   e=>{
      const dx = e.clientX - startX;
      if (dx>80){ card.classList.add("swipe-right"); setTimeout(()=>{ card.classList.remove("swipe-right"); marcarHecho(); },150); }
      else if (dx<-80){ card.classList.add("swipe-left"); setTimeout(()=>{ card.classList.remove("swipe-left");  saltar();      },150); }
    });
  }
}

/* =========================
   Init
========================= */
(async function init(){
  setText("statusMsg","Cargando tareas…");
  try{
    RAW = await fetchChecklist();
  }catch(e){
    console.error(e);
    setText("statusMsg", `Error al cargar: ${e.message}`);
    return;
  }
  fillFilters();
  buildQueue();
  renderCard();
  addEvents();
  setText("statusMsg","Listo ✨");
})();
