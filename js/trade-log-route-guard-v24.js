import { openTrade as openClosedTradeDirect } from './closed-trade-router.js?v=26';

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
  return openClosedTradeDirect(t.id,t.date||null)!==false;
}
function openClosedTrade(t,{normalizeHash=false}={}){
  if(!t||t.status!=='Closed')return false;
  if(normalizeHash&&location.hash!=='#log'){location.hash='#log';requestAnimationFrame(()=>requestAnimationFrame(()=>fireClosedTrade(t)));return true}
  return fireClosedTrade(t);
}
function guardActiveHash(){const id=activeHashId();if(!id)return false;const t=tradeById(id);if(!t||t.status!=='Closed')return false;openClosedTrade(t,{normalizeHash:true});return true}
function neutralizeClosedTradeLinks(){
  const state=loadState(),closed=new Map((state.trades||[]).filter(t=>t.status==='Closed').map(t=>[t.id,t]));
  document.querySelectorAll('tr').forEach(row=>{const id=(row.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0];const t=id?closed.get(id):null;if(!t)return;row.dataset.closedTradeRow='1';row.querySelectorAll('button[onclick*="#active?id="],a[onclick*="#active?id="]').forEach(btn=>{if(btn.dataset.closedRouteFixed==='1')return;btn.dataset.closedRouteFixed='1';btn.removeAttribute('onclick');btn.onclick=e=>{e.preventDefault();e.stopPropagation();openClosedTrade(t)}})})
}

window.addEventListener('click',e=>{
  if(e.target.closest?.('.closed-log-overlay,.doc-overlay,.modal'))return;
  const id=tradeIdFromNode(e.target);if(!id)return;
  const t=tradeById(id);if(!t||t.status!=='Closed')return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  openClosedTrade(t);
},true);

window.addEventListener('hashchange',()=>{guardActiveHash();setTimeout(neutralizeClosedTradeLinks,0)},true);
window.addEventListener('load',()=>{guardActiveHash();neutralizeClosedTradeLinks()});
new MutationObserver(()=>queueMicrotask(neutralizeClosedTradeLinks)).observe(document.documentElement,{childList:true,subtree:true});
guardActiveHash();neutralizeClosedTradeLinks();
