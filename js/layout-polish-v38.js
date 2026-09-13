const STATE_KEY='trading-os-state-v1';

function route(){return(location.hash||'#dashboard').slice(1).split('?')[0]}
function readState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{return{accounts:[]}}}

function addAccountNumbers(page){
  const rows=[...page.querySelectorAll('.table-wrap tbody tr')];
  const accounts=readState().accounts||[];
  rows.forEach((row,i)=>{
    const a=accounts[i],cell=row.cells?.[0];
    if(!a||!cell||cell.querySelector('.v38-account-number'))return;
    if(!a.accountNumber)return;
    const small=document.createElement('small');
    small.className='v38-account-number';
    small.textContent=a.accountNumber;
    cell.appendChild(small);
  });
}

function polishAccounts(page){
  page.classList.add('v38-accounts-page');
  const title=page.querySelector('.page-title');
  if(title&&!title.querySelector('[data-v38-account-ids]')){
    const add=title.querySelector('#add-accounts');
    const actions=document.createElement('div');actions.className='v38-page-actions';
    const btn=document.createElement('button');btn.type='button';btn.className='btn btn-secondary';btn.dataset.v38AccountIds='1';btn.textContent='أرقام الحسابات';
    actions.append(btn);if(add)actions.append(add);title.append(actions);
    btn.onclick=()=>{
      const panel=page.querySelector('[data-account-identifiers]');
      if(!panel)return;
      const open=panel.classList.toggle('v38-open');
      btn.classList.toggle('btn-blue',open);btn.textContent=open?'إخفاء أرقام الحسابات':'أرقام الحسابات';
      if(open)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    };
  }
  const panel=page.querySelector('[data-account-identifiers]');
  if(panel){panel.classList.add('v38-account-id-panel');}
  addAccountNumbers(page);
}

function polishDashboard(page){
  const dash=page?.querySelector('[data-dashboard-v2]');
  if(!dash)return;
  dash.classList.add('v38-dashboard','v39-dashboard');
  const title=page.querySelector('.page-title'),toolbar=dash.querySelector('.dv2-toolbar'),scope=toolbar?.querySelector('label');
  if(title&&scope){
    const old=title.querySelector('[data-v39-dashboard-scope]');
    if(old&&old!==scope)old.remove();
    scope.dataset.v39DashboardScope='1';
    scope.classList.add('v39-dashboard-scope');
    title.appendChild(scope);
    toolbar.classList.add('v39-empty-toolbar');
  }
}

function polishNewTrade(page){
  page.classList.add('v38-route-page','v38-new-page');
  const grid=page.querySelector(':scope > .grid-2.stack');
  if(!grid)return;

  const legacyTop=grid.querySelector(':scope > .v41-new-top');
  if(legacyTop){
    const legacyLeft=legacyTop.querySelector(':scope > .v41-new-left');
    const definition=legacyLeft?.children?.[0];
    const entry=legacyLeft?.children?.[1];
    const impact=[...legacyTop.children].find(el=>el!==legacyLeft);
    const accounts=grid.querySelector(':scope > .v41-target-accounts, :scope > .v42-target-accounts');
    if(definition&&entry&&impact&&accounts){
      grid.innerHTML='';
      grid.append(definition,accounts,entry,impact);
    }
  }

  const cards=[...grid.children].filter(el=>el.classList?.contains('card'));
  if(cards.length<4)return;
  const definition=cards[0],accounts=cards[1],entry=cards[2],impact=cards[3];
  grid.classList.remove('v41-new-grid');
  grid.classList.add('v42-new-grid');
  definition.classList.add('v42-trade-definition');
  entry.classList.add('v42-initial-entry');
  impact.classList.add('v42-trade-impact');
  accounts.classList.add('v42-target-accounts');
}

function cardByTitles(page,titles){
  const wanted=titles.map(x=>x.trim().toLowerCase());
  return[...page.querySelectorAll('.card')].find(card=>{
    const headings=[...card.querySelectorAll('h2,h3,.card-title')].map(h=>h.textContent.trim().toLowerCase());
    return headings.some(h=>wanted.includes(h));
  })||null;
}

function removeIfEmpty(el,page){
  if(!el||el===page||el.classList?.contains('v42-settings-grid'))return;
  const meaningful=[...el.children].filter(x=>!x.matches('script,style'));
  if(!meaningful.length)el.remove();
}

function polishSettings(page){
  page.classList.add('v42-settings-page');
  const importer=page.querySelector('[data-tv-csv-import-card],.csv-import-card');
  if(importer){
    importer.classList.add('v42-csv-import-card');
    const desc=importer.querySelector('h3 + p');
    if(desc)desc.remove();
    importer.querySelector('.csv-card-badges')?.remove();
  }
  if(page.querySelector(':scope > .v42-settings-grid'))return;

  const companies=cardByTitles(page,['الشركات','Companies']);
  const github=cardByTitles(page,['GitHub Data Repository']);
  const backup=cardByTitles(page,['Backup / Export']);
  if(!companies||!github||!backup)return;

  const oldParents=new Set([companies.parentElement,github.parentElement,backup.parentElement]);
  companies.classList.add('v42-companies-card');
  github.classList.add('v42-github-card');
  backup.classList.add('v42-backup-card');

  const layout=document.createElement('section');
  layout.className='v42-settings-grid';
  const left=document.createElement('div');
  left.className='v42-settings-companies';
  const right=document.createElement('div');
  right.className='v42-settings-sync';

  left.append(companies);
  right.append(github,backup);
  layout.append(left,right);

  const anchor=importer||page.querySelector('.page-title');
  if(anchor)anchor.insertAdjacentElement('afterend',layout);else page.prepend(layout);
  oldParents.forEach(p=>removeIfEmpty(p,page));
}

function polish(){
  const r=route();
  document.querySelectorAll('.v38-route-page').forEach(p=>p.classList.remove('v38-new-page','v38-accounts-page'));
  const page=document.querySelector('#app .page');
  if(r==='new'&&page)polishNewTrade(page);
  if(r==='accounts'&&page){page.classList.add('v38-route-page');polishAccounts(page)}
  if(r==='dashboard'&&page)polishDashboard(page);
  if(r==='settings'&&page)polishSettings(page);
  const an=document.querySelector('.an-page');if(r==='analytics'&&an)an.classList.add('v38-analytics-page');
}

let timer;function schedule(){clearTimeout(timer);timer=setTimeout(polish,40)}
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('storage',e=>{if(e.key===STATE_KEY)schedule()});
window.addEventListener('trading-os-account-identifiers-change',schedule);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();