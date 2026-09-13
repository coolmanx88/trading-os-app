import { navigateToTrade as navigateToClosedTrade } from './closed-trade-router.js?v=38';

const STATE_KEY='trading-os-state-v1';
let lastOpenedId=null,lastOpenedAt=0;

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[]}}}
function tradeById(id){return (loadState().trades||[]).find(t=>t.id===id)||null}
function tradeIdFromNode(node){if(!node?.closest)return null;const row=node.closest('tr');const scope=row||node.closest('[data-trade-id],.trade-card,.card,button,a')||node;return (scope.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0]||null}
function activeHashId(){const m=String(location.hash||'').match(/^#active\?id=([^&]+)/i);if(!m)return null;try{return decodeURIComponent(m[1])}catch{return m[1]}}
function fireClosedTrade(t){
  if(!t||t.status!=='Closed')return false;
  const now=Date.now();if(lastOpenedId===t.id&&now-lastOpenedAt<350)return true;
  lastOpenedId=t.id;lastOpenedAt=now;
  return navigateToClosedTrade(t.id,t.date||null)!==false;
}
function guardActiveHash(){const id=activeHashId();if(!id)return false;const t=tradeById(id);if(!t||t.status!=='Closed')return false;fireClosedTrade(t);return true}
function neutralizeClosedTradeLinks(){
  const state=loadState(),closed=new Map((state.trades||[]).filter(t=>t.status==='Closed').map(t=>[t.id,t]));
  document.querySelectorAll('tr').forEach(row=>{const id=(row.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0];const t=id?closed.get(id):null;if(!t)return;row.dataset.closedTradeRow='1';row.querySelectorAll('button[onclick*="#active?id="],a[onclick*="#active?id="]').forEach(btn=>{if(btn.dataset.closedRouteFixed==='1')return;btn.dataset.closedRouteFixed='1';btn.removeAttribute('onclick');btn.onclick=e=>{e.preventDefault();e.stopPropagation();fireClosedTrade(t)}})})
}

window.addEventListener('click',e=>{
  // Only the historical Trade Log owns row-wide closed-trade navigation.
  // Never scan Dashboard / Analytics / Accounts pages for a TR-* string.
  if(!/^#log(?:\?|$)/i.test(location.hash))return;
  if(e.target.closest?.('.closed-log-overlay,.doc-overlay,.modal,[data-pending-review-card-v24]'))return;
  const row=e.target.closest?.('tr[data-closed-trade-row]');if(!row)return;
  const id=(row.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0];if(!id)return;
  const t=tradeById(id);if(!t||t.status!=='Closed')return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  fireClosedTrade(t);
},true);

window.addEventListener('hashchange',()=>{guardActiveHash();setTimeout(neutralizeClosedTradeLinks,0)},true);
window.addEventListener('load',()=>{guardActiveHash();neutralizeClosedTradeLinks()});
new MutationObserver(()=>queueMicrotask(neutralizeClosedTradeLinks)).observe(document.documentElement,{childList:true,subtree:true});
guardActiveHash();neutralizeClosedTradeLinks();
