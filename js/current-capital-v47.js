import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const CURRENT_STATUSES=new Set(['Active','Paused']);
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const money=n=>`${num(n)<0?'-':''}$${Math.abs(num(n)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
function route(){return(location.hash||'#dashboard').slice(1).split('?')[0]}
function readState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{accounts:[],trades:[]}}}
function opening(a){const n=Number(a?.openingBalance);return Number.isFinite(n)&&n>0?n:num(a?.sizeK)*1000}
function adjustments(a){return(a?.balanceAdjustments||[]).reduce((s,x)=>s+num(x?.amount),0)}
function tradingNet(accountId,state){let total=0;for(const t of state.trades||[]){if(t.status!=='Closed')continue;let factor=0;for(const al of t.allocations||[]){if((al.accountIds||[]).includes(accountId))factor+=num(al.quantityMultiplier||1)||1}if(!factor)continue;try{total+=num(replayTrade(t).realizedPerAccount)*factor}catch{}}return total}
function balance(a,state){return opening(a)+tradingNet(a.id,state)+adjustments(a)}
function currentAccounts(state){return(state.accounts||[]).filter(a=>CURRENT_STATUSES.has(a.status))}
function currentCapital(state){return currentAccounts(state).reduce((s,a)=>s+balance(a,state),0)}
function patch(){
  const r=route();if(!['accounts','dashboard'].includes(r))return;
  const page=document.querySelector('#app .page');if(!page)return;
  const state=readState(),total=currentCapital(state);
  for(const label of page.querySelectorAll('.kpi .k')){
    const text=label.textContent.trim();
    if(text==='رصيد جميع الحسابات'||text==='إجمالي رأس المال الحالي'){
      if(text!=='إجمالي رأس المال الحالي')label.textContent='إجمالي رأس المال الحالي';
      const value=label.parentElement?.querySelector('.v');
      if(value&&value.textContent.trim()!==money(total))value.textContent=money(total);
    }
  }
  for(const title of page.querySelectorAll('.card-title')){
    if(title.textContent.trim()!=='أرصدة الحسابات')continue;
    const sub=title.parentElement?.querySelector('.card-sub'),txt='الحسابات Active / Paused فقط تدخل في إجمالي رأس المال الحالي. الحسابات المنتهية تبقى سجلًا تاريخيًا.';
    if(sub&&sub.textContent.trim()!==txt)sub.textContent=txt;
  }
}
let timer;function schedule(){clearTimeout(timer);timer=setTimeout(patch,60)}
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('storage',e=>{if(e.key===STATE_KEY)schedule()});new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});schedule();
window.TradingOSCurrentCapital={calculate(){const state=readState();return{accounts:currentAccounts(state).map(a=>a.id),total:currentCapital(state)}}};
