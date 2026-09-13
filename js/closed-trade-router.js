import { replayTrade } from './engine.js';
import { getGitHubConfig, getToken } from './github-sync.js';

const STATE_KEY='trading-os-state-v1';
const OLD_DATE_FILTER_KEY='trading-os-trade-log-date-filter';
const DB_NAME='trading-os-trade-docs-v1';
const STORE='blobs';
let dbPromise=null, overlay=null, returnDate=null, previousHash='#dashboard', routeOwned=false;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const loadState=()=>{try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[]}}};
const nyDate=iso=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(iso))+' NY'}catch{return iso||'—'}};
const dateTitle=d=>{try{return new Intl.DateTimeFormat('ar-SA',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`))}catch{return d}};
const adherence=x=>x==='Yes'?'ملتزم بالخطة':x==='Partially'?'ملتزم جزئيًا':x==='No'?'غير ملتزم بالخطة':(x||'—');

function docOf(t){
  const d=t?.documentation||{};
  return {
    charts:d.charts||{entry:null,exit:null},
    importantNotes:Array.isArray(d.importantNotes)?d.importantNotes:[],
    chartAddenda:Array.isArray(d.chartAddenda)?d.chartAddenda:[],
    reviewAddenda:Array.isArray(d.reviewAddenda)?d.reviewAddenda:[],
    reviewSnapshot:d.reviewSnapshot||null,
    reviewFinalizedAt:d.reviewFinalizedAt||null
  };
}
function eventOf(t,type,last=false){const a=(t.events||[]).filter(e=>e.type===type);return last?a[a.length-1]:a[0]}
function reviewValue(r,...keys){for(const k of keys){const v=r?.[k];if(v!==undefined&&v!==null&&v!=='')return v}return'—'}

function db(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  return dbPromise;
}
async function getBlob(key){if(!key)return null;const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
function apiHeaders(token){return{'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'}}
async function fetchRemoteBlob(path){
  const token=getToken(),cfg=getGitHubConfig();if(!token||!path)return null;
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch||'main')}`;
  const r=await fetch(url,{headers:apiHeaders(token)});if(!r.ok)return null;const x=await r.json();
  const bin=atob(String(x.content||'').replace(/\n/g,'')),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:'image/webp'});
}
async function blobFor(rec){return(await getBlob(rec?.localKey).catch(()=>null))||(rec?.path?await fetchRemoteBlob(rec.path).catch(()=>null):null)}

function ensureOverlay(){
  if(overlay&&document.body.contains(overlay))return overlay;
  overlay=document.createElement('div');overlay.className='closed-log-overlay';overlay.innerHTML='<div class="closed-log-inner"></div>';document.body.appendChild(overlay);return overlay;
}
function destroyOverlay(){overlay?.remove();overlay=null;returnDate=null;routeOwned=false}
function closeOverlay(){
  if(routeOwned && /^#closed-trade\?/i.test(location.hash)){
    location.hash=previousHash||'#dashboard';
    return;
  }
  destroyOverlay();
}
function header(title,sub,back=false){return `<div class="closed-log-top"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><div class="closed-log-actions">${back?'<button type="button" data-closed-back>← رجوع للسجل اليومي</button>':''}<button type="button" data-closed-close>إغلاق</button></div></div>`}

