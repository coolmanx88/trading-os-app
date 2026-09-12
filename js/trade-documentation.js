import { replayTrade } from './engine.js';
import { getGitHubConfig, getToken } from './github-sync.js';

const STATE_KEY='trading-os-state-v1';
const DB_NAME='trading-os-trade-docs-v1';
const STORE='blobs';
const pending={ENTRY:null,EXIT:null};
let dbPromise=null, overlay=null, toastTimer=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const uid=p=>`${p}-${crypto.randomUUID()}`;
const nowIso=()=>new Date().toISOString();
const nyDate=iso=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(iso))+' NY'}catch{return iso||'—'}};

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[]}}}
function saveState(s){s.meta=s.meta||{};s.meta.updatedAt=nowIso();localStorage.setItem(STATE_KEY,JSON.stringify(s));window.dispatchEvent(new CustomEvent('trading-os-documentation-change',{detail:{updatedAt:s.meta.updatedAt}}));}
function docOf(t){
  t.documentation=t.documentation||{};
  t.documentation.version=t.documentation.version||1;
  t.documentation.charts=t.documentation.charts||{entry:null,exit:null};
  t.documentation.importantNotes=t.documentation.importantNotes||[];
  t.documentation.chartAddenda=t.documentation.chartAddenda||[];
  t.documentation.reviewAddenda=t.documentation.reviewAddenda||[];
  return t.documentation;
}
function toast(msg,error=false){
  document.querySelector('.doc-toast')?.remove();
  const d=document.createElement('div');d.className='doc-toast'+(error?' error':'');d.textContent=msg;document.body.appendChild(d);
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>d.remove(),3600);
}

function db(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  return dbPromise;
}
async function putBlob(key,blob){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).put(blob,key);tx.oncomplete=()=>res(key);tx.onerror=()=>rej(tx.error)})}
async function getBlob(key){if(!key)return null;const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}

