import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const FILTER_KEY='trading-os-dashboard-v2-filter';
let calendarView=new Date();
calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth(),1));
let lastSignature='';

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const money=n=>`${num(n)<0?'-':''}$${Math.abs(num(n)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
const compactMoney=n=>{const x=num(n),a=Math.abs(x),sg=x<0?'-':'';if(a>=1_000_000)return`${sg}$${(a/1_000_000).toFixed(1).replace(/\.0$/,'')}M`;if(a>=1_000)return`${sg}$${(a/1_000).toFixed(1).replace(/\.0$/,'')}K`;return`${sg}$${Math.round(a)}`};
const pct=n=>`${num(n).toLocaleString('en-US',{maximumFractionDigits:1})}%`;
const pad=n=>String(n).padStart(2,'0');

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}}
function loadFilter(){try{return localStorage.getItem(FILTER_KEY)||'ALL'}catch{return'ALL'}}
function saveFilter(v){try{localStorage.setItem(FILTER_KEY,v)}catch{}}
function route(){return(location.hash||'#dashboard').slice(1).split('?')[0]}
function tradeTime(t){if(t.actualExitAt)return t.actualExitAt;const e=[...(t.events||[])].reverse().find(x=>x.type==='CLOSE');return e?.actualTimestamp||e?.timestamp||t.closedAt||t.actualEntryAt||t.createdAt||`${t.date||'1970-01-01'}T12:00:00Z`}
function tradeDate(t){return t.date||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(tradeTime(t)))}
function reviewPending(t){return t.status==='Closed'&&!(t.documentation?.reviewFinalizedAt&&t.documentation?.reviewSnapshot)}
function allocationUnits(t,state,companyId='ALL'){
  const accounts=Object.fromEntries((state.accounts||[]).map(a=>[a.id,a]));
  const out=[];
  for(const al of t.allocations||[]){
    if(companyId!=='ALL'&&al.companyId!==companyId)continue;
    const ids=Array.isArray(al.accountIds)?al.accountIds.filter(Boolean):[];
    const mult=Math.max(0,num(al.quantityMultiplier||1))||1;
    if(ids.length){for(const id of ids){const a=accounts[id];if(companyId!=='ALL'&&a?.companyId&&a.companyId!==companyId)continue;out.push({id,companyId:a?.companyId||al.companyId,mult})}}
    else {const count=Math.max(0,Number(al.accountCount||0));for(let i=0;i<count;i++)out.push({id:`LEGACY:${al.companyId}:${i+1}`,companyId:al.companyId,mult})}
  }
  return out;
}
function scopedTrade(t,state,companyId){const units=allocationUnits(t,state,companyId);if(!units.length)return null;let r;try{r=replayTrade(t)}catch{return null}const factor=units.reduce((s,u)=>s+u.mult,0);return{t,r,units,factor,net:num(r.realizedPerAccount)*factor,gross:num(r.grossRealizedPerAccount)*factor,fees:num(r.commissionPerAccount)*factor,at:tradeTime(t),date:tradeDate(t)}}
function closedRows(state,companyId){return(state.trades||[]).filter(t=>t.status==='Closed').map(t=>scopedTrade(t,state,companyId)).filter(Boolean).sort((a,b)=>new Date(a.at)-new Date(b.at))}
function activeRows(state,companyId){return(state.trades||[]).filter(t=>['Active','Partially Closed'].includes(t.status)).map(t=>scopedTrade(t,state,companyId)).filter(Boolean)}
function selectedAccounts(state,companyId){return(state.accounts||[]).filter(a=>companyId==='ALL'||a.companyId===companyId)}
function accountNet(accountId,state){let total=0;for(const t of state.trades||[]){if(t.status!=='Closed')continue;let r;try{r=replayTrade(t)}catch{continue}for(const al of t.allocations||[]){if((al.accountIds||[]).includes(accountId))total+=num(r.realizedPerAccount)*(num(al.quantityMultiplier||1)||1)}}return total}
function adjustmentTotal(a){return(a.balanceAdjustments||[]).reduce((s,x)=>s+num(x.amount),0)}
function accountBalance(a,state){const opening=num(a.openingBalance)>0?num(a.openingBalance):num(a.sizeK)*1000;return opening+accountNet(a.id,state)+adjustmentTotal(a)}
function stats(state,companyId){
  const rows=closedRows(state,companyId),masters=rows.map(x=>num(x.r.realizedPerAccount));
  const wins=masters.filter(x=>x>0),losses=masters.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0));
  const accounts=selectedAccounts(state,companyId),activeAccounts=accounts.filter(a=>a.status==='Active');
  const capitalBase=activeAccounts.length?activeAccounts:accounts;
  const capital=capitalBase.reduce((s,a)=>s+accountBalance(a,state),0);
  const net=rows.reduce((s,x)=>s+x.net,0),gross=rows.reduce((s,x)=>s+x.gross,0),fees=rows.reduce((s,x)=>s+x.fees,0);
  return{rows,net,gross,fees,trades:rows.length,wins:wins.length,losses:losses.length,winRate:rows.length?wins.length/rows.length*100:0,profitFactor:gl?gp/gl:(gp>0?Infinity:0),expectancy:masters.length?masters.reduce((s,x)=>s+x,0)/masters.length:0,accounts,activeAccounts:activeAccounts.length,capital,pending:(state.trades||[]).filter(t=>reviewPending(t)&&allocationUnits(t,state,companyId).length).length,activeTrades:activeRows(state,companyId).length};
}
function metricCard(label,value,sub='',tone=''){return`<div class="dv2-kpi ${tone}"><div class="dv2-kpi-label">${esc(label)}</div><div class="dv2-kpi-value">${value}</div>${sub?`<div class="dv2-kpi-sub">${sub}</div>`:''}</div>`}
function equitySvg(rows){
  if(!rows.length)return'<div class="dv2-empty">لا توجد صفقات مغلقة لعرض منحنى الأداء.</div>';
  let eq=0;const points=[{v:0,label:'Start'}];for(const x of rows){eq+=x.net;points.push({v:eq,label:x.t.id,date:x.date})}
  const vals=points.map(x=>x.v),lo=Math.min(0,...vals),hi=Math.max(0,...vals),span=hi-lo||1,W=900,H=250,L=18,R=22,T=18,B=28;
  const x=i=>L+(W-L-R)*(i/Math.max(1,points.length-1)),y=v=>T+(H-T-B)*(1-(v-lo)/span);
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area=`M${x(0)},${H-B} ${points.map((p,i)=>`L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(points.length-1)},${H-B} Z`;
  const zero=y(0);const dots=points.slice(1).map((p,i)=>`<circle cx="${x(i+1)}" cy="${y(p.v)}" r="4"><title>${esc(p.date||'')} · ${esc(p.label)} · ${money(p.v)}</title></circle>`).join('');
  return`<div class="dv2-chart" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio equity curve"><defs><linearGradient id="dv2Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#655cff" stop-opacity=".30"/><stop offset="100%" stop-color="#655cff" stop-opacity="0"/></linearGradient></defs><line class="dv2-gridline" x1="${L}" x2="${W-R}" y1="${zero}" y2="${zero}"/><path class="dv2-area" d="${area}"/><path class="dv2-line" d="${path}"/>${dots}</svg><div class="dv2-chart-scale"><span>${compactMoney(lo)}</span><span>${compactMoney(hi)}</span></div></div>`
}
function keyUTC(d){return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function monthCells(rows){
  const y=calendarView.getUTCFullYear(),m=calendarView.getUTCMonth(),first=new Date(Date.UTC(y,m,1)),start=new Date(first);start.setUTCDate(1-first.getUTCDay());
  const map=new Map();for(const r of rows){if(!map.has(r.date))map.set(r.date,{pnl:0,n:0});const v=map.get(r.date);v.pnl+=r.net;v.n++}
  const cells=[];for(let i=0;i<42;i++){const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);const k=keyUTC(d),v=map.get(k)||{pnl:0,n:0},outside=d.getUTCMonth()!==m,cls=v.n?(v.pnl>0?'win':v.pnl<0?'loss':'flat'):'';cells.push(`<button type="button" class="dv2-day ${outside?'outside':''} ${cls}" data-dv2-date="${k}" title="${v.n?`${money(v.pnl)} · ${v.n} trade${v.n===1?'':'s'}`:'No trades'}"><span>${d.getUTCDate()}</span>${v.n?`<b>${v.pnl>0?'+':''}${compactMoney(v.pnl).replace('$','')}</b>`:''}</button>`)}return cells.join('')
}
function monthTitle(){return new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(calendarView)}
function recentRows(rows){const list=[...rows].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6);if(!list.length)return'<div class="dv2-empty small">لا توجد صفقات مغلقة بعد.</div>';return list.map(x=>`<button type="button" class="dv2-activity" data-dv2-trade="${esc(x.t.id)}"><span class="dv2-activity-main"><b>${esc(x.t.instrument)} · ${esc(x.t.direction)}</b><small>${esc(x.date)} · ${esc(x.t.id)}</small></span><strong class="${x.net>=0?'pos':'neg'}">${x.net>=0?'+':''}${money(x.net)}</strong></button>`).join('')}
function accountStatus(state,companyId){const acc=selectedAccounts(state,companyId),statuses=['Active','Paused','Lost','Completed','Closed'];return`<div class="dv2-status-grid">${statuses.map(s=>`<div><span>${s}</span><b>${acc.filter(a=>a.status===s).length}</b></div>`).join('')}<div><span>Total</span><b>${acc.length}</b></div></div>`}
function render(){
  if(route()!=='dashboard'){document.querySelectorAll('.page.dv2-mounted').forEach(p=>p.classList.remove('dv2-mounted'));return}
  const page=document.querySelector('#app .page');if(!page)return;
  const state=loadState(),companyId=loadFilter(),sig=`${state.meta?.updatedAt||''}|${companyId}|${calendarView.toISOString().slice(0,7)}`;
  let root=page.querySelector('[data-dashboard-v2]');if(root&&lastSignature===sig)return;
  page.classList.add('dv2-mounted');
  if(!root){root=document.createElement('section');root.dataset.dashboardV2='1';root.className='dv2-root';const title=page.querySelector('.page-title');if(title)title.insertAdjacentElement('afterend',root);else page.prepend(root)}
  lastSignature=sig;
  const s=stats(state,companyId),companies=(state.companies||[]).filter(c=>(state.accounts||[]).some(a=>a.companyId===c.id));
  root.innerHTML=`
    <div class="dv2-toolbar"><div><h2>Trading Overview</h2><p>لقطة تشغيلية سريعة للأداء، رأس المال، نشاط الحسابات، والمراجعات.</p></div><label>Scope<select data-dv2-company><option value="ALL">All Accounts</option>${companies.map(c=>`<option value="${esc(c.id)}" ${c.id===companyId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="dv2-kpis">
      ${metricCard('Net P&L',money(s.net),`Gross ${money(s.gross)} · Fees ${money(s.fees)}`,s.net>=0?'good':'bad')}
      ${metricCard('Win Rate',pct(s.winRate),`${s.wins}W / ${s.losses}L`)}
      ${metricCard('Master Trades',String(s.trades),`${s.activeTrades} active now`)}
      ${metricCard('Current Capital',money(s.capital),`${s.activeAccounts} active accounts`)}
      ${metricCard('Profit Factor',Number.isFinite(s.profitFactor)?s.profitFactor.toFixed(2):'∞','Master-trade basis')}
      ${metricCard('Expectancy',money(s.expectancy),'Per master trade',s.expectancy>=0?'good':'bad')}
      ${metricCard('Pending Reviews',String(s.pending),s.pending?'Needs attention':'All caught up',s.pending?'warn':'good')}
      ${metricCard('Active Accounts',String(s.activeAccounts),`${s.accounts.length} total accounts`)}
    </div>
    <div class="dv2-main-grid">
      <section class="dv2-panel dv2-equity"><div class="dv2-panel-head"><div><h3>Equity Curve</h3><p>Cumulative portfolio Net P&L</p></div><strong class="${s.net>=0?'pos':'neg'}">${s.net>=0?'+':''}${money(s.net)}</strong></div>${equitySvg(s.rows)}</section>
      <section class="dv2-panel dv2-calendar"><div class="dv2-panel-head"><div><h3>P&L Map</h3><p>Net P&L by trading day</p></div><div class="dv2-month-nav"><button data-dv2-prev>‹</button><b>${monthTitle()}</b><button data-dv2-next>›</button></div></div><div class="dv2-weekdays">${['S','M','T','W','T','F','S'].map(x=>`<span>${x}</span>`).join('')}</div><div class="dv2-days">${monthCells(s.rows)}</div></section>
      <section class="dv2-panel dv2-recent"><div class="dv2-panel-head"><div><h3>Recent Activity</h3><p>Latest closed master trades</p></div></div><div class="dv2-activity-list">${recentRows(s.rows)}</div></section>
    </div>
    <section class="dv2-panel dv2-status"><div class="dv2-panel-head"><div><h3>Account Status</h3><p>Current funded-account lifecycle</p></div></div>${accountStatus(state,companyId)}</section>`;
  root.querySelector('[data-dv2-company]').onchange=e=>{saveFilter(e.target.value);lastSignature='';render()};
  root.querySelector('[data-dv2-prev]').onclick=()=>{calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth()-1,1));lastSignature='';render()};
  root.querySelector('[data-dv2-next]').onclick=()=>{calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth()+1,1));lastSignature='';render()};
  root.querySelectorAll('[data-dv2-date]').forEach(b=>b.onclick=()=>window.dispatchEvent(new CustomEvent('trading-os-open-closed-day',{detail:{date:b.dataset.dv2Date}})));
  root.querySelectorAll('[data-dv2-trade]').forEach(b=>b.onclick=()=>{location.hash=`#closed-trade?id=${encodeURIComponent(b.dataset.dv2Trade)}`});
}

let timer;function schedule(){clearTimeout(timer);timer=setTimeout(render,90)}
window.addEventListener('hashchange',()=>{lastSignature='';schedule()});
window.addEventListener('load',schedule);
window.addEventListener('storage',e=>{if(e.key===STATE_KEY){lastSignature='';schedule()}});
window.addEventListener('trading-os-documentation-change',()=>{lastSignature='';schedule()});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
window.TradingOSDashboardV2={render,ready:true};