export function openDay(date){
  localStorage.removeItem(OLD_DATE_FILTER_KEY);
  returnDate=date;
  const state=loadState(),trades=(state.trades||[]).filter(t=>t.status==='Closed'&&t.date===date).sort((a,b)=>new Date(a.actualEntryAt||a.createdAt||0)-new Date(b.actualEntryAt||b.createdAt||0));
  const total=trades.reduce((n,t)=>n+Number(replayTrade(t).portfolioRealized||0),0),o=ensureOverlay(),root=o.querySelector('.closed-log-inner');
  root.innerHTML=`${header(`سجل الصفقات المغلقة — ${dateTitle(date)}`,`${trades.length} ${trades.length===1?'صفقة':'صفقات'} · Portfolio P&L ${money(total)}`)}<div class="closed-day-summary"><div><small>التاريخ</small><b>${esc(date)}</b></div><div><small>Closed Trades</small><b>${trades.length}</b></div><div><small>Portfolio P&L</small><b class="${total>=0?'pos':'neg'}">${money(total)}</b></div></div><div class="closed-day-list">${trades.map(t=>{const r=replayTrade(t),d=docOf(t);return `<article class="closed-day-trade" data-closed-trade="${esc(t.id)}"><div><h3>${esc(t.instrument)} ${esc(t.direction)}</h3><p>${esc(t.id)} · ${esc(nyDate(t.actualEntryAt||eventOf(t,'INITIAL')?.actualTimestamp||eventOf(t,'INITIAL')?.timestamp))}</p><div class="closed-day-badges"><span>${d.charts.entry?'Entry ✓':'Entry مفقود'}</span><span>${d.charts.exit?'Exit ✓':'Exit مفقود'}</span>${d.importantNotes.length?`<span>⚠ ${d.importantNotes.length}</span>`:''}</div></div><div class="closed-day-pnl"><b class="${Number(r.realizedPerAccount||0)>=0?'pos':'neg'}">${money(r.realizedPerAccount||0)}</b><small>Net / Account</small><strong>${money(r.portfolioRealized||0)}</strong><small>Portfolio</small></div></article>`}).join('')||'<div class="closed-empty"><b>لا توجد صفقات مغلقة في هذا اليوم.</b><span>التقويم يعرض فقط الصفقات التي حالتها Closed في تاريخ التداول المحدد.</span></div>'}</div>`;
  root.querySelector('[data-closed-close]').onclick=closeOverlay;
  root.querySelectorAll('[data-closed-trade]').forEach(x=>x.onclick=()=>navigateToTrade(x.dataset.closedTrade,date));
}

function chartHtml(key,title,rec,adds){
  return `<section class="closed-chart"><div class="closed-chart-head"><h4>${title}</h4>${rec?'<span>Original · مقفل</span>':'<span class="missing">مفقود</span>'}</div><div class="closed-chart-img" ${rec?`data-closed-img="${esc(rec.id)}"`:''}>${rec?'جاري تحميل الصورة…':'لا توجد صورة أصلية لهذه المرحلة.'}</div>${adds.map(a=>`<div class="closed-chart-add"><time>${esc(nyDate(a.createdAt))}</time><div class="closed-chart-img" data-closed-img="${esc(a.id)}">جاري تحميل الصورة…</div>${a.caption?`<p>${esc(a.caption)}</p>`:''}</div>`).join('')}</section>`;
}
async function hydrate(root,records){
  for(const rec of records){const wrap=root.querySelector(`[data-closed-img="${CSS.escape(rec.id)}"]`);if(!wrap)continue;const blob=await blobFor(rec);if(!blob){wrap.textContent='تعذر تحميل الصورة. تأكد من ربط GitHub على هذا الجهاز.';continue}const img=document.createElement('img');img.src=URL.createObjectURL(blob);wrap.innerHTML='';wrap.appendChild(img)}
}
export function openTrade(id,fromDate=null){
  const state=loadState(),t=(state.trades||[]).find(x=>x.id===id);if(!t||t.status!=='Closed')return false;
  if(fromDate)returnDate=fromDate;
  localStorage.removeItem(OLD_DATE_FILTER_KEY);
  const d=docOf(t),r=replayTrade(t),entry=eventOf(t,'INITIAL'),exit=eventOf(t,'CLOSE',true),review=d.reviewSnapshot||t.review||{},accounts=(t.allocations||[]).reduce((n,a)=>n+(a.accountIds?.length||0),0);
  const notes=[...d.importantNotes].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)),reviews=[...d.reviewAddenda].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const records=[d.charts.entry,d.charts.exit,...d.chartAddenda].filter(Boolean),o=ensureOverlay(),root=o.querySelector('.closed-log-inner');
  root.innerHTML=`${header('تفاصيل الصفقة المغلقة',`${t.id} · هذه الصفقة لا تنتمي إلى الصفقات النشطة`,Boolean(returnDate))}<div class="closed-detail-head"><div><h3>${esc(t.instrument)} ${esc(t.direction)}</h3><p>${esc(t.date||'')} · <span class="closed-status">Closed</span></p></div><div class="closed-main-pnl"><b class="${Number(r.realizedPerAccount||0)>=0?'pos':'neg'}">${money(r.realizedPerAccount||0)}</b><small>Net / Account</small></div></div><div class="closed-info-grid"><div><small>Entry</small><b>${esc(entry?.price??'—')}</b></div><div><small>Exit</small><b>${esc(exit?.price??'—')}</b></div><div><small>Stop</small><b>${esc(t.stopPrice??'—')}</b></div><div><small>Target / Account</small><b>${money(t.targetPerAccount||0)}</b></div><div><small>Portfolio P&L</small><b>${money(r.portfolioRealized||0)}</b></div><div><small>Accounts</small><b>${accounts}</b></div><div><small>Entry Time</small><b>${esc(nyDate(t.actualEntryAt||entry?.actualTimestamp||entry?.timestamp))}</b></div><div><small>Exit Time</small><b>${esc(nyDate(t.actualExitAt||exit?.actualTimestamp||exit?.timestamp))}</b></div></div><div class="closed-charts">${chartHtml('entry','شارت الدخول',d.charts.entry,d.chartAddenda.filter(x=>x.parent==='entry'))}${chartHtml('exit','شارت الإغلاق',d.charts.exit,d.chartAddenda.filter(x=>x.parent==='exit'))}</div>${notes.length?`<section class="closed-important"><h4>⚠ معلومة مهمة</h4><p class="hint">السجل الأصلي محفوظ، والإضافات تظهر بالتاريخ تحت السابق.</p>${notes.map(n=>`<article><time>${esc(nyDate(n.createdAt))}</time><p>${esc(n.text)}</p></article>`).join('')}</section>`:''}<section class="closed-review"><div class="closed-review-title"><h4>مراجعة الصفقة</h4>${d.reviewFinalizedAt?`<span>مقفلة · ${esc(nyDate(d.reviewFinalizedAt))}</span>`:''}</div><div class="closed-review-grid"><div><small>الالتزام بالخطة</small><b>${esc(adherence(review.adherence))}</b></div><div><small>الخطأ الرئيسي</small><b>${esc(reviewValue(review,'error','mistake','errorType','mainError'))}</b></div><div><small>الدرس المستفاد</small><b>${esc(reviewValue(review,'lesson','lessons','takeaway'))}</b></div></div>${reviews.length?`<div class="closed-review-addenda"><h5>مراجعات لاحقة</h5>${reviews.map(a=>`<article><time>${esc(nyDate(a.createdAt))}</time><p>${esc(a.text)}</p></article>`).join('')}</div>`:''}</section>`;
  root.querySelector('[data-closed-close]').onclick=closeOverlay;
  root.querySelector('[data-closed-back]')?.addEventListener('click',()=>openDay(returnDate));
  hydrate(root,records);
  return true;
}

