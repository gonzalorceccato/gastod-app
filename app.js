'use strict';
/* Control de gastos - PWA sin dependencias. Datos: localStorage + repo PRIVADO de GitHub (API Contents). */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fARS=n=>(n<0?'-':'')+'$ '+Math.round(Math.abs(n)).toLocaleString('es-AR');
const fUSD=n=>'US$ '+n.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fPct=n=>(n*100).toLocaleString('es-AR',{maximumFractionDigits:1})+'%';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
function parseMonto(v){let s=String(v??'').trim().replace(/\s|\$/g,'');if(!s)return 0;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  const n=parseFloat(s);return isFinite(n)?n:0}

const MEDIOS=['Efectivo','Débito','Tarjeta de crédito','Transferencia','Débito automático','Billetera virtual'];
const TIPOS=['Fijo','Variable','Extraordinario'], NATS=['Imprescindible','Prescindible'], QUIENES=['Familiar','Individual'];
const DEF_CATS=[['Supermercado','Gasto',0],['Comida afuera','Gasto',1],['Farmacia','Gasto',0],['Compras digitales','Gasto',1],['Ropa','Gasto',1],['Hogar','Gasto',0],['Imprevistos','Gasto',0],['Servicios','Gasto',0],['Suscripciones','Gasto',1],['Transferencias o pagos a terceros','Gasto',0],['Otros','Gasto',1],['Impuestos y aportes','Gasto',0],['Salud','Gasto',0],['Transporte','Gasto',0],['Ocio y deporte','Gasto',1],['Pago de deuda','Pago deuda',0],['Ahorro / inversión','Ahorro',0]].map(([n,g,h])=>({n,g,h:!!h}));

function emptyData(){return{v:1,mes:'2026-10',meta:{u:0},
 config:{tcIngresos:1500,tcGastos:1500,umbral:20000,categorias:DEF_CATS},
 presupuesto:[],ingresosEsperados:[],deudas:[],
 tarjeta:{saldoInicial:0,minimo:0,pagoPlaneado:0,intereses:0,saldoReal:null,reserva:0},
 ingresos:[],movimientos:[]}}
function normalize(d){const e=emptyData();d=d||{};
  return{...e,...d,meta:{...e.meta,...(d.meta||{})},config:{...e.config,...(d.config||{})},tarjeta:{...e.tarjeta,...(d.tarjeta||{})},
   presupuesto:d.presupuesto||[],ingresosEsperados:d.ingresosEsperados||[],deudas:d.deudas||[],ingresos:d.ingresos||[],movimientos:d.movimientos||[]}}

