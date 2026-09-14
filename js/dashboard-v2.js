import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const FILTER_KEY='trading-os-dashboard-v2-filter';
const CURRENT_STATUSES=new Set(['Active','Paused']);
let calendarView=new Date();
calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth(),1));
let lastSignature='';
let timer=null;

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const money=n=>`${num(n)<0?'-':''}$${Math.abs(num(n)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
const compact=n=>{const x=num(n),a=Math.abs(x),sg=x<0?'-':'';if(a>=1_000_000)return`${sg}$${(a/1_000_000).toFixed(1).replace(/\.0$/,'')}M`;if(a>=1_000)return`${sg}$${(a/1_000).toFixed(1).replace(/\.0$/,'')}K`;return`${sg}$${Math.round(a)}`};
const pct=n=>`${num(n).toLocaleString('en-US',{maximumFractionDigits:1})}%`;
const pad=n=>String(n).padStart(2,'0');

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{accounts:[],trades:[],companies:[]}}}
function loadFilter(){try{return localStorage.getItem(FILTER_KEY)||'ALL'}catch{return'ALL'}}
function saveFilter(v){try{localStorage.setItem(FILTER_KEY,v)}catch{}}
function route(){return(location.hash||'#dashboard').slice(1).split('?')[0].replace(/^\/+/, '')}
function isDashboard(){const r=route();if(r==='dashboard'||r==='')return true;const h=document.querySelector('#app .page .page-title h1')?.textContent.trim();return h==='Dashboard'||h==='لوحة التحكم'}
function tradeTime(t){if(t.actualExitAt)return t.actualExitAt;const e=[...(t.events||[])].reverse().find(x=>x.type==='CLOSE');return e?.actualTimestamp||e?.timestamp||t.closedAt||t.actualEntryAt||t.createdAt||`${t.date||'1970-01-01'}T12:00:00Z`}
function tradeDate(t){return t.date||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(tradeTime(t)))}
function hasReviewEvidence(t){const d=t?.documentation||{};const addenda=Array.isArray(d.reviewAddenda)?d.reviewAddenda:[];const r=t?.review;return Boolean((d.reviewFinalizedAt&&d.reviewSnapshot)||d.reviewSnapshot||addenda.some(x=>String(x?.text||'').trim())||(r&&[r.adherence,r.error,r.mistake,r.mainError,r.lesson,r.comment,r.notes].some(v=>String(v??'').trim())))}
function reviewPending(t){return t.status==='Closed'&&!hasReviewEvidence(t)}
function currentAccount(a){return !!a&&CURRENT_STATUSES.has(a.status)}
function accountMap(state){return Object.fromEntries((state.accounts||[]).map(a=>[a.id,a]))}

function allocationUnits(t,state,companyId='ALL'){
  const amap=accountMap(state),out=[];
  for(const al of t.allocations||[]){
    const mult=Math.max(0,num(al.quantityMultiplier||1))||1;
    const ids=Array.isArray(al.accountIds)?al.accountIds.filter(Boolean):[];
    if(ids.length){
      for(const id of ids){
        const a=amap[id];
        if(!currentAccount(a))continue;
        const cid=a.companyId||al.companyId||'';
        if(companyId!=='ALL'&&cid!==companyId)continue;
        out.push({id,companyId:cid,mult});
      }
      continue;
    }
    const current=(state.accounts||[]).filter(a=>currentAccount(a)&&(companyId==='ALL'||a.companyId===companyId)&&(!al.companyId||a.companyId===al.companyId));
    const count=Math.min(Math.max(0,Number(al.accountCount||0)),current.length);
    for(let i=0;i<count;i++)out.push({id:current[i].id,companyId:current[i].companyId,mult});
  }
  return out;
}

function scopedTrade(t,state,companyId){
  const units=allocationUnits(t,state,companyId);if(!units.length)return null;
  let r;try{r=replayTrade(t)}catch{return null}
  const factor=units.reduce((s,u)=>s+u.mult,0),masterNet=num(r.realizedPerAccount);
  return{t,r,units,factor,masterNet,net:masterNet*factor,gross:num(r.grossRealizedPerAccount)*factor,fees:num(r.commissionPerAccount)*factor,at:tradeTime(t),date:tradeDate(t)};
}
function closedRows(state,companyId){return(state.trades||[]).filter(t=>t.status==='Closed').map(t=>scopedTrade(t,state,companyId)).filter(Boolean).sort((a,b)=>new Date(a.at)-new Date(b.at))}
function activeRows(state,companyId){return(state.trades||[]).filter(t=>['Active','Partially Closed'].includes(t.status)).map(t=>scopedTrade(t,state,companyId)).filter(Boolean)}
function selectedAccounts(state,companyId,onlyCurrent=false){return(state.accounts||[]).filter(a=>(companyId==='ALL'||a.companyId===companyId)&&(!onlyCurrent||currentAccount(a)))}
function accountNet(accountId,state){let total=0;for(const t of state.trades||[]){if(t.status!=='Closed')continue;let r;try{r=replayTrade(t)}catch{continue}for(const al of t.allocations||[]){if((al.accountIds||[]).includes(accountId))total+=num(r.realizedPerAccount)*(num(al.quantityMultiplier||1)||1)}}return total}
function adjustmentTotal(a){return(a.balanceAdjustments||[]).reduce((s,x)=>s+num(x.amount),0)}
function accountBalance(a,state){const opening=num(a.openingBalance)>0?num(a.openingBalance):num(a.sizeK)*1000;return opening+accountNet(a.id,state)+adjustmentTotal(a)}

function stats(state,companyId){
  const rows=closedRows(state,companyId),masters=rows.map(x=>x.masterNet);
  const wins=masters.filter(x=>x>0),losses=masters.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0));
  const allAccounts=selectedAccounts(state,companyId,false),currentAccounts=selectedAccounts(state,companyId,true),activeAccounts=currentAccounts.filter(a=>a.status==='Active');
  const capital=currentAccounts.reduce((s,a)=>s+accountBalance(a,state),0);
  const net=rows.reduce((s,x)=>s+x.net,0),gross=rows.reduce((s,x)=>s+x.gross,0),fees=rows.reduce((s,x)=>s+x.fees,0);
  return{rows,net,gross,fees,trades:rows.length,wins:wins.length,losses:losses.length,winRate:rows.length?wins.length/rows.length*100:0,profitFactor:gl?gp/gl:(gp>0?Infinity:0),capital,currentAccounts:currentAccounts.length,activeAccounts:activeAccounts.length,allAccounts:allAccounts.length,pending:(state.trades||[]).filter(t=>reviewPending(t)&&allocationUnits(t,state,companyId).length).length,activeTrades:activeRows(state,companyId).length};
}

function metricCard(label,value,sub='',tone=''){return`<div class="dv2-kpi ${tone}"><div class="dv2-kpi-label">${esc(label)}</div><div class="dv2-kpi-value">${value}</div>${sub?`<div class="dv2-kpi-sub">${sub}</div>`:''}</div>`}
function equitySvg(rows){
  if(!rows.length)return'<div class="dv2-empty">لا توجد صفقات مغلقة للحسابات الحالية.</div>';
  let eq=0;const points=[{v:0,label:'Start'}];for(const x of rows){eq+=x.net;points.push({v:eq,label:x.t.id,date:x.date})}
  const vals=points.map(x=>x.v),lo=Math.min(0,...vals),hi=Math.max(0,...vals),span=hi-lo||1,W=900,H=250,L=18,R=22,T=18,B=28;
  const px=i=>L+(W-L-R)*(i/Math.max(1,points.length-1)),py=v=>T+(H-T-B)*(1-(v-lo)/span);
  const path=points.map((p,i)=>`${i?'L':'M'}${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' '),area=`M${px(0)},${H-B} ${points.map((p,i)=>`L${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ')} L${px(points.length-1)},${H-B} Z`;
  const zero=py(0),dots=points.slice(1).map((p,i)=>`<circle cx="${px(i+1)}" cy="${py(p.v)}" r="4"><title>${esc(p.date||'')} · ${esc(p.label)} · ${money(p.v)}</title></circle>`).join('');
  return`<div class="dv2-chart" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Current-account equity curve"><defs><linearGradient id="dv2Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#16a765" stop-opacity=".25"/><stop offset="100%" stop-color="#16a765" stop-opacity="0"/></linearGradient></defs><line class="dv2-gridline" x1="${L}" x2="${W-R}" y1="${zero}" y2="${zero}"/><path class="dv2-area" d="${area}"/><path class="dv2-line" d="${path}"/>${dots}</svg><div class="dv2-chart-scale"><span>${compact(lo)}</span><span>${compact(hi)}</span></div></div>`
}
function keyUTC(d){return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function monthTitle(){return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(calendarView)}
function dayMap(rows){const m=new Map();for(const r of rows){if(!m.has(r.date))m.set(r.date,{pnl:0,n:0});const x=m.get(r.date);x.pnl+=r.net;x.n++}return m}
function pnlMap(rows){
  const y=calendarView.getUTCFullYear(),m=calendarView.getUTCMonth(),first=new Date(Date.UTC(y,m,1)),start=new Date(first);start.setUTCDate(1-first.getUTCDay());
  const map=dayMap(rows),cells=[];
  for(let w=0;w<6;w++){
    cells.push(`<div class="dv2-week-label">W${w+1}</div>`);
    let weekly=0,weeklyN=0;
    for(let d=0;d<6;d++){
      const dt=new Date(start);dt.setUTCDate(start.getUTCDate()+w*7+d);const k=keyUTC(dt),outside=dt.getUTCMonth()!==m,v=map.get(k)||{pnl:0,n:0};
      if(!outside){weekly+=v.pnl;weeklyN+=v.n}
      const cls=v.n?(v.pnl>0?'win':v.pnl<0?'loss':'flat'):'';
      cells.push(`<button type="button" class="dv2-day ${outside?'outside':''} ${cls}" data-dv2-date="${k}" title="${k} · ${v.n?`${money(v.pnl)} · ${v.n} trade${v.n===1?'':'s'}`:'No trades'}"><b>${v.n?`${v.pnl>0?'+':''}${compact(v.pnl).replace('$','')}`:'—'}</b></button>`);
    }
    const wc=weeklyN?(weekly>0?'win':weekly<0?'loss':'flat'):'';
    cells.push(`<div class="dv2-week-total ${wc}" title="Weekly Net P&L"><b>${weeklyN?`${weekly>0?'+':''}${compact(weekly)}`:'—'}</b><span>${weeklyN?`${weeklyN} trade${weeklyN===1?'':'s'}`:'No trades'}</span></div>`);
  }
  return cells.join('');
}
function recentRows(rows){const list=[...rows].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6);if(!list.length)return'<div class="dv2-empty small">لا توجد صفقات مغلقة للحسابات الحالية.</div>';return list.map(x=>`<button type="button" class="dv2-activity" data-dv2-trade="${esc(x.t.id)}"><span class="dv2-activity-main"><b>${esc(x.t.instrument)} · ${esc(x.t.direction)}</b><small>${esc(x.date)} · ${esc(x.t.id)}</small></span><strong class="${x.net>=0?'pos':'neg'}">${x.net>=0?'+':''}${money(x.net)}</strong></button>`).join('')}
function accountStatus(state,companyId){const acc=selectedAccounts(state,companyId,false),statuses=['Active','Paused','Lost','Completed','Closed'];return`<div class="dv2-status-grid">${statuses.map(s=>`<div><span>${s}</span><b>${acc.filter(a=>a.status===s).length}</b></div>`).join('')}<div><span>Total</span><b>${acc.length}</b></div></div>`}

