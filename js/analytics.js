import {replayTrade} from './engine.js';

const SK='trading-os-state-v1', FK='trading-os-analytics-filter-v3';
const $=s=>document.querySelector(s);
const money=n=>`${Number(n||0)<0?'-':''}$${Math.abs(Number(n||0)).toLocaleString('en-US',{maximumFractionDigits:2})}`;
const pct=n=>`${Number(n||0).toFixed(1)}%`;
const num=n=>Number.isFinite(n)?Number(n||0).toFixed(2):'∞';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const MIN_BEST_SAMPLE=3;

async function state(){
  try{const x=localStorage.getItem(SK);if(x)return JSON.parse(x)}catch{}
  try{const r=await fetch('./data/state.json?'+Date.now());if(r.ok)return r.json()}catch{}
  return{trades:[],accounts:[],companies:[]};
}

function reliableEntry(t){
  const initial=(t.events||[]).find(e=>e.type==='INITIAL');
  if(t.actualEntryAt) return {ts:t.actualEntryAt,source:t.entryTimeSource||'MANUAL'};
  if(initial?.actualTimestamp) return {ts:initial.actualTimestamp,source:initial.timeSource||'EXECUTION'};
  if(t.entryTimeVerified===true && initial?.timestamp) return {ts:initial.timestamp,source:'VERIFIED'};
  if(initial?.timeSource==='EXECUTION' && initial?.timestamp) return {ts:initial.timestamp,source:'EXECUTION'};
  if(t.recordedLive===true && initial?.timestamp) return {ts:initial.timestamp,source:'LIVE'};
  return {ts:null,source:'UNVERIFIED'};
}
function closeTs(t){return[...(t.events||[])].reverse().find(e=>e.type==='CLOSE')?.timestamp||t.closedAt||t.createdAt||`${t.date}T12:00:00Z`}
function ny(iso){
  if(!iso)return null;
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));
  return{day:p.weekday,h:+p.hour,m:+p.minute};
}
function sessionFromTs(iso){
  const x=ny(iso); if(!x)return null;
  const m=x.h*60+x.m;
  return m<570?'Pre-market':m<600?'NY Open':m<630?'10:00 Window':m<720?'AM':m<960?'PM':'After-hours';
}
function rows(s){
  return(s.trades||[]).filter(t=>t.status==='Closed').map(t=>{
    const r=replayTrade(t),entry=reliableEntry(t),n=ny(entry.ts);
    return{t,r,p:+r.realizedPerAccount||0,port:+r.portfolioRealized||0,entryTs:entry.ts,timeSource:entry.source,ct:closeTs(t),day:n?.day??null,h:n?.h??null,sess:entry.ts?sessionFromTs(entry.ts):null};
  }).sort((a,b)=>new Date(a.ct)-new Date(b.ct));
}
function filters(){try{return{range:'ALL',instrument:'ALL',direction:'ALL',company:'ALL',stage:'ALL',...JSON.parse(localStorage.getItem(FK)||'{}')}}catch{return{range:'ALL',instrument:'ALL',direction:'ALL',company:'ALL',stage:'ALL'}}}
function apply(a,f){
  const d=f.range==='7D'?7:f.range==='30D'?30:f.range==='90D'?90:0,cut=Date.now()-d*864e5;
  return a.filter(x=>(!d||+new Date(x.ct)>=cut)&&(f.instrument==='ALL'||x.t.instrument===f.instrument)&&(f.direction==='ALL'||x.t.direction===f.direction)&&(f.company==='ALL'||(x.t.allocations||[]).some(z=>z.companyId===f.company))&&(f.stage==='ALL'||(x.t.allocations||[]).some(z=>z.stage===f.stage)));
}
function acctGrowth(s,port){
  let open=0,cur=0;const m=new Map;
  (s.accounts||[]).forEach(a=>{const o=+a.openingBalance>0?+a.openingBalance:(+a.sizeK||0)*1000,adj=(a.balanceAdjustments||[]).reduce((q,z)=>q+(+z.amount||0),0);m.set(a.id,{o,p:0,a:adj});open+=o});
  (s.trades||[]).filter(t=>t.status==='Closed').forEach(t=>{const p=replayTrade(t).realizedPerAccount;(t.allocations||[]).forEach(al=>(al.accountIds||[]).forEach(id=>{if(m.has(id))m.get(id).p+=p}))});
  m.forEach(x=>cur+=x.o+x.p+x.a);return{open,cur,growth:open?port/open*100:0,balance:open?(cur-open)/open*100:0};
}
function dd(a){let e=0,pk=0,m=0,pts=[0];a.forEach(x=>{e+=x.p;pk=Math.max(pk,e);m=Math.max(m,pk-e);pts.push(e)});return{m,pts}}
function streak(a){let w=0,l=0,mw=0,ml=0;a.forEach(x=>{if(x.p>0){w++;l=0;mw=Math.max(mw,w)}else if(x.p<0){l++;w=0;ml=Math.max(ml,l)}else w=l=0});return{mw,ml}}
function M(a,s){
  const w=a.filter(x=>x.p>0),l=a.filter(x=>x.p<0),gp=w.reduce((q,x)=>q+x.p,0),gl=Math.abs(l.reduce((q,x)=>q+x.p,0)),net=a.reduce((q,x)=>q+x.p,0),port=a.reduce((q,x)=>q+x.port,0),D=dd(a),S=streak(a),aw=w.length?gp/w.length:0,al=l.length?gl/l.length:0,pf=gl?gp/gl:gp?Infinity:0,rev=a.filter(x=>x.t.review?.adherence),adh=rev.length?(rev.filter(x=>x.t.review.adherence==='Yes').length+.5*rev.filter(x=>x.t.review.adherence==='Partially').length)/rev.length*100:null,conc=gp&&w.length?Math.max(...w.map(x=>x.p))/gp*100:0,g=acctGrowth(s,port);
  return{n:a.length,w:w.length,l:l.length,be:a.length-w.length-l.length,wr:w.length+l.length?w.length/(w.length+l.length)*100:0,gp,gl,net,port,aw,al,pf,exp:a.length?net/a.length:0,pay:al?aw/al:0,dd:D.m,pts:D.pts,...S,adh,rev:rev.length,conc,growth:g.growth,balance:g.balance,recovery:D.m?net/D.m:net>0?Infinity:0};
}
function agg(a,k,p=x=>x.p){const m=new Map;a.forEach(x=>{const z=k(x);if(z==null)return;if(!m.has(z))m.set(z,{k:z,n:0,w:0,p:0});const q=m.get(z),v=p(x);q.n++;q.p+=v;if(v>0)q.w++});return[...m.values()].map(x=>({...x,wr:x.n?x.w/x.n*100:0,exp:x.n?x.p/x.n:0}))}
const dayName=k=>({Sun:'الأحد',Mon:'الاثنين',Tue:'الثلاثاء',Wed:'الأربعاء',Thu:'الخميس',Fri:'الجمعة',Sat:'السبت'})[k]||k;
function best(a){return[...a].filter(z=>z.n>=MIN_BEST_SAMPLE).sort((x,y)=>y.exp-x.exp)[0]||null}
function evidence(m){let s=0;s+=Math.min(25,m.n/50*25);s+=Math.max(0,Math.min(20,((Number.isFinite(m.pf)?m.pf:3)-1)/.7*20));s+=m.exp>0?15:0;s+=15*(1-Math.min(1,m.conc/70));s+=Math.min(15,(Number.isFinite(m.recovery)?m.recovery:3)/2*15);s=Math.round(s);let t=m.n<20?'غير كافٍ':s>=75&&m.n>=50?'دليل قوي':s>=60&&m.n>=30?'دليل متوسط':'مؤشرات أولية';return{s,t}}
function svg(p){if(p.length<2)return'—';const W=700,H=170,lo=Math.min(...p),hi=Math.max(...p),sp=hi-lo||1,xy=p.map((v,i)=>[12+(W-24)*i/(p.length-1),H-12-(H-24)*(v-lo)/sp]),d=xy.map((z,i)=>(i?'L':'M')+z[0].toFixed(1)+','+z[1].toFixed(1)).join(' ');return`<svg class="an-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`}
const card=(k,v,s='')=>`<div class="an-kpi"><small>${k}</small><b>${v}</b><em>${s}</em></div>`;
function table(title,a,label=x=>x.k){return`<div class="an-card"><h3>${title}</h3><table><thead><tr><th>الفئة</th><th>Trades</th><th>WR</th><th>Expectancy</th><th>Net</th></tr></thead><tbody>${a.sort((x,y)=>y.exp-x.exp).map(x=>`<tr><td>${esc(label(x))}</td><td>${x.n}</td><td>${pct(x.wr)}</td><td class="${x.exp>=0?'pos':'neg'}">${money(x.exp)}</td><td class="${x.p>=0?'pos':'neg'}">${money(x.p)}</td></tr>`).join('')||'<tr><td colspan="5">لا توجد بيانات موثقة</td></tr>'}</tbody></table></div>`}

