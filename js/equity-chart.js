import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const FILTER_KEY='trading-os-analytics-filter-v3';

const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
const compactMoney=n=>{
  const x=Number(n||0),a=Math.abs(x),sg=x<0?'-':'';
  if(a>=1_000_000)return `${sg}$${(a/1_000_000).toFixed(a>=10_000_000?0:1).replace(/\.0$/,'')}M`;
  if(a>=1_000)return `${sg}$${(a/1_000).toFixed(a>=100_000?0:1).replace(/\.0$/,'')}K`;
  return `${sg}$${Math.round(a)}`;
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}}
function loadFilters(){try{return{range:'ALL',instrument:'ALL',direction:'ALL',company:'ALL',stage:'ALL',...JSON.parse(localStorage.getItem(FILTER_KEY)||'{}')}}catch{return{range:'ALL',instrument:'ALL',direction:'ALL',company:'ALL',stage:'ALL'}}}
function closeTs(t){
  if(t.actualExitAt)return t.actualExitAt;
  const ev=[...(t.events||[])].reverse().find(e=>e.type==='CLOSE');
  return ev?.actualTimestamp||ev?.timestamp||t.closedAt||t.createdAt||`${t.date}T12:00:00Z`;
}
function tradeDate(t){
  if(t.date)return `${t.date}T12:00:00Z`;
  return closeTs(t);
}
function rows(state){
  return (state.trades||[]).filter(t=>t.status==='Closed').map(t=>({
    t,
    p:Number(replayTrade(t).realizedPerAccount||0),
    ct:closeTs(t),
    dt:tradeDate(t)
  })).sort((a,b)=>new Date(a.ct)-new Date(b.ct));
}
function apply(a,f){
  const d=f.range==='7D'?7:f.range==='30D'?30:f.range==='90D'?90:0,cut=Date.now()-d*864e5;
  return a.filter(x=>(!d||+new Date(x.ct)>=cut)
    &&(f.instrument==='ALL'||x.t.instrument===f.instrument)
    &&(f.direction==='ALL'||x.t.direction===f.direction)
    &&(f.company==='ALL'||(x.t.allocations||[]).some(z=>z.companyId===f.company))
    &&(f.stage==='ALL'||(x.t.allocations||[]).some(z=>z.stage===f.stage)));
}
function niceStep(range,target=5){
  if(!Number.isFinite(range)||range<=0)return 1;
  const raw=range/Math.max(1,target),mag=10**Math.floor(Math.log10(raw)),n=raw/mag;
  const nice=n<=1?1:n<=2?2:n<=5?5:10;
  return nice*mag;
}
function yTicks(values,count=5){
  let lo=Math.min(0,...values),hi=Math.max(0,...values);
  if(lo===hi){lo-=1;hi+=1}
  const step=niceStep(hi-lo,count-1);
  lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;
  const out=[];for(let v=lo;v<=hi+step*.2;v+=step)out.push(+v.toFixed(10));
  return out.length>7?out.filter((_,i)=>i%2===0):out;
}
function formatDate(ts,spanDays){
  const d=new Date(ts);
  if(spanDays<=21)return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(d);
  if(spanDays<=120)return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(d);
  if(spanDays<=730)return new Intl.DateTimeFormat('en-US',{month:'short',year:'2-digit',timeZone:'UTC'}).format(d);
  return new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'UTC'}).format(d);
}
function dateTicks(minT,maxT,maxLabels=6){
  if(!Number.isFinite(minT)||!Number.isFinite(maxT))return[];
  if(minT===maxT)return[minT];
  const spanDays=(maxT-minT)/864e5;
  const n=Math.max(2,Math.min(maxLabels,Math.ceil(spanDays<=21?spanDays+1:spanDays<=120?5:spanDays<=730?6:5)));
  return Array.from({length:n},(_,i)=>minT+(maxT-minT)*(i/(n-1)));
}
function chartData(filtered){
  let eq=0;
  const pts=[{ts:filtered.length?+new Date(filtered[0].dt):Date.now(),value:0,label:'Start'}];
  for(const x of filtered){eq+=x.p;pts.push({ts:+new Date(x.dt),value:eq,label:x.t.id||'Trade',trade:x});}
  return pts;
}
function makeChart(filtered){
  if(!filtered.length)return '<div class="eq-empty">لا توجد صفقات مغلقة ضمن الفلاتر الحالية.</div>';
  const pts=chartData(filtered),vals=pts.map(x=>x.value);
  let minT=Math.min(...pts.map(x=>x.ts)),maxT=Math.max(...pts.map(x=>x.ts));
  if(minT===maxT){minT-=12*3600e3;maxT+=12*3600e3}
  const yt=yTicks(vals,5),yMin=Math.min(...yt),yMax=Math.max(...yt),ySpan=yMax-yMin||1;
  const spanDays=(maxT-minT)/864e5,xt=dateTicks(minT,maxT,spanDays<=21?7:6);
  const W=1000,H=320,L=28,R=105,T=20,B=52;
  const x=t=>L+(W-L-R)*((t-minT)/(maxT-minT||1));
  const y=v=>T+(H-T-B)*(1-(v-yMin)/ySpan);
  const path=pts.map((p,i)=>`${i?'L':'M'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area=`M${x(pts[0].ts).toFixed(1)},${y(0).toFixed(1)} ${pts.map(p=>`L${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} L${x(pts.at(-1).ts).toFixed(1)},${y(0).toFixed(1)} Z`;
  const grid=yt.map(v=>`<g><line class="eq-grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="eq-y-label" x="${W-R+14}" y="${y(v)+5}">${compactMoney(v)}</text></g>`).join('');
  const xlabels=xt.map(t=>`<g><line class="eq-x-tick" x1="${x(t)}" x2="${x(t)}" y1="${H-B}" y2="${H-B+6}"/><text class="eq-x-label" x="${x(t)}" y="${H-17}">${esc(formatDate(t,spanDays))}</text></g>`).join('');
  const zero=(yMin<0&&yMax>0)?`<line class="eq-zero" x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}"/>`:'';
  const circles=pts.slice(1).map(p=>{
    const dt=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(p.ts));
    return `<circle class="eq-point" cx="${x(p.ts)}" cy="${y(p.value)}" r="5" tabindex="0"><title>${esc(dt)} · ${esc(p.label)} · ${money(p.value)}</title></circle>`;
  }).join('');
  return `<div class="eq-chart-wrap" dir="ltr"><svg class="eq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity curve with adaptive axes"><defs><linearGradient id="eqArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5aa9ff" stop-opacity=".18"/><stop offset="100%" stop-color="#5aa9ff" stop-opacity="0"/></linearGradient></defs>${grid}${zero}<path class="eq-area" d="${area}"/><path class="eq-line" d="${path}"/>${circles}<line class="eq-axis" x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}"/>${xlabels}</svg></div>`;
}
function signature(filtered){return filtered.map(x=>`${x.t.id}:${x.p}:${x.t.date}:${x.ct}`).join('|')+'|'+JSON.stringify(loadFilters())}
let lastSig='';
function render(){
  if((location.hash||'#dashboard').slice(1).split('?')[0]!=='analytics')return;
  const cards=[...document.querySelectorAll('.an-page .an-card')];
  const card=cards.find(c=>c.querySelector('h3')?.textContent.trim()==='Equity Curve');
  if(!card)return;
  const filtered=apply(rows(loadState()),loadFilters()),sig=signature(filtered);
  if(sig===lastSig&&card.querySelector('.eq-chart-wrap,.eq-empty'))return;
  lastSig=sig;
  const old=card.querySelector('.an-svg,.eq-chart-wrap,.eq-empty');
  const holder=document.createElement('div');holder.innerHTML=makeChart(filtered);
  if(old)old.replaceWith(holder.firstElementChild);else{
    const mini=card.querySelector('.an-mini');
    card.insertBefore(holder.firstElementChild,mini||null);
  }
}
let timer;const schedule=()=>{clearTimeout(timer);timer=setTimeout(render,80)};
window.addEventListener('load',schedule);window.addEventListener('hashchange',()=>{lastSig='';schedule()});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
