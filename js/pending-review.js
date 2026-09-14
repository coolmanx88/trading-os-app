const STATE_KEY='trading-os-state-v1';
const PENDING_KEY='trading-os-pending-v1';

const load=()=>{try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{trades:[]}}};
const nowIso=()=>new Date().toISOString();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
const nyDate=iso=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))+' NY'}catch{return iso||'—'}};
const hasValue=v=>v!==undefined&&v!==null&&String(v).trim()!=='';

function isFinalized(t){return Boolean(t?.documentation?.reviewFinalizedAt&&t?.documentation?.reviewSnapshot)}
function hasReviewEvidence(t){const d=t?.documentation||{};const addenda=Array.isArray(d.reviewAddenda)?d.reviewAddenda:[];const r=t?.review;return Boolean(isFinalized(t)||d.reviewSnapshot||addenda.some(x=>String(x?.text||'').trim())||(r&&[r.adherence,r.error,r.mistake,r.mainError,r.lesson,r.comment,r.notes].some(v=>String(v??'').trim())))}
function isPendingReview(t){return t?.status==='Closed'&&!hasReviewEvidence(t)}
function pendingTrades(state=load()){return (state.trades||[]).filter(isPendingReview)}
function save(state){state.meta=state.meta||{};state.meta.updatedAt=nowIso();localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.setItem(PENDING_KEY,'1');window.dispatchEvent(new CustomEvent('trading-os-documentation-change',{detail:{updatedAt:state.meta.updatedAt}}));window.dispatchEvent(new CustomEvent('trading-os-review-change'));}
function tradeIdFromClosedDetail(){const root=document.querySelector('.closed-log-overlay .closed-log-inner');if(!root)return null;return (root.textContent||'').match(/TR-[A-Za-z0-9-]+/)?.[0]||null}
function tradeIdFromDocDetail(){const infos=[...document.querySelectorAll('.doc-overlay .doc-info')];for(const x of infos){if(x.querySelector('small')?.textContent.trim()==='Trade ID')return x.querySelector('b')?.textContent.trim()||null}return null}
function openClosed(t){if(!t)return;if(window.TradingOSClosedTrade?.ready)window.TradingOSClosedTrade.openTrade(t.id,t.date||null);else window.dispatchEvent(new CustomEvent('trading-os-open-closed-trade',{detail:{id:t.id,date:t.date||null}}));}

function reviewDraft(t){return t?.review&&typeof t.review==='object'?t.review:{}}
function completeEnough(r){return ['adherence','lesson'].every(k=>hasValue(r?.[k]))&&hasValue(r?.error||r?.mistake||r?.mainError||r?.errorType)}

function formHtml(t){
  const r=reviewDraft(t),err=r.error||r.mistake||r.mainError||r.errorType||'',lesson=r.lesson||r.lessons||r.takeaway||'',comment=r.comment||r.notes||'';
  return `<section class="post-review-box" data-post-review="${esc(t.id)}"><div class="post-review-head"><div><h4>مراجعة الصفقة الأصلية</h4><p>هذه الصفقة مغلقة لكنها لم تُعتمد مراجعتها بعد. احفظ مسودة الآن أو اعتمدها عندما تنتهي من التقييم.</p></div><span>بانتظار المراجعة</span></div><div class="post-review-grid"><label><small>الالتزام بالخطة</small><select data-pr-adherence><option value="">اختر…</option><option value="Yes" ${r.adherence==='Yes'?'selected':''}>ملتزم بالخطة</option><option value="Partially" ${r.adherence==='Partially'?'selected':''}>ملتزم جزئيًا</option><option value="No" ${r.adherence==='No'?'selected':''}>غير ملتزم بالخطة</option></select></label><label><small>الخطأ الرئيسي</small><textarea data-pr-error placeholder="مثال: دخلت قبل اكتمال MSS، أو اكتب لا يوجد إذا لم يكن هناك خطأ واضح.">${esc(err)}</textarea></label><label><small>الدرس المستفاد</small><textarea data-pr-lesson placeholder="ما القاعدة أو السلوك الذي تريد تثبيته من هذه الصفقة؟">${esc(lesson)}</textarea></label><label><small>ملاحظة المراجعة — اختيارية</small><textarea data-pr-comment placeholder="تفصيل إضافي عن القرار أو الحالة النفسية أو التنفيذ.">${esc(comment)}</textarea></label></div><div class="post-review-actions"><button type="button" data-pr-save>حفظ مسودة</button><button type="button" class="primary" data-pr-finalize>اعتماد المراجعة الأصلية</button></div><div class="post-review-msg" data-pr-msg></div></section>`;
}

