import { openTrade as openClosedTrade } from './closed-trade-router.js?v=27';

const STATE_KEY='trading-os-state-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
function load(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[]}}}
function pendingTrades(){return (load().trades||[]).filter(t=>t.status==='Closed'&&!(t.documentation?.reviewFinalizedAt&&t.documentation?.reviewSnapshot))}
function dashboardPage(){return [...document.querySelectorAll('.page')].find(p=>p.querySelector('.page-title h1')?.textContent.trim()==='Dashboard')||null}
function renderDashboardPending(){
  const page=dashboardPage();if(!page)return;
  const list=pendingTrades();
  let card=page.querySelector('[data-pending-review-card-v24]');
  if(!list.length){card?.remove();return}
  if(!card){card=document.createElement('section');card.dataset.pendingReviewCardV24='1';card.className='pending-review-dashboard';const title=page.querySelector('.page-title');if(title?.nextSibling)title.parentNode.insertBefore(card,title.nextSibling);else page.prepend(card)}
  card.innerHTML=`<div><small>Post-Trade Review</small><h3>بانتظار المراجعة: ${list.length}</h3><p>صفقات مغلقة لم تُعتمد مراجعتها الأصلية بعد.</p></div><div class="pending-review-list">${list.slice(0,5).map(t=>`<button type="button" data-open-review="${esc(t.id)}"><b>${esc(t.date||'')} · ${esc(t.instrument||'')}</b><span>${esc(t.direction||'')}</span></button>`).join('')}</div>`;
  card.querySelectorAll('[data-open-review]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const t=list.find(x=>x.id===btn.dataset.openReview);if(t)openClosedTrade(t.id,t.date||null)},false));
}
function markPendingRows(){
  const pending=new Set(pendingTrades().map(t=>t.id));
  document.querySelectorAll('tr').forEach(row=>{const id=(row.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0];if(!id||!pending.has(id))return;const cells=row.querySelectorAll('td');if(!cells.length||row.querySelector('.pending-review-badge'))return;const target=cells[cells.length-1];const badge=document.createElement('span');badge.className='pending-review-badge';badge.textContent='بانتظار المراجعة';badge.style.marginInlineStart='6px';target.appendChild(badge)})
}
function refresh(){renderDashboardPending();markPendingRows()}
let timer;function schedule(){clearTimeout(timer);timer=setTimeout(refresh,50)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('trading-os-review-change',schedule);window.addEventListener('trading-os-documentation-change',schedule);schedule();
