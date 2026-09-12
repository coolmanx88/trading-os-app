const BASE='https://demo.tradovateapi.com/v1';
let overlay=null;
let session={accessToken:null,expiresAt:null,accounts:[],fills:[]};

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]))}
function fmt(v){return v==null||v===''?'—':String(v)}
function nowIso(){return new Date().toISOString()}
function setStatus(text,type=''){
  const el=overlay?.querySelector('[data-tv-status]');if(!el)return;
  el.className=`tv-status ${type}`.trim();el.textContent=text;
}
function resetSession(){session={accessToken:null,expiresAt:null,accounts:[],fills:[]}}
function close(){
  if(!overlay)return;
  overlay.querySelectorAll('input').forEach(i=>{if(i.type==='password'||i.dataset.secret==='1')i.value=''});
  resetSession();overlay.remove();overlay=null;
}
function friendlyError(err){
  const m=String(err?.message||err||'Unknown error');
  if(/Failed to fetch|NetworkError|CORS/i.test(m)) return 'تعذر الاتصال مباشرة من المتصفح. قد يكون السبب CORS أو حجب الاتصال من Tradovate. في هذه الحالة ستكون الخطوة التالية إنشاء Secure Import Service بدل الاتصال المباشر من GitHub Pages.';
  return m;
}
async function authRequest(payload){
  const r=await fetch(`${BASE}/auth/accesstokenrequest`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
  let data={};try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(`HTTP ${r.status}${data?.errorText?` — ${data.errorText}`:''}`);
  if(data?.errorText)throw new Error(data.errorText);
  if(!data?.accessToken)throw new Error('Tradovate لم يُرجع Access Token. قد تكون بيانات الدخول صحيحة للمنصة ولكن حساب Tradeify لا يملك صلاحية Partner API أو يحتاج API Key (CID/SEC).');
  return data;
}
async function apiGet(path){
  if(!session.accessToken)throw new Error('يجب تنفيذ اختبار الاتصال أولًا.');
  const r=await fetch(`${BASE}${path}`,{headers:{'Accept':'application/json','Authorization':`Bearer ${session.accessToken}`},cache:'no-store'});
  let data=null;try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(`HTTP ${r.status}${data?.errorText?` — ${data.errorText}`:''}`);
  return data;
}
function formPayload(){
  const q=s=>overlay.querySelector(s);
  const name=q('[data-tv-user]').value.trim();
  const password=q('[data-tv-pass]').value;
  const cid=q('[data-tv-cid]').value.trim();
  const sec=q('[data-tv-sec]').value.trim();
  if(!name||!password)throw new Error('أدخل Tradeify Tradovate Username وPassword أولًا.');
  const p={name,password,appId:'TradingOS',appVersion:'1.0.0'};
  if(cid)p.cid=cid;
  if(sec)p.sec=sec;
  return p;
}
function accountRows(list){
  if(!Array.isArray(list)||!list.length)return '<p class="tv-muted">لم يرجع account/list أي حسابات.</p>';
  return `<div class="tv-result"><h4>Accounts (${list.length})</h4><table><thead><tr><th>ID</th><th>Name</th><th>Active</th></tr></thead><tbody>${list.slice(0,30).map(a=>`<tr><td>${esc(a.id)}</td><td>${esc(a.name||a.accountSpec||'—')}</td><td>${a.active===false?'No':'Yes'}</td></tr>`).join('')}</tbody></table></div>`;
}
function fillRows(list){
  if(!Array.isArray(list)||!list.length)return '<div class="tv-result"><h4>Fills</h4><p class="tv-muted">لا توجد تنفيذات أو لم يرجع fill/list بيانات.</p></div>';
  const rows=[...list].sort((a,b)=>new Date(b.timestamp||b.createdAt||0)-new Date(a.timestamp||a.createdAt||0)).slice(0,20);
  return `<div class="tv-result"><h4>Latest Fills (${list.length} total)</h4><table><thead><tr><th>Time</th><th>Account</th><th>Action</th><th>Qty</th><th>Price</th><th>Contract</th></tr></thead><tbody>${rows.map(f=>`<tr><td>${esc(f.timestamp||f.createdAt||'—')}</td><td>${esc(f.accountId||'—')}</td><td>${esc(f.action||f.buyOrSell||'—')}</td><td>${esc(f.qty||f.quantity||'—')}</td><td>${esc(f.price||'—')}</td><td>${esc(f.contractId||f.contractName||'—')}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderResults(){
  const root=overlay?.querySelector('[data-tv-results]');if(!root)return;
  root.innerHTML=accountRows(session.accounts)+fillRows(session.fills);
}
async function testConnection(){
  const btn=overlay.querySelector('[data-tv-test]');
  btn.disabled=true;setStatus('جاري اختبار Tradeify → Tradovate Demo API…');
  try{
    const payload=formPayload();
    const auth=await authRequest(payload);
    session.accessToken=auth.accessToken;session.expiresAt=auth.expirationTime||null;
    overlay.querySelector('[data-tv-pass]').value='';
    overlay.querySelector('[data-tv-sec]').value='';
    setStatus(`Authentication ✓\nUser: ${fmt(auth.name)}\nUser Status: ${fmt(auth.userStatus)}\nHas Live: ${fmt(auth.hasLive)}\nHas Sim Plus: ${fmt(auth.hasSimPlus)}\nToken expiry: ${fmt(auth.expirationTime)}\n\nالـAccess Token محفوظ في الذاكرة فقط وسيُحذف عند إغلاق النافذة.`,'ok');
    const accounts=await apiGet('/account/list');
    session.accounts=Array.isArray(accounts)?accounts:[];
    overlay.querySelector('[data-tv-fills]').disabled=false;
    renderResults();
  }catch(e){setStatus(`فشل الاختبار:\n${friendlyError(e)}`,'error')}
  finally{btn.disabled=false}
}
async function fetchFills(){
  const btn=overlay.querySelector('[data-tv-fills]');btn.disabled=true;
  setStatus('Authentication ✓\nجاري قراءة fill/list…','ok');
  try{
    const fills=await apiGet('/fill/list');session.fills=Array.isArray(fills)?fills:[];
    renderResults();
    setStatus(`Tradeify / Tradovate connectivity ✓\nAccounts: ${session.accounts.length}\nFills returned: ${session.fills.length}\nChecked at: ${nowIso()}\n\nهذه مرحلة قراءة فقط. لم يتم إنشاء أي صفقة في Trading OS ولم يتم إرسال أي أمر إلى Tradovate.`,'ok');
  }catch(e){setStatus(`تم تسجيل الدخول، لكن تعذر قراءة التنفيذات:\n${friendlyError(e)}`,'error')}
  finally{btn.disabled=false}
}
function open(){
  if(overlay){overlay.remove();overlay=null}resetSession();
  overlay=document.createElement('div');overlay.className='tv-overlay';
  overlay.innerHTML=`<section class="tv-dialog" role="dialog" aria-modal="true"><div class="tv-head"><div><h2>Tradeify → Tradovate Connectivity Test</h2><p>اختبار قراءة فقط على بيئة Tradovate Demo/Simulation المستخدمة لحسابات Tradeify. لن يرسل Trading OS أوامر تداول.</p></div><button type="button" class="tv-close" data-tv-close>إغلاق</button></div><div class="tv-security">بيانات Tradeify لا تُحفظ في GitHub ولا localStorage ولا state.json. Password وAPI Secret تبقيان داخل هذه النافذة فقط، والـAccess Token يبقى في ذاكرة الصفحة ويُحذف عند الإغلاق. لا ترسل بيانات الدخول أو API Secret في محادثة ChatGPT.</div><div class="tv-grid"><label>Tradeify Tradovate Username<input autocomplete="username" data-tv-user placeholder="Username"></label><label>Tradeify Tradovate Password<input type="password" autocomplete="current-password" data-tv-pass data-secret="1" placeholder="Password"></label><label>Tradovate CID <span class="tv-muted">اختياري للاختبار الأول؛ أدخله إذا كان لديك Partner API Key.</span><input inputmode="numeric" data-tv-cid placeholder="CID"></label><label>Tradovate API Secret (SEC) <span class="tv-muted">اختياري للاختبار الأول؛ لا يتم حفظه.</span><input type="password" data-tv-sec data-secret="1" placeholder="SEC"></label><div class="tv-full tv-muted">App ID = TradingOS · App Version = 1.0.0 · Endpoint = demo.tradovateapi.com. إذا رفض Tradovate Username/Password وحدهما فسنثبت أن Tradeify يحتاج Partner API credentials للقراءة البرمجية.</div></div><div class="tv-actions"><button type="button" class="tv-btn" data-tv-test>1. اختبار الاتصال والحسابات</button><button type="button" class="tv-btn" data-tv-fills disabled>2. جلب التنفيذات Fill List</button></div><div class="tv-status" data-tv-status>أدخل بيانات Tradeify Tradovate ثم اضغط اختبار الاتصال. ابدأ بدون CID/SEC إذا لم تكن لديك، ولن نحفظ أي بيانات سرية.</div><div class="tv-results" data-tv-results></div></section>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-tv-close]').onclick=close;
  overlay.querySelector('[data-tv-test]').onclick=testConnection;
  overlay.querySelector('[data-tv-fills]').onclick=fetchFills;
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  overlay.querySelector('[data-tv-user]').focus();
}
function settingsPage(){
  const pages=[...document.querySelectorAll('.page')];
  const byTitle=pages.find(p=>/^(Settings|الإعدادات)$/i.test(p.querySelector('.page-title h1')?.textContent.trim()||''));
  if(byTitle)return byTitle;
  if(/^#settings(?:\?|$)/i.test(location.hash))return document.querySelector('.page.active,.page:not([hidden])')||null;
  return null;
}
function inject(){
  const page=settingsPage();if(!page||page.querySelector('[data-tv-tradeify-card]'))return;
  const card=document.createElement('section');card.className='tv-test-card';card.dataset.tvTradeifyCard='1';
  card.innerHTML='<h3>Tradeify · Tradovate Import Test</h3><p>المرحلة الأولى قبل بناء Import Tradovate: نتحقق هل بيانات Tradeify المخصصة لـTradovate تسمح بقراءة الحسابات والتنفيذات برمجيًا.</p><div class="tv-badges"><span>Read-only</span><span>Demo / Simulation</span><span>No credential storage</span><span>No trade orders</span></div><button type="button" data-tv-open>فتح اختبار Tradeify</button>';
  const title=page.querySelector('.page-title');title?.insertAdjacentElement('afterend',card);if(!title)page.prepend(card);
  card.querySelector('[data-tv-open]').onclick=open;
}
let scheduled=false;function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;inject()})}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('hashchange',schedule);window.addEventListener('load',schedule);schedule();
window.TradingOSTradeifyTradovateTest={open,ready:true};