function readForm(box){return{adherence:box.querySelector('[data-pr-adherence]')?.value||'',error:box.querySelector('[data-pr-error]')?.value.trim()||'',lesson:box.querySelector('[data-pr-lesson]')?.value.trim()||'',comment:box.querySelector('[data-pr-comment]')?.value.trim()||''}}
function persistReview(tradeId,finalize=false){
  const box=document.querySelector(`[data-post-review="${CSS.escape(tradeId)}"]`);if(!box)return;
  const data=readForm(box),msg=box.querySelector('[data-pr-msg]');
  if(finalize&&!completeEnough(data)){msg.textContent='للاعتماد: اختر الالتزام بالخطة، واكتب الخطأ الرئيسي والدرس المستفاد. إذا لم يوجد خطأ اكتب «لا يوجد».';msg.className='post-review-msg error';return}
  if(finalize&&!confirm('بعد اعتماد المراجعة الأصلية لن يمكن تعديلها. أي تحليل لاحق سيضاف بتاريخ جديد. هل تريد المتابعة؟'))return;
  const state=load(),t=(state.trades||[]).find(x=>x.id===tradeId);if(!t)return;
  if(isFinalized(t)){msg.textContent='المراجعة الأصلية معتمدة بالفعل.';return}
  t.review={...(t.review||{}),...data,reviewedAt:t.review?.reviewedAt||nowIso(),updatedAt:nowIso()};
  t.documentation=t.documentation||{};
  if(finalize){t.documentation.reviewSnapshot=JSON.parse(JSON.stringify(t.review));t.documentation.reviewFinalizedAt=nowIso()}
  save(state);
  msg.textContent=finalize?'تم اعتماد المراجعة الأصلية وإقفالها.':'تم حفظ مسودة المراجعة.';msg.className='post-review-msg ok';
  if(finalize)setTimeout(()=>{document.querySelector('.closed-log-overlay [data-closed-close]')?.click();openClosed(t);},250);
}

function injectClosedDetail(){
  const section=document.querySelector('.closed-log-overlay .closed-review');if(!section||section.dataset.pendingReviewChecked==='1')return;
  const id=tradeIdFromClosedDetail(),state=load(),t=(state.trades||[]).find(x=>x.id===id);if(!t)return;section.dataset.pendingReviewChecked='1';
  if(hasReviewEvidence(t))return;
  section.insertAdjacentHTML('beforebegin',formHtml(t));const box=document.querySelector(`[data-post-review="${CSS.escape(id)}"]`);box.querySelector('[data-pr-save]').onclick=()=>persistReview(id,false);box.querySelector('[data-pr-finalize]').onclick=()=>persistReview(id,true);
}
function injectDocDetail(){
  const section=document.querySelector('.doc-overlay .doc-review');if(!section||section.dataset.pendingReviewChecked==='1')return;
  const id=tradeIdFromDocDetail(),state=load(),t=(state.trades||[]).find(x=>x.id===id);if(!t)return;section.dataset.pendingReviewChecked='1';
  if(hasReviewEvidence(t))return;
  section.insertAdjacentHTML('beforebegin',formHtml(t));const box=document.querySelector(`[data-post-review="${CSS.escape(id)}"]`);box.querySelector('[data-pr-save]').onclick=()=>persistReview(id,false);box.querySelector('[data-pr-finalize]').onclick=()=>persistReview(id,true);
}
function badgeClosedLists(){
  const state=load(),pending=new Set(pendingTrades(state).map(t=>t.id));
  document.querySelectorAll('[data-closed-trade]').forEach(card=>{const id=card.dataset.closedTrade;if(!id||!pending.has(id)||card.querySelector('.pending-review-badge'))return;const badges=card.querySelector('.closed-day-badges')||card.querySelector('div');const b=document.createElement('span');b.className='pending-review-badge';b.textContent='بانتظار المراجعة';badges.appendChild(b)});
}
function refresh(){badgeClosedLists();injectClosedDetail();injectDocDetail()}
let tm;function schedule(){clearTimeout(tm);tm=setTimeout(refresh,80)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('trading-os-review-change',schedule);window.addEventListener('trading-os-documentation-change',schedule);schedule();
