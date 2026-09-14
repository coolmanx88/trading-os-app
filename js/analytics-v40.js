import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const FILTER_KEY='trading-os-analytics-filter-v40';
const CURRENT_STATUSES=new Set(['Active','Paused']);
let lastSignature='';
let renderTimer=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const money=n=>`${num(n)<0?'-':''}$${Math.abs(num(n)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const compactMoney=n=>{const x=num(n),a=Math.abs(x),s=x<0?'-':'';if(a>=1_000_000)return`${s}$${(a/1_000_000).toFixed(1).replace(/\.0$/,'')}M`;if(a>=1_000)return`${s}$${(a/1_000).toFixed(1).replace(/\.0$/,'')}K`;return`${s}$${Math.round(a)}`};
const pct=n=>`${num(n).toFixed(1)}%`;
const route=()=>String(location.hash||'#dashboard').slice(1).split('?')[0];
const isoDay=v=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch{return''}};

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[],accounts:[],companies:[]}}}
function defaults(){return{company:'ALL',period:'ALL',from:'',to:'',instrument:'ALL',direction:'ALL',strategy:'ALL'}}
function loadFilters(){try{return{...defaults(),...JSON.parse(localStorage.getItem(FILTER_KEY)||'{}')}}catch{return defaults()}}
function saveFilters(f){try{localStorage.setItem(FILTER_KEY,JSON.stringify(f))}catch{}}
function currentAccount(a){return !!a&&CURRENT_STATUSES.has(a.status)}
function accountMap(state){return Object.fromEntries((state.accounts||[]).map(a=>[a.id,a]))}
function entryTs(t){return t.actualEntryAt||(t.events||[]).find(e=>e.type==='INITIAL')?.actualTimestamp||(t.events||[]).find(e=>e.type==='INITIAL')?.timestamp||null}
function exitTs(t){const ev=[...(t.events||[])].reverse().find(e=>e.type==='CLOSE');return t.actualExitAt||ev?.actualTimestamp||ev?.timestamp||t.closedAt||t.createdAt||`${t.date||'1970-01-01'}T12:00:00Z`}
function strategyOf(t){return String(t.strategy||t.setup||t.review?.strategy||t.review?.setup||'Unspecified')}

function allocationUnits(t,state,companyId='ALL'){
  const amap=accountMap(state),out=[];
  for(const al of t.allocations||[]){
    const mult=Math.max(0,num(al.quantityMultiplier||1))||1;
    const ids=Array.isArray(al.accountIds)?al.accountIds.filter(Boolean):[];
    if(ids.length){
      for(const id of ids){
        const a=amap[id];if(!currentAccount(a))continue;
        const cid=a.companyId||al.companyId||'';if(companyId!=='ALL'&&cid!==companyId)continue;
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
function rowOf(t,state,companyId='ALL'){
  const units=allocationUnits(t,state,companyId);if(!units.length)return null;
  let r;try{r=replayTrade(t)}catch{return null}
  const factor=units.reduce((s,u)=>s+u.mult,0),entry=entryTs(t),exit=exitTs(t),date=t.date||isoDay(exit),master=num(r.realizedPerAccount),duration=entry&&exit?Math.max(0,(new Date(exit)-new Date(entry))/60000):null;
  return{t,r,units,factor,p:master,fin:master*factor,gross:num(r.grossRealizedPerAccount)*factor,fees:num(r.commissionPerAccount)*factor,date,entry,exit,duration,strategy:strategyOf(t)};
}
function allRows(state,companyId='ALL'){return(state.trades||[]).filter(t=>t.status==='Closed').map(t=>rowOf(t,state,companyId)).filter(Boolean).sort((a,b)=>new Date(a.exit)-new Date(b.exit))}
function periodBounds(f){const now=new Date(),today=isoDay(now);if(f.period==='CUSTOM')return{from:f.from||'',to:f.to||''};if(f.period==='ALL')return{from:'',to:''};let start=new Date();if(f.period==='7D')start.setDate(start.getDate()-6);else if(f.period==='30D')start.setDate(start.getDate()-29);else if(f.period==='90D')start.setDate(start.getDate()-89);else if(f.period==='YTD')start=new Date(Date.UTC(now.getUTCFullYear(),0,1));return{from:isoDay(start),to:today}}
function applyFilters(rows,f){const b=periodBounds(f);return rows.filter(x=>(!b.from||x.date>=b.from)&&(!b.to||x.date<=b.to)&&(f.instrument==='ALL'||x.t.instrument===f.instrument)&&(f.direction==='ALL'||x.t.direction===f.direction)&&(f.strategy==='ALL'||x.strategy===f.strategy))}

function accountNet(accountId,state){let total=0;for(const t of state.trades||[]){if(t.status!=='Closed')continue;let r;try{r=replayTrade(t)}catch{continue}for(const al of t.allocations||[]){if((al.accountIds||[]).includes(accountId))total+=num(r.realizedPerAccount)*(num(al.quantityMultiplier||1)||1)}}return total}
function adjustmentTotal(a){return(a.balanceAdjustments||[]).reduce((s,x)=>s+num(x.amount),0)}
function accountBalance(a,state){const opening=num(a.openingBalance)>0?num(a.openingBalance):num(a.sizeK)*1000;return opening+accountNet(a.id,state)+adjustmentTotal(a)}
function currentCapital(state,companyId){return(state.accounts||[]).filter(a=>currentAccount(a)&&(companyId==='ALL'||a.companyId===companyId)).reduce((s,a)=>s+accountBalance(a,state),0)}

function stats(rows){
  const wins=rows.filter(x=>x.p>0),losses=rows.filter(x=>x.p<0),gp=wins.reduce((s,x)=>s+x.p,0),gl=Math.abs(losses.reduce((s,x)=>s+x.p,0));
  const net=rows.reduce((s,x)=>s+x.fin,0),gross=rows.reduce((s,x)=>s+x.gross,0),fees=rows.reduce((s,x)=>s+x.fees,0),aw=wins.length?gp/wins.length:0,al=losses.length?gl/losses.length:0,pf=gl?gp/gl:(gp?Infinity:0);
  let equity=0,peak=0,maxDD=0;const points=[{v:0,date:''}];for(const x of rows){equity+=x.fin;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);points.push({v:equity,date:x.date})}
  const durations=rows.map(x=>x.duration).filter(Number.isFinite),avgDuration=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null;
  return{n:rows.length,w:wins.length,l:losses.length,be:rows.length-wins.length-losses.length,net,gross,fees,wr:(wins.length+losses.length)?wins.length/(wins.length+losses.length)*100:0,gp,gl,pf,exp:rows.length?rows.reduce((s,x)=>s+x.p,0)/rows.length:0,aw,al,maxDD,points,avgDuration};
}
function fmtDuration(m){if(!Number.isFinite(m))return'—';const h=Math.floor(m/60),min=Math.round(m%60);return h?`${h}h ${min}m`:`${min}m`}
function kpi(label,value,sub='',tone=''){return`<div class="an40-kpi ${tone}"><small>${esc(label)}</small><b>${value}</b>${sub?`<em>${esc(sub)}</em>`:''}</div>`}

function equitySvg(points){
  if(points.length<2)return'<div class="an40-empty">Not enough closed trades yet.</div>';
  const W=760,H=210,L=48,R=12,T=18,B=30,vals=points.map(x=>x.v),lo=Math.min(0,...vals),hi=Math.max(0,...vals),span=hi-lo||1,px=i=>L+(W-L-R)*i/Math.max(1,points.length-1),py=v=>T+(H-T-B)*(1-(v-lo)/span);
  const path=points.map((p,i)=>`${i?'L':'M'}${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' '),area=`M${px(0)},${H-B} ${points.map((p,i)=>`L${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ')} L${px(points.length-1)},${H-B} Z`;
  const ticks=4,grid=Array.from({length:ticks+1},(_,i)=>{const v=lo+(span*i/ticks),y=py(v);return`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="an47-grid"/><text x="${L-6}" y="${y+3}" text-anchor="end" class="an47-axis">${compactMoney(v)}</text>`}).join('');
  const labels=[];for(let i=1;i<points.length;i++){if(i===1||i===points.length-1||i%Math.max(1,Math.floor((points.length-1)/5))===0){labels.push(`<text x="${px(i)}" y="${H-8}" text-anchor="middle" class="an47-axis">${esc(points[i].date?.slice(5)||'')}</text>`)}}
  return`<svg class="an40-line-svg an47-equity-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="an40eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#16a765" stop-opacity=".28"/><stop offset="100%" stop-color="#16a765" stop-opacity="0"/></linearGradient></defs>${grid}<path class="fill" d="${area}"/><path class="line" d="${path}"/>${labels.join('')}</svg>`
}
function aggregate(rows,keyFn,valueFn=x=>x.fin){const m=new Map();for(const x of rows){const k=keyFn(x);if(!k)continue;if(!m.has(k))m.set(k,{key:k,n:0,w:0,p:0,gp:0,gl:0});const z=m.get(k),master=x.p,value=valueFn(x);z.n++;z.p+=value;if(master>0){z.w++;z.gp+=master}else if(master<0)z.gl+=Math.abs(master)}return[...m.values()].map(z=>({...z,wr:z.n?z.w/z.n*100:0,pf:z.gl?z.gp/z.gl:(z.gp?Infinity:0),exp:z.n?z.p/z.n:0}))}
function monthName(key){const [y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)))}
function monthlyPerformanceSvg(rows,f){
  if(!rows.length)return'<div class="an40-empty">No monthly data.</div>';
  let month='';if(f.period==='CUSTOM'&&f.from&&f.to&&f.from.slice(0,7)===f.to.slice(0,7))month=f.from.slice(0,7);if(!month)month=[...rows].sort((a,b)=>b.date.localeCompare(a.date))[0].date.slice(0,7);
  const [yy,mm]=month.split('-').map(Number),days=new Date(Date.UTC(yy,mm,0)).getUTCDate(),map=new Map(aggregate(rows.filter(x=>x.date.startsWith(month)),x=>x.date).map(x=>[x.key,x.p]));
  const data=Array.from({length:days},(_,i)=>({day:i+1,key:`${month}-${String(i+1).padStart(2,'0')}`,p:num(map.get(`${month}-${String(i+1).padStart(2,'0')}`))}));
  const vals=data.map(x=>x.p),rawLo=Math.min(0,...vals),rawHi=Math.max(0,...vals),padV=Math.max(1,(rawHi-rawLo)*.16),lo=rawLo<0?rawLo-padV:0,hi=rawHi>0?rawHi+padV:0,span=hi-lo||1;
  const W=760,H=210,L=52,R=12,T=20,B=31,plotW=W-L-R,slot=plotW/days,bw=Math.max(3,Math.min(15,slot*.64)),py=v=>T+(H-T-B)*(1-(v-lo)/span),zero=py(0);
  const ticks=4,grid=Array.from({length:ticks+1},(_,i)=>{const v=lo+(span*i/ticks),y=py(v);return`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="an47-grid"/><text x="${L-6}" y="${y+3}" text-anchor="end" class="an47-axis">${compactMoney(v)}</text>`}).join('');
  const bars=data.map((d,i)=>{const x=L+slot*i+(slot-bw)/2,y=py(d.p),h=Math.max(d.p?2:0,Math.abs(zero-y)),top=d.p>=0?y:zero,labelY=d.p>=0?Math.max(T+8,y-4):Math.min(H-B-2,y+12),cls=d.p>=0?'pos':'neg',label=d.p?compactMoney(d.p):'';return`<g><rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="an47-bar ${cls}"><title>${d.key} · ${money(d.p)}</title></rect>${d.p?`<text x="${(x+bw/2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="an47-value ${cls}">${esc(label)}</text>`:''}</g>`}).join('');
  const marks=[1,5,10,15,20,25,days].filter((v,i,a)=>v<=days&&a.indexOf(v)===i),labels=marks.map(day=>{const x=L+slot*(day-1)+slot/2;return`<text x="${x.toFixed(1)}" y="${H-8}" text-anchor="middle" class="an47-axis">${monthName(month).split(' ')[0]} ${day}</text>`}).join('');
  return`<div class="an47-monthly" data-month="${month}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily P&L for ${monthName(month)}">${grid}<line x1="${L}" x2="${W-R}" y1="${zero}" y2="${zero}" class="an47-zero"/>${bars}${labels}</svg><div class="an47-month-caption">${monthName(month)} · amounts shown on each trading day</div></div>`;
}
function comboSvg(rows){
  const d=aggregate(rows,x=>x.date,()=>1).slice(-10);if(d.length<2)return'<div class="an40-empty">Need at least two trading days.</div>';
  const W=720,H=190,L=35,R=25,T=18,B=28,maxPf=Math.max(2,...d.map(x=>Number.isFinite(x.pf)?x.pf:2)),px=i=>L+(W-L-R)*i/(d.length-1),yPct=v=>T+(H-T-B)*(1-v/100),yPf=v=>T+(H-T-B)*(1-Math.min(v,maxPf)/maxPf),wr=d.map((z,i)=>`${i?'L':'M'}${px(i)},${yPct(z.wr)}`).join(' '),pf=d.map((z,i)=>`${i?'L':'M'}${px(i)},${yPf(Number.isFinite(z.pf)?z.pf:maxPf)}`).join(' ');
  const labels=d.map((z,i)=>`<text x="${px(i)}" y="${H-7}" text-anchor="middle" class="an47-axis">${esc(z.key.slice(5))}</text>`).join('');
  return`<svg class="an40-combo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="wr" d="${wr}"/><path class="pf" d="${pf}"/>${d.map((z,i)=>`<circle class="wr-dot" cx="${px(i)}" cy="${yPct(z.wr)}" r="3"><title>${z.key} · Win ${pct(z.wr)}</title></circle><circle class="pf-dot" cx="${px(i)}" cy="${yPf(Number.isFinite(z.pf)?z.pf:maxPf)}" r="3"><title>${z.key} · PF ${Number.isFinite(z.pf)?z.pf.toFixed(2):'∞'}</title></circle>`).join('')}${labels}</svg><div class="an40-legend"><span><i class="blue"></i>Win Rate</span><span><i class="green"></i>Profit Factor</span></div>`
}
const COLORS=['#2563eb','#16a765','#f59f00','#f76707','#7950f2','#0ca678','#e8590c','#5c7cfa'];
function donut(title,data,total){const sorted=[...data].sort((a,b)=>b.n-a.n).slice(0,6),sum=sorted.reduce((s,x)=>s+x.n,0)||1;let cur=0;const stops=[];sorted.forEach((x,i)=>{const start=cur,end=cur+x.n/sum*360;stops.push(`${COLORS[i%COLORS.length]} ${start}deg ${end}deg`);cur=end});return`<section class="an40-card an40-breakdown"><h3>${esc(title)}</h3><div class="an40-donut-wrap"><div class="an40-donut" style="background:conic-gradient(${stops.join(',')||'#e9eef5 0 360deg'})"><div><b>${total}</b><small>Trades</small></div></div><div class="an40-donut-legend">${sorted.map((x,i)=>`<span><i style="background:${COLORS[i%COLORS.length]}"></i><b>${esc(x.key)}</b><em>${Math.round(x.n/sum*100)}%</em></span>`).join('')||'<span>No data</span>'}</div></div></section>`}
function dailyTable(rows){const d=aggregate(rows,x=>x.date).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,7);return`<section class="an40-card"><div class="an40-card-head"><h3>Daily Performance</h3></div><div class="an40-table-wrap"><table><thead><tr><th>Date</th><th>Trades</th><th>Net P&L</th><th>Win Rate</th></tr></thead><tbody>${d.map(x=>`<tr><td>${esc(x.key)}</td><td>${x.n}</td><td class="${x.p>=0?'pos':'neg'}">${money(x.p)}</td><td>${pct(x.wr)}</td></tr>`).join('')||'<tr><td colspan="4">No data</td></tr>'}</tbody></table></div></section>`}
function tradeRows(rows){return`<table><thead><tr><th>Trade ID</th><th>Instrument</th><th>Net P&L</th><th>Date</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.t.id)}</td><td>${esc(x.t.instrument||'—')}</td><td class="${x.fin>=0?'pos':'neg'}">${money(x.fin)}</td><td>${esc(x.date)}</td></tr>`).join('')||'<tr><td colspan="4">No data</td></tr>'}</tbody></table>`}
function tradesTable(rows){const best=[...rows].sort((a,b)=>b.fin-a.fin).slice(0,5),worst=[...rows].sort((a,b)=>a.fin-b.fin).slice(0,5);return`<section class="an40-card"><div class="an40-card-head"><h3>Best & Worst Trades</h3><div class="an40-tabs"><button class="active" data-an40-tab="best">Best</button><button data-an40-tab="worst">Worst</button></div></div><div class="an40-trade-table" data-an40-best>${tradeRows(best)}</div><div class="an40-trade-table hidden" data-an40-worst>${tradeRows(worst)}</div></section>`}
function nyParts(iso){if(!iso)return null;try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hour12:false}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return{day:p.weekday,h:+p.hour}}catch{return null}}
function session(h){return h<9?'Pre-market':h<10?'NY Open':h<12?'AM':h<16?'PM':'After-hours'}
function timingPanel(rows){const timed=rows.map(x=>({...x,ny:nyParts(x.entry)})).filter(x=>x.ny),day=aggregate(timed,x=>x.ny.day,x=>x.p),hour=aggregate(timed,x=>String(x.ny.h).padStart(2,'0')+':00',x=>x.p),sess=aggregate(timed,x=>session(x.ny.h),x=>x.p),best=a=>[...a].filter(x=>x.n>=2).sort((x,y)=>y.exp-x.exp)[0],bd=best(day),bh=best(hour),bs=best(sess);return`<section class="an40-card an40-timing"><h3>Timing Edge</h3><div>${kpi('Best Day (NY)',bd?.key||'Need more data',bd?`${money(bd.exp)} expectancy · ${bd.n} trades`:'')}${kpi('Best Hour (NY)',bh?.key||'Need more data',bh?`${money(bh.exp)} expectancy · ${bh.n} trades`:'')}${kpi('Best Session',bs?.key||'Need more data',bs?`${money(bs.exp)} expectancy · ${bs.n} trades`:'')}</div></section>`}
function edgePanel(rows,m){const largest=m.gp?Math.max(0,...rows.filter(x=>x.p>0).map(x=>x.p))/m.gp*100:0;let score=0;score+=Math.min(25,m.n/50*25);score+=Math.max(0,Math.min(25,((Number.isFinite(m.pf)?m.pf:3)-1)/1.5*25));score+=m.exp>0?20:0;score+=20*(1-Math.min(1,largest/70));score+=10*(1-Math.min(1,m.maxDD/Math.max(1,Math.abs(m.net)+m.maxDD)));score=Math.round(score);return`<section class="an40-card an40-edge"><div><h3>Edge Evidence</h3><p>Behavioral evidence from master trades; financial P&L uses current account allocations.</p></div><div class="an40-edge-score"><b>${score}</b><span>/100</span></div><div class="an40-edge-facts"><span>Sample <b>${m.n}</b></span><span>Profit Factor <b>${Number.isFinite(m.pf)?m.pf.toFixed(2):'∞'}</b></span><span>Expectancy <b>${money(m.exp)}</b></span><span>Largest-win concentration <b>${pct(largest)}</b></span></div></section>`}
function unverified(rows){const n=rows.filter(x=>!x.entry).length;return n?`<div class="an40-alert">${n} closed trade${n===1?'':'s'} have no verified entry time. Timing analytics exclude them.</div>`:''}

function renderHtml(state,f){
  const all=allRows(state,'ALL'),scoped=allRows(state,f.company),rows=applyFilters(scoped,f),m=stats(rows),capital=currentCapital(state,f.company),inst=aggregate(rows,x=>x.t.instrument||'Unknown',()=>1),strategies=aggregate(rows,x=>x.strategy,()=>1),companies=(state.companies||[]).filter(c=>(state.accounts||[]).some(a=>currentAccount(a)&&a.companyId===c.id)),instruments=[...new Set(all.map(x=>x.t.instrument).filter(Boolean))].sort(),strategyList=[...new Set(all.map(x=>x.strategy).filter(Boolean))].sort(),bounds=periodBounds(f);
  return`<section class="an40-page" data-analytics-v40><div class="an40-head"><h1>Advanced Analytics</h1><span>${rows.length}/${scoped.length} current-scope closed trades</span></div><div class="an40-filters"><label>Scope<select data-an40-filter="company"><option value="ALL">All Current Accounts</option>${companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label>Period<select data-an40-filter="period"><option value="ALL">All Time</option><option value="7D">7 Days</option><option value="30D">30 Days</option><option value="90D">90 Days</option><option value="YTD">YTD</option><option value="CUSTOM">Custom Range</option></select></label><label>From<input type="date" data-an40-filter="from" value="${esc(f.period==='CUSTOM'?f.from:bounds.from)}" ${f.period==='CUSTOM'?'':'disabled'}></label><label>To<input type="date" data-an40-filter="to" value="${esc(f.period==='CUSTOM'?f.to:bounds.to)}" ${f.period==='CUSTOM'?'':'disabled'}></label><label>Instrument<select data-an40-filter="instrument"><option value="ALL">All</option>${instruments.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label><label>Direction<select data-an40-filter="direction"><option value="ALL">All</option><option>LONG</option><option>SHORT</option></select></label><label>Strategy<select data-an40-filter="strategy"><option value="ALL">All</option>${strategyList.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label><button type="button" data-an40-reset>Reset</button></div>${unverified(rows)}<div class="an40-kpis">${kpi('Net P&L',money(m.net),`Current Capital ${money(capital)}`,m.net>=0?'good':'bad')}${kpi('Total Trades',String(m.n),'Closed master trades')}${kpi('Win Rate',pct(m.wr),`${m.w}W / ${m.l}L / ${m.be} BE`,m.wr>=50?'good':'')}${kpi('Profit Factor',Number.isFinite(m.pf)?m.pf.toFixed(2):'∞','Master-trade basis',m.pf>=1?'good':'bad')}${kpi('Expectancy',money(m.exp),'Per master trade',m.exp>=0?'good':'bad')}${kpi('Max Drawdown',money(m.maxDD),'Current-account equity','bad')}${kpi('Avg Win',money(m.aw),'Master winning trades','good')}${kpi('Avg Loss',money(m.al),'Master losing trades','bad')}${kpi('Avg Duration',fmtDuration(m.avgDuration),'Verified timestamps')}</div><div class="an40-chart-row"><section class="an40-card an40-equity"><div class="an40-card-head"><h3>Equity Curve</h3><span>${money(m.net)}</span></div>${equitySvg(m.points)}</section><section class="an40-card an47-month-card"><div class="an40-card-head"><h3>Monthly Performance</h3></div>${monthlyPerformanceSvg(rows,f)}</section><section class="an40-card"><div class="an40-card-head"><h3>Win Rate & Profit Factor</h3></div>${comboSvg(rows)}</section></div><div class="an40-detail-row">${donut('Instrument Breakdown',inst,m.n)}${donut('Strategy Breakdown',strategies,m.n)}${dailyTable(rows)}${tradesTable(rows)}</div><div class="an40-bottom-row">${edgePanel(rows,m)}${timingPanel(rows)}</div></section>`;
}
function bind(root,state,f){root.querySelectorAll('select[data-an40-filter]').forEach(el=>{const key=el.dataset.an40Filter;if(key in f)el.value=f[key];el.onchange=()=>{const n={...f,[key]:el.value};if(key==='period'&&el.value!=='CUSTOM'){n.from='';n.to=''}saveFilters(n);lastSignature='';render()}});root.querySelectorAll('input[data-an40-filter]').forEach(el=>{const key=el.dataset.an40Filter;el.onchange=()=>{const n={...f,[key]:el.value,period:'CUSTOM'};saveFilters(n);lastSignature='';render()}});root.querySelector('[data-an40-reset]')?.addEventListener('click',()=>{saveFilters(defaults());lastSignature='';render()});root.querySelectorAll('[data-an40-tab]').forEach(btn=>btn.onclick=()=>{root.querySelectorAll('[data-an40-tab]').forEach(x=>x.classList.toggle('active',x===btn));root.querySelector('[data-an40-best]')?.classList.toggle('hidden',btn.dataset.an40Tab!=='best');root.querySelector('[data-an40-worst]')?.classList.toggle('hidden',btn.dataset.an40Tab!=='worst')})}
function render(){if(route()!=='analytics'){document.querySelectorAll('.page.an40-mounted').forEach(p=>p.classList.remove('an40-mounted'));return}const host=document.querySelector('#app .page');if(!host)return;const state=loadState(),f=loadFilters(),sig=`${state.meta?.updatedAt||''}|${JSON.stringify(f)}`;let root=host.querySelector('[data-analytics-v40]');if(root&&lastSignature===sig)return;host.classList.add('an40-mounted');const wrap=document.createElement('div');wrap.innerHTML=renderHtml(state,f);const fresh=wrap.firstElementChild;if(root)root.replaceWith(fresh);else host.appendChild(fresh);lastSignature=sig;bind(fresh,state,f)}
function schedule(){clearTimeout(renderTimer);renderTimer=setTimeout(render,70)}
window.addEventListener('load',schedule);window.addEventListener('hashchange',()=>{lastSignature='';schedule()});window.addEventListener('storage',e=>{if(e.key===STATE_KEY){lastSignature='';schedule()}});new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});schedule();
window.TradingOSAnalyticsV40={render,ready:true};
