const STATE_KEY='trading-os-state-v1';
const PENDING_KEY='trading-os-pending-v1';
const nativeSet=Storage.prototype.setItem;
const nativeGet=Storage.prototype.getItem;
const clone=x=>JSON.parse(JSON.stringify(x));
const nowIso=()=>new Date().toISOString();
const nyDate=iso=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))+' NY'}catch{return iso||'—'}};

function preserveFinalizedReviews(storage,key,value){
  if(key!==STATE_KEY||typeof value!=='string')return value;
  try{
    const current=JSON.parse(nativeGet.call(storage,STATE_KEY)||'{}'),incoming=JSON.parse(value),cm=new Map((current.trades||[]).map(t=>[t.id,t]));
    for(const t of incoming.trades||[]){
      const old=cm.get(t.id),od=old?.documentation;if(!od)continue;
      if(od.reviewFinalizedAt&&od.reviewSnapshot){
        t.review=clone(od.reviewSnapshot);
        t.documentation=t.documentation||{};
        t.documentation.reviewFinalizedAt=od.reviewFinalizedAt;
        t.documentation.reviewSnapshot=clone(od.reviewSnapshot);
      }
      if(od.charts){
        t.documentation=t.documentation||{};t.documentation.charts=t.documentation.charts||{};
        if(od.charts.entry)t.documentation.charts.entry=clone(od.charts.entry);
        if(od.charts.exit)t.documentation.charts.exit=clone(od.charts.exit);
      }
      for(const k of ['importantNotes','chartAddenda','reviewAddenda'])if(Array.isArray(od[k])&&!(Array.isArray(t.documentation?.[k]))) {t.documentation=t.documentation||{};t.documentation[k]=clone(od[k]);}
    }
    return JSON.stringify(incoming);
  }catch{return value}
}
Storage.prototype.setItem=function(key,value){return nativeSet.call(this,key,preserveFinalizedReviews(this,key,value))};

function load(){try{return JSON.parse(nativeGet.call(localStorage,STATE_KEY)||'{}')}catch{return{}}}
function save(s){s.meta=s.meta||{};s.meta.updatedAt=nowIso();nativeSet.call(localStorage,STATE_KEY,JSON.stringify(s));nativeSet.call(localStorage,PENDING_KEY,'1');window.dispatchEvent(new CustomEvent('trading-os-documentation-change',{detail:{updatedAt:s.meta.updatedAt}}));}
function openTradeId(){
  const items=[...document.querySelectorAll('.doc-overlay .doc-info')];for(const x of items){if(x.querySelector('small')?.textContent.trim()==='Trade ID')return x.querySelector('b')?.textContent.trim()||null}return null;
}
function hasReview(r){return r&&typeof r==='object'&&Object.values(r).some(v=>v!==null&&v!==''&&!(Array.isArray(v)&&!v.length))}
function inject(){
  const panel=document.querySelector('.doc-overlay .doc-review');if(!panel||panel.querySelector('.doc-review-lock'))return;const id=openTradeId();if(!id)return;const s=load(),t=(s.trades||[]).find(x=>x.id===id);if(!t)return;const d=t.documentation||{};
  const box=document.createElement('div');box.className='doc-review-lock';box.style.cssText='margin:0 0 12px;padding:10px 12px;border:1px solid #80591f;border-radius:9px;background:#2c2112;color:#ffe0a8;font-size:11px;line-height:1.7';
  if(d.reviewFinalizedAt&&d.reviewSnapshot){box.innerHTML=`<b>المراجعة الأصلية مقفلة</b><br>تم اعتمادها في ${nyDate(d.reviewFinalizedAt)}. أي تحليل جديد يُضاف أسفلها كمراجعة لاحقة ولا يغيّر الأصل.`}
  else if(hasReview(t.review)){
    box.innerHTML='<b>المراجعة الأصلية غير مقفلة بعد.</b><br>بعد التأكد من الالتزام بالخطة والخطأ والدرس، اعتمدها لتصبح غير قابلة للتعديل. <button type="button" class="doc-btn orange" data-finalize-review style="margin-right:8px">اعتماد المراجعة الأصلية</button>';
    box.querySelector('[data-finalize-review]').onclick=()=>{if(!confirm('بعد الاعتماد لن يمكن تعديل المراجعة الأصلية. أي مراجعة جديدة ستضاف بتاريخ جديد تحتها. هل تريد المتابعة؟'))return;const st=load(),tr=(st.trades||[]).find(x=>x.id===id);if(!tr||!hasReview(tr.review))return;tr.documentation=tr.documentation||{};tr.documentation.reviewSnapshot=clone(tr.review);tr.documentation.reviewFinalizedAt=nowIso();save(st);document.querySelector('.doc-back')?.click();setTimeout(()=>document.querySelector(`[data-trade-id="${CSS.escape(id)}"]`)?.click(),40)};
  }else box.innerHTML='<b>لا توجد مراجعة أصلية بعد.</b><br>أكمل المراجعة أولًا، ثم افتح التوثيق لاعتمادها.';
  panel.prepend(box);
}
let tm;function schedule(){clearTimeout(tm);tm=setTimeout(inject,50)}new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',schedule);schedule();
