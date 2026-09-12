import {
  getGitHubConfig,
  setGitHubConfig,
  getToken,
  setToken,
  pushRemoteState,
  testConnection
} from './github-sync.js?v=23';

const STATE_KEY='trading-os-state-v1';
const PENDING_KEY='trading-os-pending-v1';
const VERSION='23.1';

window.__TRADING_OS_SYNC_HOTFIX_VERSION=VERSION;

function setChip(status,text){
  const el=document.getElementById('sync-chip');
  if(!el)return;
  el.className=`sync-chip ${status}`;
  el.textContent=text;
}

function syncFormSettings(){
  const owner=document.getElementById('g-owner')?.value?.trim();
  const repo=document.getElementById('g-repo')?.value?.trim();
  const branch=document.getElementById('g-branch')?.value?.trim();
  const dataPath=document.getElementById('g-path')?.value?.trim();
  if(owner||repo||branch||dataPath){
    const current=getGitHubConfig();
    setGitHubConfig({
      owner:owner||current.owner,
      repo:repo||current.repo,
      branch:branch||current.branch||'main',
      dataPath:dataPath||current.dataPath||'data/state.json'
    });
  }
  const token=document.getElementById('g-token')?.value?.trim();
  if(token)setToken(token);
}

function readLocalState(){
  const raw=localStorage.getItem(STATE_KEY);
  if(!raw)throw new Error('لا توجد بيانات محلية للمزامنة.');
  try{return JSON.parse(raw)}catch{throw new Error('تعذر قراءة بيانات Trading OS المحلية.');}
}

async function runSync(btn){
  syncFormSettings();
  const cfg=getGitHubConfig(),token=getToken();
  if(!cfg.owner||!cfg.repo||!token){
    alert('GitHub غير مرتبط بهذا الجهاز. افتح الإعدادات وتأكد من الـToken.');
    return;
  }
  const state=readLocalState();
  const oldDisabled=btn?.disabled;
  if(btn)btn.disabled=true;
  setChip('pending',`Saving… v${VERSION}`);
  try{
    const result=await pushRemoteState(state,cfg,token,'Sync trading data');
    const merged=result?.mergedState||state;
    localStorage.setItem(STATE_KEY,JSON.stringify(merged));
    localStorage.setItem(PENDING_KEY,'0');
    setChip('ok',`Synced · v${VERSION}`);
    window.dispatchEvent(new CustomEvent('trading-os-sync-complete',{detail:{version:VERSION,retries:result?.conflictRetries||0}}));
  }catch(err){
    setChip('error',`Sync error · v${VERSION}`);
    const msg=String(err?.message||err||'Unknown sync error');
    console.error('[Trading OS Sync Hotfix]',err);
    alert(`Sync v${VERSION}\n${msg}`);
  }finally{
    if(btn)btn.disabled=!!oldDisabled;
  }
}

async function runTest(btn){
  syncFormSettings();
  const oldDisabled=btn?.disabled;
  if(btn)btn.disabled=true;
  try{
    const r=await testConnection();
    alert(`GitHub connection OK · Sync v${VERSION}\nآخر تحديث: ${r.updatedAt||'—'}`);
  }catch(err){
    alert(`GitHub connection test v${VERSION}\n${String(err?.message||err)}`);
  }finally{
    if(btn)btn.disabled=!!oldDisabled;
  }
}

document.addEventListener('click',e=>{
  const btn=e.target?.closest?.('#sync-now,#push-github,#test-github');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  if(btn.id==='test-github')runTest(btn);
  else runSync(btn);
},true);