async function imageToWebP(file){
  if(!file||!String(file.type||'').startsWith('image/'))throw new Error('اختر ملف صورة صالحًا.');
  if(file.size>20*1024*1024)throw new Error('حجم الصورة كبير جدًا. الحد الأقصى 20MB قبل الضغط.');
  let bmp;
  try{bmp=await createImageBitmap(file)}catch{throw new Error('تعذر قراءة الصورة. استخدم PNG أو JPG أو WebP.');}
  const max=1920,scale=Math.min(1,max/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  const blob=await new Promise(r=>c.toBlob(r,'image/webp',0.84));
  if(!blob)throw new Error('تعذر ضغط الصورة.');
  return{blob,width:w,height:h,size:blob.size,mime:'image/webp'};
}
function b64FromBytes(bytes){let out='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)out+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(out)}
function apiHeaders(token){return{'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'}}
async function uploadCreateOnly(path,blob){
  const token=getToken(),cfg=getGitHubConfig();if(!token)throw new Error('GitHub غير مرتبط بهذا الجهاز. ستبقى الصورة محفوظة محليًا حتى الربط.');
  const base=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  const check=await fetch(`${base}?ref=${encodeURIComponent(cfg.branch||'main')}`,{headers:apiHeaders(token)});
  if(check.ok)return{already:true};
  if(check.status!==404)throw new Error(`GitHub check failed: ${check.status}`);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const body={message:`Add immutable trade chart ${path.split('/').pop()}`,content:b64FromBytes(bytes),branch:cfg.branch||'main'};
  const r=await fetch(base,{method:'PUT',headers:{...apiHeaders(token),'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`GitHub image upload failed: ${r.status}`);
  return await r.json();
}
async function fetchRemoteBlob(path){
  const token=getToken(),cfg=getGitHubConfig();if(!token)return null;
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch||'main')}`;
  const r=await fetch(url,{headers:apiHeaders(token)});if(!r.ok)return null;const x=await r.json();
  const bin=atob(String(x.content||'').replace(/\n/g,'')),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:'image/webp'});
}
async function blobForRecord(rec){return(await getBlob(rec?.localKey).catch(()=>null))||(rec?.path?await fetchRemoteBlob(rec.path).catch(()=>null):null)}

function recordPath(tradeId,phase,kind='original',stamp=''){
  const p=phase.toLowerCase();return `attachments/trades/${tradeId}/${p}-${kind}${stamp?'-'+stamp:''}.webp`;
}
async function markUpload(tradeId,recordId,ok,error=''){
  const s=loadState(),t=(s.trades||[]).find(x=>x.id===tradeId);if(!t)return;const d=docOf(t);
  const records=[d.charts.entry,d.charts.exit,...d.chartAddenda].filter(Boolean),r=records.find(x=>x.id===recordId);if(!r)return;
  r.uploadStatus=ok?'uploaded':'pending';if(ok){r.uploadedAt=nowIso();delete r.lastError}else r.lastError=String(error||'Upload pending');saveState(s);
}
async function uploadRecord(tradeId,rec){
  const blob=await getBlob(rec.localKey).catch(()=>null);if(!blob)return;
  try{await uploadCreateOnly(rec.path,blob);await markUpload(tradeId,rec.id,true)}catch(e){await markUpload(tradeId,rec.id,false,e.message);if(getToken())toast(`الصورة محفوظة محليًا، وتعذر رفعها: ${e.message}`,true)}
}
async function flushPendingUploads(){
  if(!getToken())return;const s=loadState();for(const t of s.trades||[]){const d=docOf(t);for(const r of [d.charts.entry,d.charts.exit,...d.chartAddenda].filter(Boolean)){if(r.uploadStatus!=='uploaded'&&r.localKey&&r.path)await uploadRecord(t.id,r)}}
}

function phaseLabel(phase){return phase==='ENTRY'?'شارت الدخول':'شارت الإغلاق'}
function buildRequirement(phase){
  const box=document.createElement('section');box.className='trade-doc-requirement';box.dataset.docPhase=phase;
  box.innerHTML=`<div class="trade-doc-head"><div><h4>${phaseLabel(phase)}</h4><p>إلزامي · رفع ملف أو سحب وإفلات أو لصق Screenshot بـ Ctrl+V. بعد اعتماد الصفقة تصبح الصورة الأصلية غير قابلة للاستبدال.</p></div><span class="doc-required">مطلوب</span></div><div class="trade-doc-drop" tabindex="0"><input class="trade-doc-file" type="file" accept="image/*"><div class="doc-placeholder"><b>أرفق ${phaseLabel(phase)}</b><span>PNG / JPG / WebP · يتم ضغطها تلقائيًا</span></div></div><div class="trade-doc-meta"><span class="doc-file-meta">لم يتم اختيار صورة</span><button type="button" class="trade-doc-clear">مسح الاختيار</button></div><div class="trade-doc-important"><label>⚠ معلومة مهمة <small style="font-weight:500">— اختيارية</small></label><textarea placeholder="ملاحظة يجب الانتباه لها. بعد حفظها ستبقى في السجل بتاريخها، وأي إضافة لاحقة تظهر تحتها دون حذف السابق."></textarea></div><div class="doc-gate-error" hidden></div>`;
  const drop=box.querySelector('.trade-doc-drop'),input=box.querySelector('input'),clear=box.querySelector('.trade-doc-clear');
  drop.onclick=e=>{if(e.target.tagName!=='BUTTON')input.click()};
  input.onchange=()=>input.files?.[0]&&selectPending(phase,input.files[0],box);
  for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')});
  for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')});
  drop.addEventListener('drop',e=>{const f=[...e.dataTransfer.files].find(x=>x.type.startsWith('image/'));if(f)selectPending(phase,f,box)});
  drop.addEventListener('paste',e=>{const f=[...e.clipboardData.files].find(x=>x.type.startsWith('image/'));if(f){e.preventDefault();selectPending(phase,f,box)}});
  clear.onclick=()=>{pending[phase]=null;paintRequirement(box,phase)};
  if(pending[phase])paintRequirement(box,phase);
  return box;
}
async function selectPending(phase,file,box){
  try{
    const x=await imageToWebP(file),localKey=uid('IMG');await putBlob(localKey,x.blob);
    pending[phase]={...x,localKey,originalName:file.name||'clipboard-image',selectedAt:nowIso()};paintRequirement(box,phase);box.querySelector('.doc-gate-error').hidden=true;
  }catch(e){toast(e.message,true)}
}
async function paintRequirement(box,phase){
  const p=pending[phase],drop=box.querySelector('.trade-doc-drop'),meta=box.querySelector('.doc-file-meta');
  drop.querySelectorAll('img').forEach(x=>x.remove());
  const ph=drop.querySelector('.doc-placeholder');
  if(!p){box.classList.remove('doc-ready');if(ph)ph.hidden=false;meta.textContent='لم يتم اختيار صورة';return}
  box.classList.add('doc-ready');if(ph)ph.hidden=true;const img=document.createElement('img'),blob=await getBlob(p.localKey).catch(()=>null);if(blob)img.src=URL.createObjectURL(blob);drop.appendChild(img);meta.textContent=`جاهز · ${(p.size/1024).toFixed(0)} KB · ${p.width}×${p.height}`;
}
function showGateError(box,msg){const e=box.querySelector('.doc-gate-error');e.textContent=msg;e.hidden=false;box.scrollIntoView({behavior:'smooth',block:'center'});}

function startMatch(btn){const t=btn.textContent.trim().replace(/\s+/g,' ');return /^(START TRADE|بدء الصفقة|ابدأ الصفقة|فتح الصفقة)$/i.test(t)}
function closeMatch(btn){const t=btn.textContent.trim().replace(/\s+/g,' ');return /^(CONFIRM CLOSE|تأكيد الإغلاق|اعتماد الإغلاق)$/i.test(t)||((btn.closest('.modal'))&&/^(CLOSE TRADE|إغلاق الصفقة)$/i.test(t))}
function insertGate(btn,phase){
  if(btn.dataset.docGate)return;btn.dataset.docGate=phase;
  const anchor=btn.closest('.modal-actions,.actions-inline,.toolbar')||btn.parentElement;if(!anchor?.parentElement)return;
  let box=anchor.parentElement.querySelector(`:scope > .trade-doc-requirement[data-doc-phase="${phase}"]`);if(!box){box=buildRequirement(phase);anchor.parentElement.insertBefore(box,anchor)}
  btn.addEventListener('click',e=>gateClick(e,btn,phase,box),true);
}
async function gateClick(e,btn,phase,box){
  if(btn.dataset.docBypass==='1'){delete btn.dataset.docBypass;return}
  const p=pending[phase];if(!p){e.preventDefault();e.stopImmediatePropagation();showGateError(box,`لا يمكن ${phase==='ENTRY'?'بدء':'إغلاق'} الصفقة قبل إرفاق ${phaseLabel(phase)}.`);return}
  e.preventDefault();e.stopImmediatePropagation();
  const before=loadState(),snapshot={ids:new Set((before.trades||[]).map(x=>x.id)),statuses:new Map((before.trades||[]).map(x=>[x.id,x.status])),at:Date.now()};
  const note=box.querySelector('textarea')?.value.trim()||'';
  btn.dataset.docBypass='1';btn.click();
  const t=await waitForTrade(phase,snapshot);if(!t){showGateError(box,'تم تنفيذ الإجراء لكن تعذر ربط الصورة بالصفقة تلقائيًا. لم يتم حذف الصورة المحلية.');toast('تعذر ربط الصورة بالصفقة تلقائيًا.',true);return}
  await attachOriginal(t.id,phase,p,note);pending[phase]=null;paintRequirement(box,phase);box.querySelector('textarea').value='';
}
async function waitForTrade(phase,snap){
  for(let i=0;i<40;i++){
    await new Promise(r=>setTimeout(r,75));const s=loadState(),tr=s.trades||[];
    let hit;
    if(phase==='ENTRY')hit=tr.filter(x=>!snap.ids.has(x.id)).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
    else hit=tr.filter(x=>x.status==='Closed'&&snap.statuses.get(x.id)!=='Closed').sort((a,b)=>new Date(b.closedAt||0)-new Date(a.closedAt||0))[0];
    if(hit)return hit;
  }
  return null;
}
async function attachOriginal(tradeId,phase,p,note){
  const s=loadState(),t=(s.trades||[]).find(x=>x.id===tradeId);if(!t)return;const d=docOf(t),key=phase==='ENTRY'?'entry':'exit';
  if(d.charts[key]){toast(`${phaseLabel(phase)} الأصلية موجودة ولن يتم استبدالها.`,true);return}
  const created=nowIso(),rec={id:uid('CHART'),kind:phase,original:true,immutable:true,createdAt:created,localKey:p.localKey,path:recordPath(tradeId,key,'original'),mime:p.mime,size:p.size,width:p.width,height:p.height,uploadStatus:'pending'};
  d.charts[key]=rec;if(note)d.importantNotes.push({id:uid('NOTE'),createdAt:created,text:note,source:phase});saveState(s);toast(`تم توثيق ${phaseLabel(phase)} وحفظها محليًا.`);uploadRecord(tradeId,rec);
}

function scanGates(){document.querySelectorAll('button').forEach(btn=>{if(startMatch(btn))insertGate(btn,'ENTRY');else if(closeMatch(btn))insertGate(btn,'EXIT')})}
function scanHistoryRows(){
  document.querySelectorAll('tr').forEach(tr=>{if(tr.querySelector('.doc-row-action'))return;const m=tr.textContent.match(/TR-[A-Za-z0-9-]+/);if(!m)return;const last=tr.querySelector('td:last-child');if(!last)return;const b=document.createElement('button');b.type='button';b.className='doc-row-action';b.textContent='التوثيق';b.onclick=e=>{e.stopPropagation();openDetail(m[0])};last.appendChild(b)})
}
function injectNav(){
  const nav=document.querySelector('.nav');if(!nav||nav.querySelector('.doc-nav-button'))return;const b=document.createElement('button');b.type='button';b.className='doc-nav-button';b.innerHTML='<span>توثيق الصفقات</span><small>Charts</small>';b.onclick=openLibrary;nav.appendChild(b);
}
function globalPaste(e){
  const boxes=[...document.querySelectorAll('.trade-doc-requirement')].filter(x=>x.offsetParent!==null);if(boxes.length!==1)return;const f=[...e.clipboardData.files].find(x=>x.type.startsWith('image/'));if(!f)return;e.preventDefault();selectPending(boxes[0].dataset.docPhase,f,boxes[0]);
}

function ensureOverlay(){
  if(overlay&&document.body.contains(overlay))return overlay;overlay=document.createElement('div');overlay.className='doc-overlay';overlay.innerHTML='<div class="doc-overlay-inner"></div>';document.body.appendChild(overlay);return overlay;
}
function closeOverlay(){overlay?.remove();overlay=null}
function openLibrary(){
  const o=ensureOverlay(),s=loadState(),tr=[...(s.trades||[])].sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0));
  o.querySelector('.doc-overlay-inner').innerHTML=`<div class="doc-overlay-top"><div><h2>توثيق الصفقات</h2><p>الشارتات الأصلية غير قابلة للاستبدال. الملاحظات والإضافات اللاحقة تحفظ بالتاريخ تحت الأصل.</p></div><button class="doc-close">إغلاق</button></div><div class="doc-trade-list">${tr.map(t=>{const d=docOf(t),r=replayTrade(t);return`<article class="doc-trade-card" data-trade-id="${esc(t.id)}"><div class="top"><div><h4>${esc(t.id)}</h4><p>${esc(t.instrument)} · ${esc(t.direction)} · ${esc(t.date||'')}</p></div><b class="${Number(r.realizedPerAccount||0)>=0?'positive':'negative'}">${money(r.realizedPerAccount||0)}</b></div><div class="doc-badges"><span class="doc-badge ${d.charts.entry?'ok':'missing'}">Entry ${d.charts.entry?'✓':'مفقود'}</span><span class="doc-badge ${d.charts.exit?'ok':'missing'}">Exit ${d.charts.exit?'✓':'مفقود'}</span>${d.importantNotes.length?`<span class="doc-badge missing">⚠ ${d.importantNotes.length}</span>`:''}</div></article>`}).join('')||'<div class="empty">لا توجد صفقات بعد.</div>'}</div>`;
  o.querySelector('.doc-close').onclick=closeOverlay;o.querySelectorAll('[data-trade-id]').forEach(x=>x.onclick=()=>openDetail(x.dataset.tradeId));
}
function info(k,v){return`<div class="doc-info"><small>${k}</small><b>${esc(v??'—')}</b></div>`}
function adherenceLabel(x){return x==='Yes'?'ملتزم بالخطة':x==='Partially'?'ملتزم جزئيًا':x==='No'?'غير ملتزم بالخطة':x||'—'}
function eventOf(t,type,last=false){const a=(t.events||[]).filter(e=>e.type===type);return last?a[a.length-1]:a[0]}
async function openDetail(tradeId){
  const s=loadState(),t=(s.trades||[]).find(x=>x.id===tradeId);if(!t)return;const d=docOf(t),r=replayTrade(t),entry=eventOf(t,'INITIAL'),exit=eventOf(t,'CLOSE',true),accounts=(t.allocations||[]).reduce((n,a)=>n+(a.accountIds?.length||0),0),o=ensureOverlay(),root=o.querySelector('.doc-overlay-inner');
  root.innerHTML=`<div class="doc-overlay-top"><div><h2>تفاصيل الصفقة الموثقة</h2><p>${esc(t.id)} · الأصل لا يُعدّل، والإضافات تسجل بالتاريخ.</p></div><button class="doc-close">إغلاق</button></div><div class="doc-detail"><div class="doc-detail-head"><div><h3>${esc(t.instrument)} ${esc(t.direction)}</h3><p>${esc(t.date||'')} · ${esc(t.status)}</p></div><button class="doc-back">← جميع الصفقات</button></div><div class="doc-info-grid">${info('Entry',entry?.price)}${info('Exit',exit?.price)}${info('Stop',t.stopPrice)}${info('Target / Account',money(t.targetPerAccount||0))}${info('Net / Account',money(r.realizedPerAccount||0))}${info('Accounts',accounts)}${info('Entry Time',nyDate(t.actualEntryAt||entry?.actualTimestamp||entry?.timestamp))}${info('Exit Time',nyDate(t.actualExitAt||exit?.actualTimestamp||exit?.timestamp))}${info('Instrument',t.instrument)}${info('Direction',t.direction)}${info('Status',t.status)}${info('Trade ID',t.id)}</div><div class="doc-charts">${chartPanel(t,'entry',d.charts.entry,d.chartAddenda.filter(x=>x.parent==='entry'))}${chartPanel(t,'exit',d.charts.exit,d.chartAddenda.filter(x=>x.parent==='exit'))}</div>${importantTimeline(t,d)}${reviewPanel(t,d)}</div>`;
  root.querySelector('.doc-close').onclick=closeOverlay;root.querySelector('.doc-back').onclick=openLibrary;
  bindDetailActions(t.id);hydrateImages(root,d);
}
function chartPanel(t,key,rec,adds){const title=key==='entry'?'شارت الدخول':'شارت الإغلاق';return`<section class="doc-panel"><div class="doc-panel-head"><h4>${title}</h4>${rec?'<span class="doc-immutable">Original · مقفل</span>':'<span class="doc-badge missing">الأصل مفقود</span>'}</div><div class="doc-image-wrap" data-img-record="${rec?esc(rec.id):''}">${rec?'<div class="doc-missing">جاري تحميل الصورة…</div>':'<div class="doc-missing">لم يتم إرفاق الصورة الأصلية لهذه الصفقة.</div>'}</div>${!rec?`<div class="doc-upload-missing"><input type="file" accept="image/*" data-add-original="${key}"><button type="button" class="doc-btn orange" data-save-original="${key}">إضافة الصورة الأصلية مرة واحدة</button></div>`:`<div style="margin-top:10px"><button type="button" class="doc-btn" data-add-chart="${key}">إضافة صورة لاحقة بتاريخ جديد</button><input type="file" accept="image/*" data-add-chart-file="${key}" hidden></div>`}<div class="doc-chart-addenda">${adds.map(a=>`<div class="doc-chart-addendum"><time>${nyDate(a.createdAt)}</time><div class="doc-image-wrap" data-img-record="${esc(a.id)}"><div class="doc-missing">جاري تحميل الإضافة…</div></div>${a.caption?`<div class="doc-caption">${esc(a.caption)}</div>`:''}</div>`).join('')}</div></section>`}
function importantTimeline(t,d){return`<section class="doc-timeline"><h4>⚠ معلومة مهمة</h4><div class="sub">سجل زمني Append-only — لا تُحذف الملاحظة السابقة ولا تُستبدل.</div><div>${d.importantNotes.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map(n=>`<div class="doc-note"><time>${nyDate(n.createdAt)} <span class="doc-note-source">${esc(n.source||'REVIEW')}</span></time><p>${esc(n.text)}</p></div>`).join('')||'<div class="doc-missing" style="min-height:auto;color:#d6b782">لا توجد ملاحظات مهمة حتى الآن.</div>'}</div><div class="doc-add-note"><textarea data-important-note placeholder="أضف ملاحظة جديدة؛ ستظهر تحت السابق بتاريخها ولن تعدّل أي ملاحظة قديمة."></textarea><button type="button" class="doc-btn orange" data-save-note>إضافة الملاحظة</button></div></section>`}
function reviewPanel(t,d){const r=t.review||{};const err=r.error||r.mistake||r.errorType||r.mainError||'—',lesson=r.lesson||r.lessons||r.takeaway||'—';return`<section class="doc-review"><h4>مراجعة الصفقة</h4><div class="doc-review-grid"><div class="doc-review-item"><small>الالتزام بالخطة</small><div>${esc(adherenceLabel(r.adherence))}</div></div><div class="doc-review-item"><small>الخطأ الرئيسي</small><div>${esc(err)}</div></div><div class="doc-review-item"><small>الدرس المستفاد</small><div>${esc(lesson)}</div></div></div>${d.reviewAddenda.map(a=>`<div class="doc-review-addendum"><time>${nyDate(a.createdAt)}</time><p>${esc(a.text)}</p></div>`).join('')}<div class="doc-addendum-form"><textarea data-review-addendum placeholder="راجعت الصفقة مرة أخرى… أضف مراجعتك الجديدة هنا. ستظهر أسفل السابق بتاريخها."></textarea><button type="button" class="doc-btn primary" data-save-review-addendum>إضافة مراجعة</button></div></section>`}
async function hydrateImages(root,d){const all=[d.charts.entry,d.charts.exit,...d.chartAddenda].filter(Boolean);for(const rec of all){const wrap=root.querySelector(`[data-img-record="${CSS.escape(rec.id)}"]`);if(!wrap)continue;const blob=await blobForRecord(rec);if(!blob){wrap.innerHTML='<div class="doc-missing">الصورة محفوظة في GitHub أو محليًا، لكن تعذر تحميلها على هذا الجهاز. تأكد من ربط GitHub.</div>';continue}const img=document.createElement('img');img.src=URL.createObjectURL(blob);wrap.innerHTML='';wrap.appendChild(img)}}
function bindDetailActions(tradeId){
  const root=overlay;
  root.querySelector('[data-save-note]')?.addEventListener('click',()=>{const ta=root.querySelector('[data-important-note]'),text=ta.value.trim();if(!text)return toast('اكتب الملاحظة أولًا.',true);const s=loadState(),t=(s.trades||[]).find(x=>x.id===tradeId);docOf(t).importantNotes.push({id:uid('NOTE'),createdAt:nowIso(),text,source:'REVIEW'});saveState(s);openDetail(tradeId)});
  root.querySelector('[data-save-review-addendum]')?.addEventListener('click',()=>{const ta=root.querySelector('[data-review-addendum]'),text=ta.value.trim();if(!text)return toast('اكتب المراجعة أولًا.',true);const s=loadState(),t=(s.trades||[]).find(x=>x.id===tradeId);docOf(t).reviewAddenda.push({id:uid('REV'),createdAt:nowIso(),text});saveState(s);openDetail(tradeId)});
  root.querySelectorAll('[data-add-chart]').forEach(b=>b.onclick=()=>root.querySelector(`[data-add-chart-file="${b.dataset.addChart}"]`)?.click());
  root.querySelectorAll('[data-add-chart-file]').forEach(input=>input.onchange=()=>input.files?.[0]&&addChartAddendum(tradeId,input.dataset.addChartFile,input.files[0]));
  root.querySelectorAll('[data-save-original]').forEach(b=>b.onclick=()=>{const key=b.dataset.saveOriginal,input=root.querySelector(`[data-add-original="${key}"]`);if(!input?.files?.[0])return toast('اختر الصورة أولًا.',true);addMissingOriginal(tradeId,key,input.files[0])});
}
async function addMissingOriginal(tradeId,key,file){
  try{const x=await imageToWebP(file),localKey=uid('IMG');await putBlob(localKey,x.blob);const s=loadState(),t=(s.trades||[]).find(z=>z.id===tradeId),d=docOf(t);if(d.charts[key])return toast('الصورة الأصلية موجودة ومقفلة.',true);const rec={id:uid('CHART'),kind:key.toUpperCase(),original:true,immutable:true,createdAt:nowIso(),localKey,path:recordPath(tradeId,key,'original'),mime:x.mime,size:x.size,width:x.width,height:x.height,uploadStatus:'pending'};d.charts[key]=rec;saveState(s);uploadRecord(tradeId,rec);openDetail(tradeId)}catch(e){toast(e.message,true)}
}
async function addChartAddendum(tradeId,key,file){
  try{const x=await imageToWebP(file),localKey=uid('IMG');await putBlob(localKey,x.blob);const caption=prompt('ملاحظة اختيارية على الصورة الجديدة:')||'',created=nowIso(),stamp=created.replace(/[-:.TZ]/g,'').slice(0,14),s=loadState(),t=(s.trades||[]).find(z=>z.id===tradeId),d=docOf(t),rec={id:uid('CHARTADD'),kind:'ADDENDUM',parent:key,original:false,immutable:true,createdAt:created,caption,localKey,path:recordPath(tradeId,key,'addendum',stamp),mime:x.mime,size:x.size,width:x.width,height:x.height,uploadStatus:'pending'};d.chartAddenda.push(rec);saveState(s);uploadRecord(tradeId,rec);openDetail(tradeId)}catch(e){toast(e.message,true)}
}

let scanTimer;function scheduleScan(){clearTimeout(scanTimer);scanTimer=setTimeout(()=>{injectNav();scanGates();scanHistoryRows()},60)}
window.addEventListener('load',()=>{scheduleScan();flushPendingUploads()});window.addEventListener('hashchange',scheduleScan);window.addEventListener('focus',()=>flushPendingUploads());document.addEventListener('paste',globalPaste,true);new MutationObserver(scheduleScan).observe(document.documentElement,{childList:true,subtree:true});scheduleScan();
