import { replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
let view=new Date();
view=new Date(Date.UTC(view.getUTCFullYear(),view.getUTCMonth(),1));

const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const pad=n=>String(n).padStart(2,'0');
const keyUTC=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const monthName=d=>new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);

function loadState(){
  try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}
}
function dailyData(state){
  const map=new Map();
  for(const t of state.trades||[]){
    if(t.status!=='Closed')continue;
    const k=t.date;
    if(!k)continue;
    if(!map.has(k))map.set(k,{pnl:0,trades:0});
    const x=map.get(k),r=replayTrade(t);
    x.pnl+=Number(r.portfolioRealized||0);
    x.trades+=1;
  }
  return map;
}
function calendarDates(y,m){
  const first=new Date(Date.UTC(y,m,1));
  const start=new Date(first);
  start.setUTCDate(1-first.getUTCDay());
  return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);return d});
}
function weekly(dates,map){
  return Array.from({length:6},(_,r)=>{
    let pnl=0,trades=0;
    for(let c=0;c<7;c++){
      const x=map.get(keyUTC(dates[r*7+c]));
      if(x){pnl+=x.pnl;trades+=x.trades}
    }
    return{pnl,trades};
  });
}
function dayCell(d,currentMonth,map){
  const k=keyUTC(d),x=map.get(k)||{pnl:0,trades:0},outside=d.getUTCMonth()!==currentMonth;
  const now=new Date(),today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const cls=x.trades?(x.pnl>0?'win':x.pnl<0?'loss':'flat'):'';
  return `<div class="pnl-day ${outside?'outside':''} ${k===today?'today':''} ${cls}"><div class="pnl-day-num">${pad(d.getUTCDate())}</div>${x.trades?`<div class="pnl-day-pnl">${money(x.pnl)}</div><div class="pnl-day-meta">${x.trades} ${x.trades===1?'trade':'trades'}</div>`:''}</div>`;
}
function render(){
  if((location.hash||'#dashboard').slice(1).split('?')[0]!=='dashboard')return;
  const page=document.querySelector('#app .page');
  if(!page)return;
  let root=page.querySelector('.pnl-calendar-shell');
  if(!root){root=document.createElement('section');root.className='pnl-calendar-shell';page.appendChild(root)}
  const state=loadState(),map=dailyData(state),y=view.getUTCFullYear(),m=view.getUTCMonth(),dates=calendarDates(y,m),weeks=weekly(dates,map);
  root.innerHTML=`
    <div class="pnl-calendar-head">
      <div class="pnl-calendar-title"><h3>P&L Calendar</h3><p>Net Portfolio P&L · Master Trades count</p></div>
      <div class="pnl-calendar-nav"><button data-cal-prev aria-label="Previous month">‹</button><strong>${monthName(view)}</strong><button data-cal-next aria-label="Next month">›</button></div>
    </div>
    <div class="pnl-calendar-layout">
      <div class="pnl-calendar-main">
        <div class="pnl-cal-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div>${x}</div>`).join('')}</div>
        <div class="pnl-cal-grid">${dates.map(d=>dayCell(d,m,map)).join('')}</div>
      </div>
      <div class="pnl-weekly"><div class="pnl-weekly-label">Weekly</div>${weeks.map(w=>`<div class="pnl-week ${w.pnl>0?'win':w.pnl<0?'loss':''}"><b>${money(w.pnl)}</b><span>${w.trades} ${w.trades===1?'trade':'trades'}</span></div>`).join('')}</div>
    </div>`;
  root.querySelector('[data-cal-prev]').onclick=()=>{view=new Date(Date.UTC(y,m-1,1));render()};
  root.querySelector('[data-cal-next]').onclick=()=>{view=new Date(Date.UTC(y,m+1,1));render()};
}

let timer;
function schedule(){clearTimeout(timer);timer=setTimeout(render,80)}
window.addEventListener('hashchange',schedule);
window.addEventListener('load',schedule);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
