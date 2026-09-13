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

function polish(){
  const r=route();
  document.querySelectorAll('.v38-route-page').forEach(p=>p.classList.remove('v38-new-page','v38-accounts-page'));
  const page=document.querySelector('#app .page');
  if(r==='new'&&page){page.classList.add('v38-route-page','v38-new-page')}
  if(r==='accounts'&&page){page.classList.add('v38-route-page');polishAccounts(page)}
  if(r==='dashboard'&&page)polishDashboard(page);
  const an=document.querySelector('.an-page');if(r==='analytics'&&an)an.classList.add('v38-analytics-page');
}

let timer;function schedule(){clearTimeout(timer);timer=setTimeout(polish,40)}
window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('storage',e=>{if(e.key===STATE_KEY)schedule()});
window.addEventListener('trading-os-account-identifiers-change',schedule);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
schedule();