function wallToIso(value,zone){
  if(!value)return null;
  const [d,t]=value.split('T'),[Y,M,D]=d.split('-').map(Number),[h,m]=t.split(':').map(Number);
  if(zone==='KSA') return new Date(Date.UTC(Y,M-1,D,h-3,m,0)).toISOString();
  let guess=Date.UTC(Y,M-1,D,h,m,0);
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    const shown=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,0);
    const wanted=Date.UTC(Y,M-1,D,h,m,0);
    guess+=wanted-shown;
  }
  return new Date(guess).toISOString();
}
function unverifiedBox(a){
  const u=a.filter(x=>!x.entryTs); if(!u.length)return'';
  return`<div class="an-card" style="border-color:#a77920"><div class="an-row"><div><h3>أوقات دخول غير موثقة</h3><p>${u.length} صفقة مستبعدة من تحليل اليوم/الساعة/Session حتى يتم إدخال وقت التنفيذ الحقيقي. لا نستخدم وقت إنشاء السجل كوقت دخول.</p></div><b>${u.length}</b></div>${u.map(x=>`<div class="an-row" style="gap:8px;margin-top:10px;align-items:end"><div><small>${esc(x.t.id)} · ${esc(x.t.instrument)} ${esc(x.t.direction)}</small><input type="datetime-local" data-entry-time="${esc(x.t.id)}" value="${esc(x.t.date||'')}T09:30" /></div><label><small>التوقيت</small><select data-entry-zone="${esc(x.t.id)}"><option value="KSA">السعودية</option><option value="NY">نيويورك</option></select></label><button class="btn btn-secondary btn-small" data-save-time="${esc(x.t.id)}">حفظ وقت الدخول</button></div>`).join('')}</div>`;
}
function bindTimeEditor(s){
  document.querySelectorAll('[data-save-time]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.saveTime,input=document.querySelector(`[data-entry-time="${CSS.escape(id)}"]`),zone=document.querySelector(`[data-entry-zone="${CSS.escape(id)}"]`)?.value||'KSA';
    const iso=wallToIso(input?.value,zone); if(!iso)return alert('أدخل تاريخ ووقت الدخول الفعلي.');
    const t=(s.trades||[]).find(x=>x.id===id); if(!t)return;
    t.actualEntryAt=iso;t.entryTimeSource=zone==='KSA'?'MANUAL_KSA':'MANUAL_NY';
    if(s.meta)s.meta.updatedAt=new Date().toISOString();
    localStorage.setItem(SK,JSON.stringify(s));
    alert('تم حفظ وقت الدخول الفعلي محليًا. اضغط Sync لرفعه إلى GitHub.');
    location.reload();
  });
}
function bestCard(label,b,formatter){return card(label,b?formatter(b):'غير كافٍ',b?`${money(b.exp)} expectancy · ${b.n} trades`:`يتطلب ${MIN_BEST_SAMPLE} صفقات موثقة على الأقل`)}
function html(s,f){
  const all=rows(s),a=apply(all,f),timed=a.filter(x=>x.entryTs),m=M(a,s),E=evidence(m),day=agg(timed,x=>x.day),hour=agg(timed,x=>x.h),sess=agg(timed,x=>x.sess),inst=agg(a,x=>x.t.instrument),dir=agg(a,x=>x.t.direction),bd=best(day),bh=best(hour),bs=best(sess),mx=Math.max(1,...hour.map(x=>Math.abs(x.p)));
  return`<section class="page an-page"><div class="an-head"><div><h1>Advanced Analytics</h1><p>Master Trades فقط. تحليلات الوقت تستخدم فقط Initial Entry موثق بتوقيت التنفيذ.</p></div><b>${a.length}/${all.length} closed trades</b></div>
  <div class="an-card an-filters"><label>الفترة<select data-f="range"><option value="ALL">All Time</option><option value="7D">7 Days</option><option value="30D">30 Days</option><option value="90D">90 Days</option></select></label><label>Instrument<select data-f="instrument"><option value="ALL">All</option><option>MNQ</option><option>NQ</option></select></label><label>Direction<select data-f="direction"><option value="ALL">All</option><option>LONG</option><option>SHORT</option></select></label><label>Company<select data-f="company"><option value="ALL">All</option>${(s.companies||[]).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label>Stage<select data-f="stage"><option value="ALL">All</option><option>Evaluation</option><option>SIM</option><option>Live</option></select></label></div>
  ${unverifiedBox(a)}
  <div class="an-kpis">${card('Win Rate',pct(m.wr),`${m.w}W / ${m.l}L / ${m.be} BE`)}${card('Profit Factor',num(m.pf),'Gross Win ÷ Gross Loss')}${card('Expectancy / Trade',money(m.exp),'Net / account')}${card('Avg Win / Loss',`${money(m.aw)} / ${money(m.al)}`,`Payoff ${num(m.pay)}`)}${card('Max Drawdown',money(m.dd),'Master equity / account')}${card('Trading Growth',pct(m.growth),'Portfolio P&L ÷ Opening')}</div>
  <div class="an-grid2"><div class="an-card an-evidence"><div><h3>هل يوجد نظام / Edge؟</h3><div class="an-score">${E.s}<small>/100</small></div><strong>${E.t}</strong><p>لا نعتبر النتائج قوية إذا كانت العينة صغيرة أو الربح معتمدًا على صفقة واحدة أو الـDrawdown مرتفعًا.</p></div><ul><li>Sample: <b>${m.n}</b></li><li>Profit Factor: <b>${num(m.pf)}</b></li><li>Expectancy: <b>${money(m.exp)}</b></li><li>Largest-win concentration: <b>${pct(m.conc)}</b></li><li>Recovery Factor: <b>${num(m.recovery)}</b></li><li>Plan adherence: <b>${m.adh==null?'—':pct(m.adh)}</b></li><li>Time coverage: <b>${timed.length}/${a.length}</b></li></ul></div><div class="an-card"><div class="an-row"><h3>Equity Curve</h3><b class="${m.net>=0?'pos':'neg'}">${money(m.net)}</b></div>${svg(m.pts)}<div class="an-mini">${card('Best Win Streak',m.mw)}${card('Max Loss Streak',m.ml)}${card('Balance Growth',pct(m.balance))}</div></div></div>
  <div class="an-best">${bestCard('أفضل يوم — NY',bd,x=>dayName(x.k))}${bestCard('أفضل ساعة دخول — NY',bh,x=>`${String(x.k).padStart(2,'0')}:00`)}${bestCard('أفضل Session',bs,x=>x.k)}</div>
  <div class="an-grid2">${table('الأداء حسب أيام الأسبوع',day,x=>dayName(x.k))}${table('الأداء حسب Session',sess)}</div>
  <div class="an-card"><h3>Heatmap — ساعات الدخول NY</h3><p>${timed.length?`مبنية على ${timed.length} صفقة ذات وقت دخول موثق.`:'لا توجد أوقات دخول موثقة بعد.'}</p><div class="an-heat">${Array.from({length:24},(_,h)=>{const x=hour.find(z=>+z.k===h)||{n:0,p:0,wr:0},o=x.n?Math.max(.08,Math.min(.45,Math.abs(x.p)/mx*.45)):0;return`<div class="${x.p>0?'hp':x.p<0?'hn':''}" style="--o:${o}"><b>${String(h).padStart(2,'0')}:00</b><span>${x.n}T · ${pct(x.wr)}<br>${money(x.p)}</span></div>`}).join('')}</div></div>
  <div class="an-grid2">${table('Instrument',inst)}${table('Direction',dir)}</div></section>`;
}
function bind(f,s){
  document.querySelectorAll('.an-filters select').forEach(x=>{x.value=f[x.dataset.f];x.onchange=async()=>{const n=filters();n[x.dataset.f]=x.value;localStorage.setItem(FK,JSON.stringify(n));const p=$('.an-page');if(p){const st=await state();p.outerHTML=html(st,n);requestAnimationFrame(()=>bind(n,st))}}});
  bindTimeEditor(s);
}
async function analytics(){if((location.hash||'#dashboard').slice(1).split('?')[0]!=='analytics')return;const p=$('#app .page');if(!p||p.classList.contains('an-page'))return;const s=await state(),f=filters();p.outerHTML=html(s,f);requestAnimationFrame(()=>bind(f,s))}
async function dash(){if((location.hash||'#dashboard').slice(1).split('?')[0]!=='dashboard')return;const p=$('#app .page');if(!p||p.querySelector('.an-snap'))return;const s=await state(),m=M(rows(s),s),E=evidence(m),d=document.createElement('div');d.className='an-snap an-card';d.innerHTML=`<div class="an-row"><div><h3>Performance Snapshot</h3><p>All-Time · التفاصيل في Analytics</p></div><button class="btn btn-secondary btn-small" onclick="location.hash='#analytics'">فتح التحليلات</button></div><div class="an-mini">${card('Win Rate',pct(m.wr),`${m.w}W / ${m.l}L`)}${card('Profit Factor',num(m.pf),`${m.n} trades`)}${card('Trading Growth',pct(m.growth))}${card('System Evidence',E.t,`${E.s}/100`)}</div>`;(p.querySelector('.page-title')||p).insertAdjacentElement('afterend',d)}
let timer;function go(){clearTimeout(timer);timer=setTimeout(()=>{analytics();dash()},50)}window.addEventListener('hashchange',go);window.addEventListener('load',go);new MutationObserver(go).observe(document.documentElement,{childList:true,subtree:true});go();
