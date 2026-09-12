import { INSTRUMENTS, replayTrade } from './engine.js';

const STATE_KEY='trading-os-state-v1';
const STATUS_OPTIONS=['Closed','Active','Partially Closed','Cancelled','Draft'];
let overlay=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const round2=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
const readState=()=>{try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{}}};
const companyMap=s=>Object.fromEntries((s.companies||[]).map(c=>[c.id,c]));
const accountMap=s=>Object.fromEntries((s.accounts||[]).map(a=>[a.id,a]));

function reviewData(t){
  const d=t.documentation||{},r=d.reviewSnapshot||t.review||{};
  return {
    status:d.reviewFinalizedAt&&d.reviewSnapshot?'Finalized':Object.values(r||{}).some(v=>v!==null&&v!==''&&!(Array.isArray(v)&&!v.length))?'Pending':'None',
    adherence:r.adherence||r.planAdherence||'',error:r.error||r.mainError||'',lesson:r.lesson||r.lessonLearned||'',comment:r.comment||r.note||'',finalizedAt:d.reviewFinalizedAt||''
  };
}
function eventAt(e){return e?.actualTimestamp||e?.timestamp||null}
function avgPx(events,types){let q=0,v=0;for(const e of events||[]){if(!types.includes(e.type))continue;const n=num(e.qtyPerAccount);q+=n;v+=n*num(e.price)}return q?v/q:0}
function tradeShape(t){
  const ev=[...(t.events||[])].sort((a,b)=>new Date(eventAt(a)||0)-new Date(eventAt(b)||0));
  const opens=ev.filter(e=>['INITIAL','ADD'].includes(e.type)),closes=ev.filter(e=>['REDUCE','CLOSE'].includes(e.type));
  const entryAt=eventAt(opens[0])||t.actualEntryAt||null,exitAt=eventAt(closes.at(-1))||t.actualExitAt||null;
  const qty=opens.length?num(opens[0].qtyPerAccount):0;
  return {entryAt,exitAt,entryPrice:avgPx(ev,['INITIAL','ADD']),exitPrice:avgPx(ev,['REDUCE','CLOSE']),qty,events:ev};
}
function fmtNy(iso){
  if(!iso)return'';const d=new Date(iso);if(Number.isNaN(d.getTime()))return String(iso);
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
  const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
}
function duration(a,b){const ms=new Date(b||0)-new Date(a||0);if(!Number.isFinite(ms)||ms<0)return'';const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;return `${h}h ${String(m).padStart(2,'0')}m ${String(ss).padStart(2,'0')}s`}
function tradeUnits(t,state){
  const am=accountMap(state),cm=companyMap(state),out=[];
  for(const al of t.allocations||[]){
    const ids=Array.isArray(al.accountIds)?al.accountIds.filter(Boolean):[];
    if(ids.length){for(const id of ids){const a=am[id]||{};out.push({accountId:id,companyId:a.companyId||al.companyId||'',companyName:cm[a.companyId||al.companyId]?.name||al.companyName||a.companyId||al.companyId||'',accountNumber:a.accountNumber||'',sizeK:a.sizeK??al.sizeK??'',stage:a.stage||al.stage||'',sequence:a.sequence??'',status:a.status||'',quantityMultiplier:num(al.quantityMultiplier||1)||1,legacy:false})}}
    else {const count=Math.max(0,Number(al.accountCount||0));for(let i=0;i<count;i++)out.push({accountId:`LEGACY:${t.id}:${al.companyId||'NA'}:${i+1}`,companyId:al.companyId||'',companyName:cm[al.companyId]?.name||al.companyName||al.companyId||'',accountNumber:'',sizeK:al.sizeK??'',stage:al.stage||'',sequence:i+1,status:'',quantityMultiplier:num(al.quantityMultiplier||1)||1,legacy:true})}
  }
  return out;
}
function selectedUnits(t,state,f){
  let u=tradeUnits(t,state);
  if(f.companyId)u=u.filter(x=>x.companyId===f.companyId);
  if(f.accountId)u=u.filter(x=>x.accountId===f.accountId);
  return u;
}
function collect(state,f){
  const selected=[];
  for(const t of state.trades||[]){
    if(!f.statuses.has(t.status||''))continue;
    if(!f.allDates){if(f.from&&String(t.date||'')<f.from)continue;if(f.to&&String(t.date||'')>f.to)continue}
    const units=selectedUnits(t,state,f);if(!units.length)continue;
    let replay;try{replay=replayTrade(t)}catch{continue}
    selected.push({trade:t,units,replay,shape:tradeShape(t),review:reviewData(t)});
  }
  selected.sort((a,b)=>String(a.trade.date||'').localeCompare(String(b.trade.date||''))||new Date(a.shape.entryAt||0)-new Date(b.shape.entryAt||0));
  return selected;
}
function metrics(rows){
  const masterNet=rows.map(x=>num(x.replay.realizedPerAccount));
  const accountRows=rows.flatMap(x=>x.units.map(()=>num(x.replay.realizedPerAccount)));
  const gross=rows.reduce((s,x)=>s+num(x.replay.grossRealizedPerAccount)*x.units.length,0),fees=rows.reduce((s,x)=>s+num(x.replay.commissionPerAccount)*x.units.length,0),net=rows.reduce((s,x)=>s+num(x.replay.realizedPerAccount)*x.units.length,0);
  const wins=masterNet.filter(v=>v>0),losses=masterNet.filter(v=>v<0),gp=wins.reduce((s,v)=>s+v,0),gl=Math.abs(losses.reduce((s,v)=>s+v,0));
  return {masterTrades:rows.length,accountExecutions:accountRows.length,accounts:new Set(rows.flatMap(x=>x.units.map(u=>u.accountId))).size,gross:round2(gross),fees:round2(fees),net:round2(net),wins:wins.length,losses:losses.length,winRate:rows.length?round2(wins.length/rows.length*100):0,profitFactor:gl?round2(gp/gl):(gp>0?'∞':0),avgWin:wins.length?round2(gp/wins.length):0,avgLoss:losses.length?round2(losses.reduce((s,v)=>s+v,0)/losses.length):0};
}
function filtersFromUi(){
  const scope=overlay.querySelector('[data-exp-scope]').value,companyId=scope==='all'?'':overlay.querySelector('[data-exp-company]').value,accountId=scope==='account'?overlay.querySelector('[data-exp-account]').value:'';
  const allDates=overlay.querySelector('[data-exp-all-dates]').checked,statuses=new Set([...overlay.querySelectorAll('[data-exp-status]:checked')].map(x=>x.value));
  return {scope,companyId,accountId,allDates,from:overlay.querySelector('[data-exp-from]').value,to:overlay.querySelector('[data-exp-to]').value,statuses};
}
function updateAccountOptions(){
  const state=readState(),scope=overlay.querySelector('[data-exp-scope]').value,company=overlay.querySelector('[data-exp-company]'),account=overlay.querySelector('[data-exp-account]');
  company.disabled=scope==='all';account.disabled=scope!=='account';
  const cid=company.value;const arr=(state.accounts||[]).filter(a=>!cid||a.companyId===cid);
  account.innerHTML='<option value="">اختر الحساب…</option>'+arr.map(a=>`<option value="${esc(a.id)}">${esc(a.accountNumber||`#${a.sequence||'—'}`)} · ${esc(a.sizeK||'—')}K · ${esc(a.stage||'—')}</option>`).join('');
}
function preview(){
  try{
    const state=readState(),f=filtersFromUi();if(!f.statuses.size)throw new Error('اختر حالة صفقة واحدة على الأقل.');if(f.scope!=='all'&&!f.companyId)throw new Error('اختر الشركة.');if(f.scope==='account'&&!f.accountId)throw new Error('اختر الحساب.');if(!f.allDates&&f.from&&f.to&&f.from>f.to)throw new Error('تاريخ البداية أكبر من تاريخ النهاية.');
    const rows=collect(state,f),m=metrics(rows),accountNet=round2(rows.flatMap(x=>x.units.map(()=>num(x.replay.realizedPerAccount))).reduce((s,v)=>s+v,0)),ok=Math.abs(accountNet-m.net)<0.01;
    overlay._export={state,f,rows,m};
    overlay.querySelector('[data-exp-preview]').innerHTML=`<div class="exp-kpis"><div><small>Master Trades</small><b>${m.masterTrades}</b></div><div><small>Account Executions</small><b>${m.accountExecutions}</b></div><div><small>Accounts</small><b>${m.accounts}</b></div><div><small>Net P&L</small><b class="${m.net>=0?'pos':'neg'}">$${m.net.toLocaleString()}</b></div><div><small>Win Rate</small><b>${m.winRate}%</b></div><div><small>Profit Factor</small><b>${m.profitFactor}</b></div></div><div class="exp-reconcile ${ok?'ok':'bad'}">${ok?'✓ Reconciled':'⚠ Reconciliation mismatch'} · Portfolio Net $${m.net.toLocaleString()} · Account rows $${accountNet.toLocaleString()}</div>`;
    overlay.querySelector('[data-exp-export]').disabled=!rows.length;
    setStatus(rows.length?`جاهز للتصدير: ${rows.length} Master Trade.`:'لا توجد صفقات تطابق الفلاتر الحالية.',rows.length?'ok':'warn');
  }catch(e){overlay._export=null;overlay.querySelector('[data-exp-export]').disabled=true;overlay.querySelector('[data-exp-preview]').innerHTML='';setStatus(e.message||String(e),'error')}
}
function setStatus(msg,type=''){const el=overlay?.querySelector('[data-exp-statusmsg]');if(!el)return;el.className=`exp-status ${type}`;el.textContent=msg}

function summaryRows(state,f,rows,m){
  const cm=companyMap(state),am=accountMap(state),a=f.accountId?am[f.accountId]:null;
  const scope=f.scope==='all'?'All Companies':f.scope==='company'?(cm[f.companyId]?.name||f.companyId):`${cm[a?.companyId]?.name||a?.companyId||''} / ${a?.accountNumber||a?.id||''}`;
  return [['Trading OS Export Summary',''],['Generated At',new Date().toISOString()],['Scope',scope],['Period',f.allDates?'All':`${f.from||'…'} to ${f.to||'…'}`],['Statuses',[...f.statuses].join(', ')],['',''],['Master Trades',m.masterTrades],['Account Executions',m.accountExecutions],['Accounts',m.accounts],['Winning Master Trades',m.wins],['Losing Master Trades',m.losses],['Win Rate %',m.winRate],['Profit Factor',m.profitFactor],['Average Win / Master',m.avgWin],['Average Loss / Master',m.avgLoss],['Portfolio Gross P&L',m.gross],['Fees & Commission',m.fees],['Portfolio Net P&L',m.net],['',''],['P&L Rule','Net = Gross - Fees'],['Analytics Timezone','America/New_York'],['Master Trade Rule','Copied trade counts once behaviorally; account executions are reported separately.']];
}
function masterTradeRows(rows){
  const h=['Trade ID','Date','Instrument','Direction','Status','Qty / Account','Entry Price','Exit Price','Entry Time NY','Exit Time NY','Duration','Selected Accounts','Gross / Account','Fees / Account','Net / Account','Scope Gross','Scope Fees','Scope Net','Review Status','Plan Adherence','Main Error','Lesson Learned','Review Comment','Import Source','Source Accounts','Order IDs'];
  return [h,...rows.map(x=>{const t=x.trade,r=x.replay,s=x.shape,v=x.review,n=x.units.length,src=t.importSource||{};return[t.id,t.date,t.instrument,t.direction,t.status,s.qty,round2(s.entryPrice),round2(s.exitPrice),fmtNy(s.entryAt),fmtNy(s.exitAt),duration(s.entryAt,s.exitAt),n,round2(r.grossRealizedPerAccount),round2(r.commissionPerAccount),round2(r.realizedPerAccount),round2(r.grossRealizedPerAccount*n),round2(r.commissionPerAccount*n),round2(r.realizedPerAccount*n),v.status,v.adherence,v.error,v.lesson,v.comment,src.provider||src.type||'',(src.sourceAccounts||[]).join(', '),(src.orderIds||[]).join(', ')]})];
}
function accountTradeRows(rows){
  const h=['Trade ID','Date','Company','Account ID','Account Number','Account Size K','Stage','Sequence','Account Status','Instrument','Direction','Qty / Account','Entry Price','Exit Price','Entry Time NY','Exit Time NY','Duration','Gross P&L','Fees','Net P&L','Trade Status','Review Status','Plan Adherence','Main Error','Lesson Learned','Import Source'];const out=[h];
  for(const x of rows){const t=x.trade,r=x.replay,s=x.shape,v=x.review,src=t.importSource||{};for(const u of x.units)out.push([t.id,t.date,u.companyName,u.accountId,u.accountNumber,u.sizeK,u.stage,u.sequence,u.status,t.instrument,t.direction,s.qty,round2(s.entryPrice),round2(s.exitPrice),fmtNy(s.entryAt),fmtNy(s.exitAt),duration(s.entryAt,s.exitAt),round2(r.grossRealizedPerAccount),round2(r.commissionPerAccount),round2(r.realizedPerAccount),t.status,v.status,v.adherence,v.error,v.lesson,src.provider||src.type||''])}
  return out;
}
function eventRows(rows){
  const h=['Trade ID','Trade Date','Event ID','Event Type','Actual Time NY','Recorded Timestamp','Qty / Account','Price','Reason','Source Order ID','Selected Accounts','Instrument','Direction'];const out=[h];
  for(const x of rows){for(const e of x.shape.events)out.push([x.trade.id,x.trade.date,e.id||'',e.type,fmtNy(eventAt(e)),e.timestamp||'',num(e.qtyPerAccount),num(e.price),e.reason||'',e.sourceOrderId||'',x.units.length,x.trade.instrument,x.trade.direction])}
  return out;
}
function accountRows(state,rows){
  const ids=new Set(rows.flatMap(x=>x.units.filter(u=>!u.legacy).map(u=>u.accountId))),cm=companyMap(state);const h=['Company','Account ID','Account Number','Size K','Stage','Sequence','Status','Opening Balance','Created At','Closed At'];return[h,...(state.accounts||[]).filter(a=>ids.has(a.id)).map(a=>[cm[a.companyId]?.name||a.companyId,a.id,a.accountNumber||'',a.sizeK,a.stage,a.sequence,a.status,a.openingBalance??'',a.createdAt||'',a.closedAt||''])];
}

const xmlEsc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function colName(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function sheetXml(rows,summary=false){
  const widths=[];for(const row of rows)row.forEach((v,i)=>{widths[i]=Math.min(55,Math.max(widths[i]||10,String(v??'').length+2))});
  const cols=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  const data=rows.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>{const ref=`${colName(ci+1)}${ri+1}`;if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}"${ri===0&&!summary?' s="1"':''}><v>${v}</v></c>`;const st=ri===0&&!summary?' s="1"':'';return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`}).join('')}</row>`).join('');
  const freeze=!summary?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter=!summary&&rows[0]?.length?`<autoFilter ref="A1:${colName(rows[0].length)}${Math.max(1,rows.length)}"/>`:'';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${data}</sheetData>${filter}</worksheet>`;
}
const enc=s=>new TextEncoder().encode(s);
let crcTable=null;function crc32(data){if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0}}let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function u16(v){return new Uint8Array([v&255,(v>>>8)&255])}function u32(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255])}function cat(parts){const n=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(n);let k=0;for(const p of parts){o.set(p,k);k+=p.length}return o}
function dos(){const d=new Date();const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31),date=(((d.getFullYear()-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);return{time,date}}
function zip(files){const locals=[],centrals=[];let offset=0;const dt=dos();for(const f of files){const name=enc(f.name),data=typeof f.data==='string'?enc(f.data):f.data,crc=crc32(data);const local=cat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);const cen=cat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);centrals.push(cen);offset+=local.length}const csize=centrals.reduce((s,p)=>s+p.length,0),end=cat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(csize),u32(offset),u16(0)]);return cat([...locals,...centrals,end])}
function workbook(sheets){
  const names=sheets.map((s,i)=>`<sheet name="${xmlEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const rels=sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  const overrides=sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files=[
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`},
    {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names}</sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`},
    {name:'xl/styles.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'}
  ];
  sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.rows,s.summary)}));return zip(files);
}
function safeName(s){return String(s||'All').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70)||'All'}
function filename(state,f){const cm=companyMap(state),am=accountMap(state);let scope='All';if(f.scope==='company')scope=cm[f.companyId]?.name||f.companyId;if(f.scope==='account'){const a=am[f.accountId];scope=`${cm[a?.companyId]?.name||''}_${a?.accountNumber||a?.id||''}`}const period=f.allDates?'All':`${f.from||'Start'}_to_${f.to||'End'}`;return `TradingOS_${safeName(scope)}_${safeName(period)}.xlsx`}
function exportXlsx(){
  const x=overlay?._export;if(!x?.rows?.length)return;setStatus('جاري إنشاء ملف Excel…');
  try{const sheets=[{name:'Summary',rows:summaryRows(x.state,x.f,x.rows,x.m),summary:true},{name:'Trades',rows:masterTradeRows(x.rows)},{name:'Account Trades',rows:accountTradeRows(x.rows)},{name:'Events',rows:eventRows(x.rows)},{name:'Accounts',rows:accountRows(x.state,x.rows)}];const bytes=workbook(sheets),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename(x.state,x.f);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus(`تم إنشاء ${a.download} · ${x.m.masterTrades} Master Trade · ${x.m.accountExecutions} Account Execution.`,'ok')}catch(e){console.error(e);setStatus(`فشل التصدير: ${e.message||e}`,'error')}
}
function open(){
  close();const state=readState(),companies=(state.companies||[]).filter(c=>(state.accounts||[]).some(a=>a.companyId===c.id));overlay=document.createElement('div');overlay.className='exp-overlay';overlay.innerHTML=`<section class="exp-dialog"><div class="exp-head"><div><h2>Reports & Excel Export</h2><p>تصدير الصفقات حسب جميع الشركات أو شركة أو حساب، لكل الفترات أو فترة محددة. التصدير Read-only ولا يغيّر بيانات Trading OS.</p></div><button type="button" data-exp-close>إغلاق</button></div><div class="exp-grid"><label>Scope<select data-exp-scope><option value="all">جميع الشركات</option><option value="company">شركة محددة</option><option value="account">حساب محدد</option></select></label><label>Company<select data-exp-company disabled><option value="">اختر الشركة…</option>${companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label>Account<select data-exp-account disabled><option value="">اختر الحساب…</option></select></label></div><div class="exp-period"><label class="exp-check"><input type="checkbox" data-exp-all-dates checked> كل الفترات</label><label>From<input type="date" data-exp-from disabled></label><label>To<input type="date" data-exp-to disabled></label></div><div class="exp-statuses"><b>Trade Status</b>${STATUS_OPTIONS.map(s=>`<label><input type="checkbox" data-exp-status value="${s}" ${s==='Closed'?'checked':''}> ${s}</label>`).join('')}</div><div class="exp-actions"><button class="btn btn-secondary" type="button" data-exp-previewbtn>معاينة</button><button class="btn btn-primary" type="button" data-exp-export disabled>Export Excel (.xlsx)</button></div><div class="exp-status" data-exp-statusmsg>اختر الفلاتر ثم اضغط معاينة.</div><div data-exp-preview></div><div class="exp-note">Workbook: Summary · Trades · Account Trades · Events · Accounts. Master Trade تُحسب مرة واحدة سلوكيًا، بينما Account Trades تفصل النتائج لكل حساب.</div></section>`;document.body.appendChild(overlay);
  const scope=overlay.querySelector('[data-exp-scope]'),company=overlay.querySelector('[data-exp-company]'),allDates=overlay.querySelector('[data-exp-all-dates]');scope.onchange=()=>{updateAccountOptions();overlay.querySelector('[data-exp-export]').disabled=true};company.onchange=()=>{updateAccountOptions();overlay.querySelector('[data-exp-export]').disabled=true};allDates.onchange=()=>{overlay.querySelector('[data-exp-from]').disabled=allDates.checked;overlay.querySelector('[data-exp-to]').disabled=allDates.checked};overlay.querySelector('[data-exp-previewbtn]').onclick=preview;overlay.querySelector('[data-exp-export]').onclick=exportXlsx;overlay.querySelector('[data-exp-close]').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close()});updateAccountOptions();
}
function close(){overlay?.remove();overlay=null}
function injectNav(){const nav=document.querySelector('.nav');if(!nav||nav.querySelector('[data-export-center-nav]'))return;const b=document.createElement('button');b.type='button';b.dataset.exportCenterNav='1';b.innerHTML='<span>التقارير والتصدير</span><small>Excel</small>';b.onclick=open;nav.appendChild(b)}
let scheduled=false;function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;injectNav()})}new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',schedule);schedule();window.TradingOSExportCenter={open,ready:true};