function render(){
  if(!isDashboard()){document.querySelectorAll('.page.dv2-mounted').forEach(p=>p.classList.remove('dv2-mounted'));return}
  const page=document.querySelector('#app .page');if(!page)return;
  const state=loadState(),companyId=loadFilter(),sig=`${state.meta?.updatedAt||''}|${companyId}|${calendarView.toISOString().slice(0,7)}`;
  let root=page.querySelector('[data-dashboard-v2]');if(root&&lastSignature===sig)return;
  page.classList.add('dv2-mounted');
  if(!root){root=document.createElement('section');root.dataset.dashboardV2='1';root.dataset.build='v48';root.className='dv2-root';const title=page.querySelector('.page-title');if(title)title.insertAdjacentElement('afterend',root);else page.prepend(root)}
  const s=stats(state,companyId),companies=(state.companies||[]).filter(c=>(state.accounts||[]).some(a=>a.companyId===c.id));
  root.innerHTML=`
    <div class="dv2-toolbar"><label>Scope<select data-dv2-company><option value="ALL">All Current Accounts</option>${companies.map(c=>`<option value="${esc(c.id)}" ${c.id===companyId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="dv2-kpis">
      ${metricCard('Net P&L',money(s.net),`Current accounts · Gross ${money(s.gross)} · Fees ${money(s.fees)}`,s.net>=0?'good':'bad')}
      ${metricCard('Win Rate',pct(s.winRate),`${s.wins}W / ${s.losses}L`)}
      ${metricCard('Profit Factor',Number.isFinite(s.profitFactor)?s.profitFactor.toFixed(2):'∞','Master-trade basis',s.profitFactor>=1?'good':'bad')}
      ${metricCard('Master Trades',String(s.trades),`${s.activeTrades} active now`)}
      ${metricCard('Current Capital',money(s.capital),`${s.currentAccounts} Active / Paused`,s.capital>=0?'good':'bad')}
      ${metricCard('Active Accounts',String(s.activeAccounts),`${s.allAccounts} total historical accounts`)}
    </div>
    <div class="dv2-main-grid">
      <section class="dv2-panel dv2-equity"><div class="dv2-panel-head"><div><h3>Equity Curve</h3></div><strong class="${s.net>=0?'pos':'neg'}">${s.net>=0?'+':''}${money(s.net)}</strong></div>${equitySvg(s.rows)}</section>
      <section class="dv2-panel dv2-calendar"><div class="dv2-panel-head"><div><h3>P&L Map (${monthTitle()})</h3></div><div class="dv2-month-nav"><button data-dv2-prev>‹</button><b>${monthTitle()}</b><button data-dv2-next>›</button></div></div><div class="dv2-weekdays"><span></span>${['Sun*','Mon','Tue','Wed','Thu','Fri','Weekly'].map(x=>`<span>${x}</span>`).join('')}</div><div class="dv2-days">${pnlMap(s.rows)}</div></section>
      <section class="dv2-panel dv2-recent"><div class="dv2-panel-head"><div><h3>Recent Activity</h3></div></div><div class="dv2-activity-list">${recentRows(s.rows)}</div></section>
    </div>
    <section class="dv2-panel dv2-status"><div class="dv2-panel-head"><div><h3>Account Status</h3></div></div>${accountStatus(state,companyId)}</section>`;
  lastSignature=sig;
  root.querySelector('[data-dv2-company]').onchange=e=>{saveFilter(e.target.value);lastSignature='';render()};
  root.querySelector('[data-dv2-prev]').onclick=()=>{calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth()-1,1));lastSignature='';render()};
  root.querySelector('[data-dv2-next]').onclick=()=>{calendarView=new Date(Date.UTC(calendarView.getUTCFullYear(),calendarView.getUTCMonth()+1,1));lastSignature='';render()};
  root.querySelectorAll('[data-dv2-date]').forEach(b=>b.onclick=()=>window.dispatchEvent(new CustomEvent('trading-os-open-closed-day',{detail:{date:b.dataset.dv2Date}})));
  root.querySelectorAll('[data-dv2-trade]').forEach(b=>b.onclick=()=>{location.hash=`#closed-trade?id=${encodeURIComponent(b.dataset.dv2Trade)}`});
}
function schedule(){clearTimeout(timer);timer=setTimeout(render,80)}
window.addEventListener('hashchange',()=>{lastSignature='';schedule()});
window.addEventListener('load',schedule);
window.addEventListener('storage',e=>{if(e.key===STATE_KEY){lastSignature='';schedule()}});
window.addEventListener('trading-os-documentation-change',()=>{lastSignature='';schedule()});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
let bootChecks=0;const bootWatch=setInterval(()=>{bootChecks++;if(isDashboard()&&!document.querySelector('[data-dashboard-v2]')){lastSignature='';try{render()}catch(e){console.error('Dashboard v48 render failed',e)}}if(document.querySelector('[data-dashboard-v2]')||bootChecks>=20)clearInterval(bootWatch)},300);
window.TradingOSDashboardV2={render,ready:true,build:'v48'};
