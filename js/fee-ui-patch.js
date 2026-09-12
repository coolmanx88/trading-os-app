import { INSTRUMENTS, replayTrade } from './engine.js';

const LOCAL_KEY = 'trading-os-state-v1';

function money(n){
  const x=Number(n||0);
  return `${x<0?'-':''}$${Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
}
function currentTrade(){
  try{
    const raw=localStorage.getItem(LOCAL_KEY); if(!raw) return null;
    const state=JSON.parse(raw);
    const h=(location.hash||'').slice(1); const [,q='']=h.split('?');
    const id=new URLSearchParams(q).get('id');
    return (state.trades||[]).find(t=>t.id===id)||null;
  }catch{return null;}
}
function relabel(){
  document.querySelectorAll('label').forEach(el=>{
    if(el.textContent.trim()==='Buffer / العمولة بالنقاط') el.textContent='Buffer / هامش الهدف بالنقاط';
  });
  document.querySelectorAll('.k,th').forEach(el=>{
    const t=el.textContent.trim();
    if(t==='Costs / Account') el.textContent='Fees & Comm. / Account';
    else if(t==='Costs') el.textContent='Fees & Comm.';
  });
}
function patchClosePreview(){
  const root=document.getElementById('modal-root');
  const preview=root?.querySelector('#close-preview');
  const input=root?.querySelector('#m-price');
  if(!preview||!input) return;
  const trade=currentTrade(); if(!trade) return;
  const r=replayTrade(trade); const cfg=INSTRUMENTS[trade.instrument];
  if(!cfg||!r.qty) return;
  const update=()=>{
    const price=Number(input.value||0);
    const points=trade.direction==='LONG'?price-r.avgEntry:r.avgEntry-price;
    const gross=points*r.qty*cfg.pointValue;
    const feePerSide=Number(trade.feePerContractSide ?? cfg.feePerContractSide ?? 0);
    const fees=feePerSide*r.qty*2;
    const net=gross-fees;
    preview.innerHTML=`Gross: <strong>${money(gross)}</strong> · Fees & Comm.: <strong>${money(fees)}</strong> · Net: <strong class="${net>=0?'positive':'negative'}">${money(net)}</strong> / Account`;
  };
  if(!input.dataset.feePatch){
    input.dataset.feePatch='1';
    input.addEventListener('input',()=>setTimeout(update,0));
    root.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>setTimeout(update,0)));
  }
  setTimeout(update,0);
}
function apply(){ relabel(); patchClosePreview(); }
new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('hashchange',()=>setTimeout(apply,0));
setTimeout(apply,300);
