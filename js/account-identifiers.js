import { saveLocal } from './store.js';

const LOCAL_KEY='trading-os-state-v1';
const normalize=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));

function readState(){
  const raw=localStorage.getItem(LOCAL_KEY);
  if(!raw) return null;
  try{return JSON.parse(raw)}catch{return null}
}
function accountsPage(){
  const pages=[...document.querySelectorAll('.page')];
  const p=pages.find(x=>/^(Accounts|الحسابات)$/i.test(x.querySelector('.page-title h1')?.textContent.trim()||''));
  if(p)return p;
  if(/^#accounts(?:\?|$)/i.test(location.hash))return document.querySelector('.page.active,.page:not([hidden])')||null;
  return null;
}
function labelFor(a,companies){
  const c=companies[a.companyId]?.name||a.companyId||'—';
  return `${c} · ${a.sizeK||'—'}K · ${a.stage||'—'} · #${a.sequence||'—'} · ${a.status||'—'}`;
}
function validate(rows){
  const seen=new Map();
  for(const r of rows){
    const n=normalize(r.number);if(!n)continue;
    const k=`${r.companyId}|${n}`;
    if(seen.has(k))throw new Error(`رقم الحساب ${r.number} مستخدم لأكثر من حساب داخل نفس الشركة.`);
    seen.set(k,r.id);
  }
}
function inject(){
  const page=accountsPage();if(!page||page.querySelector('[data-account-identifiers]'))return;
  const state=readState();if(!state)return;
  const companies=Object.fromEntries((state.companies||[]).map(c=>[c.id,c]));
  const accounts=[...(state.accounts||[])].sort((a,b)=>{
    const ca=companies[a.companyId]?.name||'',cb=companies[b.companyId]?.name||'';
    return ca.localeCompare(cb)||Number(a.sequence||0)-Number(b.sequence||0);
  });
  const card=document.createElement('section');card.className='account-id-card';card.dataset.accountIdentifiers='1';
  card.innerHTML=`<div class="account-id-head"><div><h3>أرقام الحسابات</h3><p>احفظ رقم الحساب الحقيقي كما يظهر لدى الوسيط/Tradovate، مثل TDFYSL50161466285. يستخدمه Trading OS للمطابقة التلقائية في الاستيراد ومنع ربط الصفقة بالحساب الخطأ.</p></div><span class="account-id-badge">Broker Account ID</span></div><div class="account-id-list">${accounts.length?accounts.map(a=>`<label class="account-id-row"><span><b>${esc(labelFor(a,companies))}</b><small>${esc(a.id)}</small></span><input class="input ltr" data-account-number="${esc(a.id)}" value="${esc(a.accountNumber||'')}" placeholder="مثال: TDFYSL50161466285" autocomplete="off"></label>`).join(''):'<div class="empty">لا توجد حسابات بعد.</div>'}</div><div class="account-id-footer"><span data-account-id-status>أي تعديل سيصبح Pending Sync.</span><button type="button" class="btn btn-primary" data-save-account-ids ${accounts.length?'':'disabled'}>حفظ أرقام الحسابات</button></div>`;
  const title=page.querySelector('.page-title');if(title)title.insertAdjacentElement('afterend',card);else page.prepend(card);
  const btn=card.querySelector('[data-save-account-ids]');if(!btn)return;
  btn.onclick=()=>{
    try{
      const fresh=readState();if(!fresh)throw new Error('تعذر قراءة بيانات النظام.');
      const rows=[...card.querySelectorAll('[data-account-number]')].map(i=>{
        const a=(fresh.accounts||[]).find(x=>x.id===i.dataset.accountNumber);
        return{id:i.dataset.accountNumber,companyId:a?.companyId||'',number:i.value.trim()};
      });
      validate(rows);
      for(const r of rows){const a=(fresh.accounts||[]).find(x=>x.id===r.id);if(a)a.accountNumber=r.number;}
      fresh.meta=fresh.meta||{};fresh.meta.updatedAt=new Date().toISOString();saveLocal(fresh,true);
      const s=card.querySelector('[data-account-id-status]');s.textContent='تم الحفظ ✓ · Pending Sync إلى GitHub';s.classList.add('ok');
      window.dispatchEvent(new CustomEvent('trading-os-account-identifiers-change'));
    }catch(e){const s=card.querySelector('[data-account-id-status]');s.textContent=e.message||String(e);s.classList.remove('ok');s.classList.add('error');}
  };
}
let scheduled=false;function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;inject()})}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('hashchange',schedule);window.addEventListener('load',schedule);schedule();
window.TradingOSAccountIdentifiers={ready:true};