/* ---------- estado y persistencia ---------- */
const LS=(k,v)=>{try{if(v===undefined){const x=localStorage.getItem(k);return x?JSON.parse(x):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
let cfg=LS('gc_cfg')||{owner:'',repo:'',token:'',path:'data/2026-10.json',branch:''};
let data=normalize(LS('gc_data'));
let dirty=!!LS('gc_dirty');
let status='local', tab='cargar', filt={q:'',cat:''}, formMode='gasto';
const cfgOk=()=>cfg.owner&&cfg.repo&&cfg.token;
function persist(){LS('gc_data',data);LS('gc_dirty',dirty)}
function touchCfg(){data.meta.u=Date.now();changed()}
function changed(){dirty=true;persist();setStatus(cfgOk()?'pend':'local');clearTimeout(changed.t);changed.t=setTimeout(sync,700)}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2200)}
function setStatus(s,msg){status=s;const b=$('#sync');if(!b)return;
  const map={local:['Solo local',''],ok:['✓ Sincronizado','ok'],pend:['● Pendiente','pend'],sync:['Sincronizando…','pend'],off:['Sin conexión','err'],err:['⚠ Error sync','err']};
  b.textContent=map[s][0];b.className='pill '+map[s][1];b.title=msg||''}

/* ---------- sincronización con GitHub ---------- */
const b64e=s=>{const by=new TextEncoder().encode(s);let bin='';for(let i=0;i<by.length;i+=0x8000)bin+=String.fromCharCode.apply(null,by.subarray(i,i+0x8000));return btoa(bin)};
const b64d=s=>{const bin=atob(s.replace(/\s/g,''));const by=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(by)};
function ghUrl(){return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`}
function ghHead(){return{Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}}
function mergeById(a,b){const m=new Map();for(const x of [...b,...a]){const o=m.get(x.id);if(!o||(x.u||0)>=(o.u||0))m.set(x.id,x)}return [...m.values()]}
function mergeData(local,remote){if(!remote)return local;remote=normalize(remote);
  const base=(local.meta.u||0)>=(remote.meta.u||0)?local:remote;
  return normalize({...base,movimientos:mergeById(local.movimientos,remote.movimientos),ingresos:mergeById(local.ingresos,remote.ingresos)})}
let syncing=false,again=false;
async function sync(){
  if(!cfgOk()){setStatus('local');return}
  if(syncing){again=true;return}
  syncing=true;setStatus('sync');
  try{
    for(let attempt=0;attempt<3;attempt++){
      const g=await fetch(ghUrl()+(cfg.branch?`?ref=${encodeURIComponent(cfg.branch)}`:''),{headers:ghHead(),cache:'no-store'});
      let sha=null;
      if(g.status===404){/* se crea */}
      else if(g.ok){const j=await g.json();sha=j.sha;data=mergeData(data,JSON.parse(b64d(j.content)))}
      else throw new Error('GET '+g.status+(g.status===401?' (token inválido o vencido)':g.status===403?' (permisos del token)':''));
      if(!dirty&&sha){persist();break}
      const body={message:'Actualización de movimientos '+new Date().toISOString().slice(0,16),content:b64e(JSON.stringify(data,null,1))};
      if(sha)body.sha=sha;if(cfg.branch)body.branch=cfg.branch;
      const p=await fetch(ghUrl(),{method:'PUT',headers:{...ghHead(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(p.ok){dirty=false;persist();break}
      if((p.status===409||p.status===422)&&attempt<2)continue;
      throw new Error('PUT '+p.status+(p.status===404?' (repo/ruta o permisos)':''));
    }
    setStatus('ok');if(['movs','resumen','tarjeta'].includes(tab)&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))render();
  }catch(e){setStatus(navigator.onLine?'err':'off',e.message);if(navigator.onLine)toast('Sync: '+e.message)}
  finally{syncing=false;if(again){again=false;sync()}}
}
window.addEventListener('online',sync);window.addEventListener('focus',()=>{if(cfgOk())sync()});

/* ---------- cálculos ---------- */
function calc(d=data){
  const c=d.config,tcG=+c.tcGastos||0,tcI=+c.tcIngresos||0;
  const catOf=n=>c.categorias.find(x=>x.n===n);
  const movs=d.movimientos.filter(m=>!m.x).map(m=>{const t=(+m.ars||0)+(+m.usd||0)*tcG,k=catOf(m.cat),g=k?k.g:'';
    const hor=!!m.hormiga||(g==='Gasto'&&t>0&&t<=c.umbral&&k&&k.h);
    return{...m,total:t,grupo:g,hor,sem:Math.min(4,Math.floor((+m.fecha.slice(8,10)-1)/7)+1)}}).sort((a,b)=>b.fecha.localeCompare(a.fecha)||(b.u||0)-(a.u||0));
  const gas=movs.filter(m=>m.grupo==='Gasto');
  const sum=(a,f=x=>x.total)=>a.reduce((s,x)=>s+f(x),0);
  const ings=d.ingresos.filter(i=>!i.x);
  const ingRec=sum(ings,i=>(+i.ars||0)+(+i.usd||0)*(+i.tc||tcI));
  const ingEsp=sum(d.ingresosEsperados,i=>(+i.ars||0)+(+i.usd||0)*tcI);
  const eq=p=>p.moneda==='USD'?p.monto*tcG:+p.monto||0;
  const presG=d.presupuesto.filter(p=>catOf(p.cat)&&catOf(p.cat).g==='Gasto');
  const gastos=sum(gas),tarj=sum(gas.filter(m=>m.medio==='Tarjeta de crédito'));
  const pagosDeuda=sum(movs.filter(m=>m.grupo==='Pago deuda')),ahorro=sum(movs.filter(m=>m.grupo==='Ahorro'));
  const resto=ingRec-gastos-pagosDeuda-ahorro;
  const by=(key,list,pk)=>list.map(n=>({n,real:sum(gas.filter(m=>m[key]===n)),pres:sum(presG.filter(p=>p[pk]===n),eq)}));
  const byCat=c.categorias.filter(k=>k.g==='Gasto').map(k=>({n:k.n,hor:!!k.h,real:sum(gas.filter(m=>m.cat===k.n)),pres:sum(presG.filter(p=>p.cat===k.n),eq),hors:sum(gas.filter(m=>m.cat===k.n&&m.hor)),nHor:gas.filter(m=>m.cat===k.n&&m.hor).length}));
  const hor=sum(gas.filter(m=>m.hor)),presc=sum(gas.filter(m=>m.nat==='Prescindible'));
  const card=d.tarjeta,pagosTarj=sum(movs.filter(m=>m.deudaId==='tarjeta'));
  const tarjEst=(+card.saldoInicial||0)+tarj+(+card.intereses||0)-pagosTarj;
  return{movs,gas,ings,ingRec,ingEsp,gastos,presGastos:sum(presG,eq),resultado:ingRec-gastos,pagosDeuda,ahorro,resto,
   tasa:ingRec?(ahorro+resto)/ingRec:0,tarj,cajaReal:ingRec-(gastos-tarj)-pagosDeuda-ahorro,presc,hor,nHor:gas.filter(m=>m.hor).length,
   usdIng:sum(ings,i=>+i.usd||0),usdGas:sum(gas,m=>+m.usd||0),
   byCat,byTipo:by('tipo',TIPOS,'tipo'),byNat:by('nat',NATS,'nat'),byQuien:QUIENES.map(n=>({n,real:sum(gas.filter(m=>m.quien===n))})),
   byMedio:MEDIOS.map(n=>({n,real:sum(gas.filter(m=>m.medio===n))})),
   byWeek:[1,2,3,4].map(w=>({n:'Semana '+w,r:['1–7','8–14','15–21','22–31'][w-1],real:sum(gas.filter(m=>m.sem===w)),hor:sum(gas.filter(m=>m.sem===w&&m.hor))})),
   sinCat:movs.filter(m=>!m.grupo).length,pagosTarj,tarjEst}}

/* ---------- vistas ---------- */
const opts=(a,sel)=>a.map(x=>`<option${x===sel?' selected':''}>${esc(x)}</option>`).join('');
const catOpts=sel=>data.config.categorias.map(k=>`<option${k.n===sel?' selected':''}>${esc(k.n)}</option>`).join('');
function bar(real,pres){const p=pres?Math.min(100,real/pres*100):(real?100:0);return `<div class="bar"><i class="${pres&&real>pres?'over':''}" style="width:${p}%"></i></div>`}
function tabs(){document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab))}
function render(){tabs();const v=$('#view');({cargar:vCargar,movs:vMovs,resumen:vResumen,tarjeta:vTarjeta,ajustes:vAjustes})[tab](v)}

function movFormHtml(m){const isNew=!m.id;
  return `<form id="fMov" autocomplete="off"><input type="hidden" name="mid" value="${esc(m.id||"")}">
  <label>Monto</label><div class="row"><input class="big" name="monto" inputmode="decimal" placeholder="0" value="${esc(m.monto??'')}" required style="flex:3"><select name="mon" style="flex:1"><option${m.mon!=='USD'?' selected':''}>ARS</option><option${m.mon==='USD'?' selected':''}>USD</option></select></div>
  <label>Descripción / comercio</label><input name="desc" value="${esc(m.desc||'')}" placeholder="Ej: Coto, nafta, café…">
  <div class="row"><div><label>Categoría</label><select name="cat">${catOpts(m.cat||'Supermercado')}</select></div><div><label>Medio de pago</label><select name="medio">${opts(MEDIOS,m.medio||LS('gc_medio')||'Débito')}</select></div></div>
  <div id="deudaRow" style="display:none"><label>¿A qué deuda?</label><select name="deudaId"><option value="tarjeta"${m.deudaId==='tarjeta'?' selected':''}>Tarjeta de crédito</option>${data.deudas.map(x=>`<option value="${esc(x.id)}"${m.deudaId===x.id?' selected':''}>${esc(x.nombre)}</option>`).join('')}<option value=""${m.deudaId===''?' selected':''}>Otra</option></select></div>
  <div class="row"><div><label>Fecha</label><input type="date" name="fecha" value="${esc(m.fecha||todayStr())}" required></div><div><label>Tipo</label><select name="tipo">${opts(TIPOS,m.tipo||'Variable')}</select></div></div>
  <div class="row"><div><label>Naturaleza</label><select name="nat">${opts(NATS,m.nat||'Imprescindible')}</select></div><div><label>Quién</label><select name="quien">${opts(QUIENES,m.quien||'Familiar')}</select></div></div>
  <label><input type="checkbox" name="hormiga"${m.hormiga?' checked':''}> Marcar como gasto hormiga</label>
  <label>Nota</label><input name="nota" value="${esc(m.nota||'')}">
  <button class="btn" type="submit">${isNew?'Guardar gasto':'Guardar cambios'}</button>
  ${isNew?'':'<button class="btn red" type="button" data-act="delMov">Eliminar</button>'}</form>`}
function ingFormHtml(i){return `<form id="fIng" autocomplete="off"><input type="hidden" name="mid" value="${esc(i.id||"")}">
  <label>Fuente</label><input name="fuente" list="fuentes" value="${esc(i.fuente||'')}" required><datalist id="fuentes">${data.ingresosEsperados.map(x=>`<option>${esc(x.fuente)}</option>`).join('')}</datalist>
  <div class="row"><div><label>Monto ARS</label><input name="ars" inputmode="decimal" value="${esc(i.ars||'')}"></div><div><label>Monto USD</label><input name="usd" inputmode="decimal" value="${esc(i.usd||'')}"></div></div>
  <label>Tipo de cambio REAL de liquidación (si hay USD)</label><input name="tc" inputmode="decimal" value="${esc(i.tc||'')}" placeholder="vacío = ${data.config.tcIngresos}">
  <label>Fecha de cobro</label><input type="date" name="fecha" value="${esc(i.fecha||todayStr())}" required>
  <button class="btn" type="submit">${i.id?'Guardar cambios':'Guardar ingreso'}</button>${i.id?'<button class="btn red" type="button" data-act="delIng">Eliminar</button>':''}</form>`}

function vCargar(v){const s=calc(),t=todayStr();
  const hoy=s.gas.filter(m=>m.fecha===t).reduce((a,m)=>a+m.total,0);
  v.innerHTML=`<div class="kpis"><div class="kpi"><small>Gastado hoy</small><b>${fARS(hoy)}</b></div><div class="kpi"><small>Gastado en el mes</small><b>${fARS(s.gastos)}</b></div></div>
  <div class="seg"><button class="${formMode==='gasto'?'on':''}" data-act="mode" data-m="gasto">Gasto / pago</button><button class="${formMode==='ingreso'?'on':''}" data-act="mode" data-m="ingreso">Ingreso</button></div>
  <div class="card">${formMode==='gasto'?movFormHtml({}):ingFormHtml({})}</div>
  <div class="card"><h2>Últimos cargados</h2>${s.movs.slice().sort((a,b)=>(b.u||0)-(a.u||0)).slice(0,5).map(movRow).join('')||'<div class="mut">Todavía no cargaste nada.</div>'}</div>`;
  wireForms()}
function movRow(m){return `<div class="li" data-act="editMov" data-id="${esc(m.id)}"><div>${esc(m.desc||m.cat)}${m.hor?'<span class="tag">🐜</span>':''}<div class="mut">${esc(m.fecha.slice(8)+'/'+m.fecha.slice(5,7))} · ${esc(m.cat)} · ${esc(m.medio)}</div></div><div class="r">${m.usd?fUSD(m.usd)+' ':''}${m.ars?fARS(m.ars):''}</div></div>`}
function vMovs(v){const s=calc();let l=s.movs;
  if(filt.q)l=l.filter(m=>(m.desc+' '+m.nota).toLowerCase().includes(filt.q.toLowerCase()));if(filt.cat)l=l.filter(m=>m.cat===filt.cat);
  const days={};l.forEach(m=>(days[m.fecha]=days[m.fecha]||[]).push(m));
  v.innerHTML=`<div class="card noprint"><div class="row"><input id="q" placeholder="Buscar…" value="${esc(filt.q)}"><select id="fc"><option value="">Todas las categorías</option>${catOpts(filt.cat)}</select></div></div>
  <div class="card"><h2>Ingresos (${fARS(s.ingRec)})</h2>${s.ings.map(i=>`<div class="li" data-act="editIng" data-id="${esc(i.id)}"><div>${esc(i.fuente)}<div class="mut">${esc(i.fecha)}</div></div><div class="r">${i.usd?fUSD(+i.usd)+' ':''}${i.ars?fARS(+i.ars):''}</div></div>`).join('')||'<div class="mut">Sin ingresos cargados.</div>'}</div>
  ${Object.keys(days).sort().reverse().map(d=>`<div class="card"><h2>${esc(d.split('-').reverse().join('/'))} · ${fARS(days[d].filter(m=>m.grupo==='Gasto').reduce((a,m)=>a+m.total,0))}</h2>${days[d].map(movRow).join('')}</div>`).join('')||'<div class="card mut">Sin movimientos.</div>'}`;
  $('#q').oninput=e=>{filt.q=e.target.value;clearTimeout(vMovs.t);vMovs.t=setTimeout(()=>{render();const q=$('#q');q.focus();q.setSelectionRange(q.value.length,q.value.length)},250)};
  $('#fc').onchange=e=>{filt.cat=e.target.value;render()}}
function blk(title,rows,pres=true){return `<div class="card"><h2>${title}</h2>${rows.map(r=>`<div style="margin:8px 0"><div class="li" style="border:0;padding:0"><span>${esc(r.n)}${r.r?` <span class="mut">${r.r}</span>`:''}</span><span class="r">${fARS(r.real)}${pres&&r.pres?` <span class="mut">/ ${fARS(r.pres)}</span>`:''}</span></div>${bar(r.real,pres?r.pres:0)}</div>`).join('')}</div>`}
const K=(l,val,cls='')=>`<div class="kpi"><small>${l}</small><b class="${cls}">${val}</b></div>`;
function vResumen(v){const s=calc();
  v.innerHTML=`<div class="kpis">${K('Ingresos recibidos',fARS(s.ingRec))}${K('Ingresos esperados',fARS(s.ingEsp))}${K('Gastos del mes',fARS(s.gastos))}${K('Presupuesto de gastos',fARS(s.presGastos))}
   ${K('Resultado (ingresos − gastos)',fARS(s.resultado),s.resultado<0?'neg':'pos')}${K('Resto libre',fARS(s.resto),s.resto<0?'neg':'pos')}
   ${K('Tasa de ahorro real',fPct(s.tasa))}${K('Ahorro aportado',fARS(s.ahorro))}${K('Pagos de deuda',fARS(s.pagosDeuda))}${K('Gasto en tarjeta',fARS(s.tarj))}
   ${K('Caja real (sin pagar tarjeta)',fARS(s.cajaReal))}${K('Gastos prescindibles',fARS(s.presc)+' · '+fPct(s.gastos?s.presc/s.gastos:0))}${K('🐜 Gastos hormiga ('+s.nHor+')',fARS(s.hor)+' · '+fPct(s.gastos?s.hor/s.gastos:0))}${K('Hormiga proyectada al año',fARS(s.hor*12))}
   ${K('USD ingresados',fUSD(s.usdIng))}${K('USD gastados',fUSD(s.usdGas))}</div>
  ${s.sinCat?`<div class="warn">${s.sinCat} movimiento(s) con categoría que ya no existe.</div>`:''}
  <div class="warn">La <b>caja real</b> no es ahorro: si no pagás toda la tarjeta, reservá esa plata. El resultado del mes cuenta los consumos de tarjeta aunque no los hayas pagado.</div>
  ${blk('Por categoría (real / presupuesto)',s.byCat.filter(r=>r.real||r.pres).map(r=>r))}${blk('Por tipo',s.byTipo)}${blk('Por naturaleza',s.byNat)}${blk('Familiar / individual',s.byQuien,false)}${blk('Por medio de pago',s.byMedio,false)}${blk('Por semana',s.byWeek,false)}
  <div class="card"><h2>🐜 Hormiga por categoría</h2>${s.byCat.filter(r=>r.hors).map(r=>`<div class="li"><span>${esc(r.n)} <span class="mut">${r.nHor} mov.</span></span><span class="r">${fARS(r.hors)}</span></div>`).join('')||'<div class="mut">Sin gastos hormiga todavía.</div>'}<div class="mut">Hormiga = gasto ≤ ${fARS(data.config.umbral)} en categorías candidatas, o marcado a mano.</div></div>
  <div class="card noprint"><h2>Exportar para analizar</h2>
   <button class="btn sec" data-act="expCsv">⬇ Movimientos (CSV)</button><button class="btn sec" data-act="expJson">⬇ Datos completos (JSON)</button>
   <button class="btn sec" data-act="expTxt">📋 Copiar reporte (texto)</button><button class="btn sec" data-act="print">🖨 Imprimir / guardar PDF</button>
   <div class="mut" style="margin-top:8px">El 31/10 descargá el JSON o el CSV y subilo a la conversación con Claude.</div></div>`}
function vTarjeta(v){const s=calc(),t=data.tarjeta;
  const num=(k,l)=>`<label>${l}</label><input data-tk="${k}" inputmode="decimal" value="${t[k]==null?'':esc(t[k])}">`;
  v.innerHTML=`<div class="card"><h2>💳 Tarjeta de crédito</h2>${num('saldoInicial','Saldo al 1/10')}${num('minimo','Pago mínimo del resumen')}${num('pagoPlaneado','Pago planeado en octubre (tu idea: ~450.000–500.000)')}${num('intereses','Intereses, cargos y punitorios del resumen')}${num('saldoReal','Saldo real según resumen (cuando llegue)')}${num('reserva','Reserva apartada para la tarjeta')}
   <div style="margin-top:12px">
   <div class="li"><span>Saldo al 1/10</span><span class="r">${fARS(+t.saldoInicial||0)}</span></div>
   <div class="li"><span>+ Consumos de octubre con tarjeta</span><span class="r">${fARS(s.tarj)}</span></div>
   <div class="li"><span>+ Intereses y cargos</span><span class="r">${fARS(+t.intereses||0)}</span></div>
   <div class="li"><span>− Pagos a la tarjeta registrados</span><span class="r">${fARS(s.pagosTarj)}</span></div>
   <div class="li"><b>Saldo estimado al 31/10</b><span class="r">${fARS(s.tarjEst)}</span></div>
   ${t.saldoReal!==null&&t.saldoReal!==''?`<div class="li"><span>Diferencia real − estimado</span><span class="r">${fARS((+t.saldoReal||0)-s.tarjEst)}</span></div>`:''}
   <div class="li"><span>Pago planeado vs mínimo</span><span class="r">${fARS(+t.pagoPlaneado||0)} / ${fARS(+t.minimo||0)}</span></div>
   <div class="li"><span>Pago planeado − consumos del mes</span><span class="r ${(+t.pagoPlaneado||0)-s.tarj<0?'neg':'pos'}">${fARS((+t.pagoPlaneado||0)-s.tarj)}</span></div>
   </div><div class="mut">Si el pago planeado no supera los consumos nuevos + intereses, el saldo NO baja: solo se sostiene. Cargá cada pago con categoría "Pago de deuda" → Tarjeta de crédito.</div></div>
  <div class="card"><h2>Otras deudas</h2>${data.deudas.map(d=>`<div class="li"><div>${esc(d.nombre)}<div class="mut">${esc(d.moneda)}${d.tasa?` · tasa ${esc(d.tasa)}%`:''}${d.vto?` · vto ${esc(d.vto)}`:''}</div></div><div class="r">${fARS(+d.saldoInicial||0)}</div></div>`).join('')||'<div class="mut">Sin deudas cargadas (Ajustes).</div>'}</div>`;
  v.querySelectorAll('[data-tk]').forEach(i=>i.onchange=()=>{const k=i.dataset.tk;data.tarjeta[k]=i.value===''&&k==='saldoReal'?null:parseMonto(i.value);touchCfg();render()})}
function selHtml(name,arr,val){return `<select data-f="${name}">${opts(arr,val)}</select>`}
function vAjustes(v){const c=data.config;
  v.innerHTML=`<div class="card"><h2>Sincronización con GitHub</h2><div class="warn">El token se guarda solo en este dispositivo. Usá un token de acceso mínimo (solo el repo privado de datos, permiso Contents: lectura y escritura).</div>
  <label>Usuario de GitHub</label><input data-c="owner" value="${esc(cfg.owner)}" autocapitalize="off"><label>Repositorio PRIVADO de datos</label><input data-c="repo" value="${esc(cfg.repo)}" autocapitalize="off">
  <label>Token (fine-grained)</label><input data-c="token" type="password" value="${esc(cfg.token)}"><label>Archivo de datos</label><input data-c="path" value="${esc(cfg.path)}"><label>Rama (vacío = la principal)</label><input data-c="branch" value="${esc(cfg.branch)}">
  <button class="btn" data-act="sync">Probar y sincronizar ahora</button></div>
  <div class="card"><h2>Parámetros</h2><label>Dólar real de liquidación de ingresos</label><input data-p="tcIngresos" inputmode="decimal" value="${c.tcIngresos}"><label>Dólar para gastos en USD</label><input data-p="tcGastos" inputmode="decimal" value="${c.tcGastos}"><label>Umbral gasto hormiga (ARS)</label><input data-p="umbral" inputmode="decimal" value="${c.umbral}"></div>
  <div class="card"><h2>Presupuesto mensual</h2><table class="ed" id="tp"></table><button class="btn sec sm" data-act="addPres">+ Agregar</button></div>
  <div class="card"><h2>Ingresos esperados</h2><table class="ed" id="ti"></table><button class="btn sec sm" data-act="addIngE">+ Agregar</button></div>
  <div class="card"><h2>Otras deudas</h2><table class="ed" id="td"></table><button class="btn sec sm" data-act="addDeuda">+ Agregar</button></div>
  <div class="card"><h2>Datos</h2><button class="btn sec" data-act="expJson">⬇ Exportar JSON</button><label class="btn sec" style="display:block;text-align:center">⬆ Importar JSON<input type="file" id="imp" accept=".json,application/json" hidden></label></div>`;
  v.querySelectorAll('[data-c]').forEach(i=>i.onchange=()=>{cfg[i.dataset.c]=i.value.trim();LS('gc_cfg',cfg)});
  v.querySelectorAll('[data-p]').forEach(i=>i.onchange=()=>{c[i.dataset.p]=parseMonto(i.value);touchCfg()});
  const tbl=(id,arr,cols)=>{const t=$(id);t.innerHTML=arr.map((r,ix)=>`<tr>${cols.map(([k,type,list])=>`<td>${type==='sel'?`<select data-a="${ix}" data-k="${k}">${opts(list,r[k])}</select>`:`<input data-a="${ix}" data-k="${k}" data-t="${type}" value="${esc(r[k]??'')}" ${type==='num'?'inputmode="decimal"':''}>`}</td>`).join('')}<td><button class="btn red sm" data-act="rm" data-list="${id}" data-i="${ix}">×</button></td></tr>`).join('');
    t.querySelectorAll('[data-a]').forEach(i=>i.onchange=()=>{arr[+i.dataset.a][i.dataset.k]=i.dataset.t==='num'?parseMonto(i.value):i.value;touchCfg()})};
  tbl('#tp',data.presupuesto,[['concepto','txt'],['cat','sel',c.categorias.map(k=>k.n)],['tipo','sel',TIPOS],['nat','sel',NATS],['moneda','sel',['ARS','USD']],['monto','num']]);
  tbl('#ti',data.ingresosEsperados,[['fuente','txt'],['ars','num'],['usd','num']]);
  tbl('#td',data.deudas,[['nombre','txt'],['moneda','sel',['ARS','USD']],['saldoInicial','num'],['tasa','num'],['vto','txt']]);
  $('#imp').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=normalize(JSON.parse(await f.text()));if(!confirm('Esto reemplaza los datos de este dispositivo. ¿Continuar?'))return;data=j;data.meta.u=Date.now();changed();toast('Importado');render()}catch(err){toast('Archivo inválido')}}}

/* ---------- formularios ---------- */
function wireForms(root=document){const f=root.querySelector('#fMov');
  if(f){const upd=()=>{$('#deudaRow',f).style.display=f.cat.value==='Pago de deuda'?'block':'none'};f.cat.onchange=upd;upd();
    f.onsubmit=e=>{e.preventDefault();saveMov(f)}}
  const g=root.querySelector('#fIng');if(g)g.onsubmit=e=>{e.preventDefault();saveIng(g)}}
function saveMov(f){const id=f.mid.value||uid(),monto=parseMonto(f.monto.value);if(!monto){toast('Poné un monto');return}
  const old=data.movimientos.find(x=>x.id===id),usd=f.mon.value==='USD';
  const m={id,fecha:f.fecha.value,desc:f.desc.value.trim(),cat:f.cat.value,ars:usd?0:monto,usd:usd?monto:0,medio:f.medio.value,tipo:f.tipo.value,nat:f.nat.value,quien:f.quien.value,hormiga:f.hormiga.checked,nota:f.nota.value.trim(),u:Date.now()};
  if(f.cat.value==='Pago de deuda')m.deudaId=f.deudaId.value;
  if(old)Object.assign(old,m,{x:false});else data.movimientos.push(m);
  if(!m.fecha.startsWith(data.mes))toast('Ojo: la fecha está fuera de '+data.mes);
  LS('gc_medio',m.medio);changed();$('#dlg').open&&$('#dlg').close();toast(old?'Actualizado':'Guardado ✓');render()}
function saveIng(f){const id=f.mid.value||uid();const o={id,fuente:f.fuente.value.trim(),ars:parseMonto(f.ars.value),usd:parseMonto(f.usd.value),tc:parseMonto(f.tc.value)||0,fecha:f.fecha.value,u:Date.now()};
  const old=data.ingresos.find(x=>x.id===id);if(old)Object.assign(old,o,{x:false});else data.ingresos.push(o);changed();$('#dlg').open&&$('#dlg').close();toast('Guardado ✓');render()}
function openDlg(html){const d=$('#dlg');d.innerHTML=html+'<button class="btn sec" type="button" data-act="closeDlg">Cerrar</button>';d.showModal();wireForms(d)}

/* ---------- exportar ---------- */
function download(name,text,mime){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const csvq=v=>{v=String(v??'');return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function csv(){const s=calc();const h=['fecha','descripcion','categoria','grupo','monto_ars','monto_usd','total_ars_equiv','medio','tipo','naturaleza','quien','hormiga','deuda','nota'];
  return '﻿'+[h.join(',')].concat(s.movs.slice().sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(m=>[m.fecha,m.desc,m.cat,m.grupo,m.ars||0,m.usd||0,Math.round(m.total),m.medio,m.tipo,m.nat,m.quien,m.hor?'Sí':'No',m.deudaId||'',m.nota].map(csvq).join(','))).join('\n')}
function reportTxt(){const s=calc();const L=[`# Reporte ${data.mes}`,'',`Ingresos recibidos: ${fARS(s.ingRec)} (esperados ${fARS(s.ingEsp)})`,`Gastos: ${fARS(s.gastos)} (presupuesto ${fARS(s.presGastos)})`,`Resultado: ${fARS(s.resultado)}`,`Pagos de deuda: ${fARS(s.pagosDeuda)} | Ahorro: ${fARS(s.ahorro)} | Resto libre: ${fARS(s.resto)}`,`Gasto en tarjeta: ${fARS(s.tarj)} | Caja real sin pagar tarjeta: ${fARS(s.cajaReal)}`,`Prescindibles: ${fARS(s.presc)} | Hormiga: ${fARS(s.hor)} (${s.nHor} mov.)`,`Tarjeta: saldo inicial ${fARS(+data.tarjeta.saldoInicial||0)}, estimado 31/10 ${fARS(s.tarjEst)}`,'','## Por categoría (real / presupuesto)'];
  s.byCat.filter(r=>r.real||r.pres).forEach(r=>L.push(`- ${r.n}: ${fARS(r.real)} / ${fARS(r.pres)}`));return L.join('\n')}

/* ---------- eventos ---------- */
document.addEventListener('click',e=>{const t=e.target.closest('[data-tab],[data-act]');if(!t)return;
  if(t.dataset.tab){tab=t.dataset.tab;render();scrollTo(0,0);return}
  const a=t.dataset.act,id=t.dataset.id;
  if(a==='sync'){if(!cfgOk())toast('Configurá GitHub en Ajustes');sync()}
  else if(a==='mode'){formMode=t.dataset.m;render()}
  else if(a==='editMov'){const m=data.movimientos.find(x=>x.id===id);openDlg(movFormHtml({...m,monto:m.usd||m.ars,mon:m.usd?'USD':'ARS'}))}
  else if(a==='editIng')openDlg(ingFormHtml(data.ingresos.find(x=>x.id===id)))
  else if(a==='delMov'){const f=$('#fMov',$('#dlg'));if(confirm('¿Eliminar este movimiento?')){const m=data.movimientos.find(x=>x.id===f.mid.value);m.x=true;m.u=Date.now();changed();$('#dlg').close();render()}}
  else if(a==='delIng'){const f=$('#fIng',$('#dlg'));if(confirm('¿Eliminar este ingreso?')){const m=data.ingresos.find(x=>x.id===f.mid.value);m.x=true;m.u=Date.now();changed();$('#dlg').close();render()}}
  else if(a==='closeDlg')$('#dlg').close();
  else if(a==='expCsv')download(`movimientos-${data.mes}.csv`,csv(),'text/csv');
  else if(a==='expJson')download(`gastos-${data.mes}.json`,JSON.stringify(data,null,1),'application/json');
  else if(a==='expTxt'){navigator.clipboard?.writeText(reportTxt()).then(()=>toast('Reporte copiado'),()=>toast('No se pudo copiar'))}
  else if(a==='print')print();
  else if(a==='addPres'){data.presupuesto.push({id:uid(),concepto:'',cat:data.config.categorias[0].n,tipo:'Fijo',nat:'Imprescindible',moneda:'ARS',monto:0});touchCfg();render()}
  else if(a==='addIngE'){data.ingresosEsperados.push({id:uid(),fuente:'',ars:0,usd:0});touchCfg();render()}
  else if(a==='addDeuda'){data.deudas.push({id:uid(),nombre:'',moneda:'ARS',saldoInicial:0,tasa:0,vto:''});touchCfg();render()}
  else if(a==='rm'){const map={'#tp':data.presupuesto,'#ti':data.ingresosEsperados,'#td':data.deudas};map[t.dataset.list].splice(+t.dataset.i,1);touchCfg();render()}});
document.addEventListener('DOMContentLoaded',()=>{render();setStatus(cfgOk()?(dirty?'pend':'ok'):'local');if(cfgOk())sync();
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{})});
if(document.readyState!=='loading')document.dispatchEvent(new Event('DOMContentLoaded'));