export function navigateToTrade(id,date=null){
  if(!id)return false;
  if(!/^#closed-trade\?/i.test(location.hash)) previousHash=location.hash||'#dashboard';
  const target=`#closed-trade?id=${encodeURIComponent(id)}${date?`&date=${encodeURIComponent(date)}`:''}`;
  if(location.hash===target){routeOwned=true;return openTrade(id,date)}
  location.hash=target;
  return true;
}
function parseClosedRoute(){
  const m=String(location.hash||'').match(/^#closed-trade\?(.+)$/i);if(!m)return null;
  const p=new URLSearchParams(m[1]);const id=p.get('id');if(!id)return null;
  return {id,date:p.get('date')||null};
}
function handleClosedRoute(){
  const route=parseClosedRoute();
  if(route){routeOwned=true;openTrade(route.id,route.date);return true}
  if(routeOwned&&overlay)destroyOverlay();
  return false;
}

// Closed-trade navigation is intentionally explicit.
// Pages such as Dashboard and Advanced Analytics may contain trade IDs in their text,
// so a page-wide click must never infer a trade ID and hijack the click.

window.TradingOSClosedTrade={openTrade:(id,date=null)=>openTrade(id,date),openDay:date=>openDay(date),navigateToTrade:(id,date=null)=>navigateToTrade(id,date),close:()=>closeOverlay(),ready:true};
document.documentElement.dataset.closedTradeRouter='ready';
window.addEventListener('trading-os-open-closed-day',e=>{const d=e.detail?.date;if(d)openDay(d)});
window.addEventListener('trading-os-open-closed-trade',e=>{const id=e.detail?.id;if(id)navigateToTrade(id,e.detail?.date||null)});
window.addEventListener('hashchange',handleClosedRoute);
window.addEventListener('load',()=>{localStorage.removeItem(OLD_DATE_FILTER_KEY);handleClosedRoute()});
handleClosedRoute();
