import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const MONTHS={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const compact=n=>{const x=Number(n||0),a=Math.abs(x),s=x<0?'-':'';if(a>=1_000_000)return`${s}$${(a/1_000_000).toFixed(1).replace(/\.0$/,'')}M`;if(a>=1_000)return`${s}$${(a/1_000).toFixed(1).replace(/\.0$/,'')}K`;return`${s}$${Math.round(a)}`};
const pad=n=>String(n).padStart(2,'0');
const keyUTC=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
function state(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}}
function route(){return(location.hash||'#dashboard').slice(1).split('?')[0]}
function parseMonth(text){const [m,y]=String(text||'').trim().split(/\s+/);return Number.isFinite(Number(y))&&m in MONTHS?{y:Number(y),m:MONTHS[m]}:null}
function factor(t,s,companyId){
  const amap=Object.fromEntries((s.accounts||[]).map(a=>[a.id,a]));
  let total=0;
  for(const al of t.allocations||[]){
    const mult=Math.max(0,Number(al.quantityMultiplier||1))||1;
    const ids=Array.isArray(al.accountIds)?al.accountIds.filter(Boolean):[];
    if(ids.length){
      for(const id of ids){const a=amap[id];const cid=a?.companyId||al.companyId;if(companyId==='ALL'||cid===companyId)total+=mult}
    }else if(companyId==='ALL'||al.companyId===companyId){total+=Math.max(0,Number(al.accountCount||0))*mult}
  }
  return total;
}
function dayMap(s,companyId){
  const map=new Map();
  for(const t of s.trades||[]){
    if(t.status!=='Closed'||!t.date)continue;
    const f=factor(t,s,companyId);if(!f)continue;
    let r;try{r=replayTrade(t)}catch{continue}
    const net=Number(r.realizedPerAccount||0)*f;
    if(!map.has(t.date))map.set(t.date,{pnl:0,n:0});
    const v=map.get(t.date);v.pnl+=net;v.n++;
  }
  return map;
}
function buildGrid(y,m,map){
  const first=new Date(Date.UTC(y,m,1)),start=new Date(first);start.setUTCDate(1-first.getUTCDay());
  const cells=[];
  for(let w=0;w<6;w++){
    let wpnl=0,wn=0;
    for(let d=0;d<6;d++){
      const dt=new Date(start);dt.setUTCDate(start.getUTCDate()+w*7+d);
      const k=keyUTC(dt),v=map.get(k)||{pnl:0,n:0};wpnl+=v.pnl;wn+=v.n;
      const outside=dt.getUTCMonth()!==m,cls=v.n?(v.pnl>0?'win':v.pnl<0?'loss':'flat'):'';
      cells.push(`<button type="button" class="dv2-day ${outside?'outside':''} ${cls}" data-dv2-date="${k}" title="${v.n?`${money(v.pnl)} · ${v.n} trade${v.n===1?'':'s'}`:'No trades'}"><span>${dt.getUTCDate()}</span>${v.n?`<b>${v.pnl>0?'+':''}${compact(v.pnl).replace('$','')}</b>`:''}</button>`);
    }
    const wc=wn?(wpnl>0?'win':wpnl<0?'loss':'flat'):'';
    cells.push(`<div class="dv2-week-total ${wc}" title="Weekly Net P&L"><b>${wn?`${wpnl>0?'+':''}${compact(wpnl)}`:'—'}</b><span>${wn} ${wn===1?'trade':'trades'}</span></div>`);
  }
  return cells.join('');
}
function apply(){
  if(route()!=='dashboard')return;
  const root=document.querySelector('[data-dashboard-v2]');if(!root)return;
  const cal=root.querySelector('.dv2-calendar'),title=cal?.querySelector('.dv2-month-nav b');if(!cal||!title)return;
  const ym=parseMonth(title.textContent);if(!ym)return;
  const s=state(),companyId=root.querySelector('[data-dv2-company]')?.value||'ALL';
  const sig=`${s.meta?.updatedAt||''}|${companyId}|${ym.y}-${ym.m}`;
  if(cal.dataset.v37sig===sig)return;
  cal.dataset.v37sig=sig;
  const sub=cal.querySelector('.dv2-panel-head p');if(sub)sub.textContent='Sun 18:00 NY open · Mon–Fri · Saturday excluded';
  const wd=cal.querySelector('.dv2-weekdays');if(wd)wd.innerHTML=['Sun*','Mon','Tue','Wed','Thu','Fri','Weekly'].map(x=>`<span>${x}</span>`).join('');
  const days=cal.querySelector('.dv2-days');if(days){days.innerHTML=buildGrid(ym.y,ym.m,dayMap(s,companyId));days.querySelectorAll('[data-dv2-date]').forEach(b=>b.onclick=()=>window.dispatchEvent(new CustomEvent('trading-os-open-closed-day',{detail:{date:b.dataset.dv2Date}})))}
}
let timer;function schedule(){clearTimeout(timer);timer=setTimeout(apply,40)}
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('storage',schedule);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
