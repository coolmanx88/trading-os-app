function route(){return(location.hash||'#dashboard').slice(1).split('?')[0]}

function findPage(){return document.querySelector('#app .page')}

function findCard(page,selector,titles){
  const direct=page.querySelector(selector);if(direct)return direct;
  const wanted=titles.map(x=>x.trim().toLowerCase());
  return[...page.querySelectorAll('.card')].find(card=>{
    const heads=[...card.querySelectorAll('h2,h3,.card-title')].map(h=>h.textContent.trim().toLowerCase());
    return heads.some(h=>wanted.includes(h));
  })||null;
}

function apply(){
  if(route()!=='new')return;
  const page=findPage();if(!page||page.querySelector(':scope > .v45-new-trade-layout'))return;

  const definition=findCard(page,'.v42-trade-definition,.v41-trade-definition',['تعريف الصفقة','Trade Definition','Master Trade']);
  const entry=findCard(page,'.v42-initial-entry,.v41-initial-entry',['الدخول الأولي','Initial Entry']);
  const accounts=findCard(page,'.v42-target-accounts,.v41-target-accounts',['الحسابات المستهدفة','Target Accounts']);
  const impact=findCard(page,'.v42-trade-impact,.v41-trade-impact',['تأثير الصفقة','Trade Impact']);
  if(!definition||!entry||!accounts||!impact)return;

  const oldContainer=definition.closest('.grid-2.stack,.v42-new-grid,.v41-new-grid');
  if(!oldContainer)return;

  const layout=document.createElement('section');
  layout.className='v45-new-trade-layout';
  const impactCol=document.createElement('div');
  impactCol.className='v45-impact-column';
  const tradeCol=document.createElement('div');
  tradeCol.className='v45-trade-column';

  impactCol.append(impact);
  tradeCol.append(definition,entry,accounts);
  layout.append(impactCol,tradeCol);
  oldContainer.replaceWith(layout);
}

let scheduled=false;
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;apply()})}
window.addEventListener('load',schedule);
window.addEventListener('hashchange',schedule);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
