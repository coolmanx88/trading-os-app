const CONFIG_KEY = "trading-os-github-config-v1";
const TOKEN_KEY = "trading-os-github-token-v2";
const LEGACY_TOKEN_KEY = "trading-os-github-token-v1";

const DEFAULT_CONFIG = {
  owner: "coolmanx88",
  repo: "trading-os-data",
  branch: "main",
  dataPath: "data/state.json"
};

let writeQueue = Promise.resolve();

export function getGitHubConfig(){
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch (_) {}
  if (!cfg.owner || cfg.owner === "anasx88") cfg.owner = DEFAULT_CONFIG.owner;
  if (!cfg.repo) cfg.repo = DEFAULT_CONFIG.repo;
  return {...DEFAULT_CONFIG, ...cfg, owner: cfg.owner || DEFAULT_CONFIG.owner, repo: cfg.repo || DEFAULT_CONFIG.repo};
}
export function setGitHubConfig(cfg){
  localStorage.setItem(CONFIG_KEY, JSON.stringify({...DEFAULT_CONFIG, ...cfg}));
}
export function getToken(){
  const persistent = localStorage.getItem(TOKEN_KEY) || "";
  if (persistent) return persistent;
  const legacy = sessionStorage.getItem(LEGACY_TOKEN_KEY) || "";
  if (legacy) {
    localStorage.setItem(TOKEN_KEY, legacy);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    return legacy;
  }
  return "";
}
export function setToken(token){
  const value = String(token || "").trim();
  if (value) localStorage.setItem(TOKEN_KEY, value);
}
export function clearToken(){
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_TOKEN_KEY);
}

function headers(token){
  return {"Accept":"application/vnd.github+json","Authorization":`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28"};
}
function utf8ToBase64(str){
  const bytes = new TextEncoder().encode(str); let binary="";
  bytes.forEach(b=>binary += String.fromCharCode(b)); return btoa(binary);
}
function base64ToUtf8(b64){
  const clean=b64.replace(/\n/g,""); const binary=atob(clean); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return new TextDecoder().decode(bytes);
}
function clone(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
function isObj(x){ return x && typeof x === "object" && !Array.isArray(x); }
function timeMs(x){ const n=Date.parse(x||""); return Number.isFinite(n)?n:0; }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchWithRetry(url, options={}, attempts=3, phase='request'){
  let lastError=null;
  for(let attempt=1; attempt<=attempts; attempt++){
    try{
      return await fetch(url, options);
    }catch(err){
      lastError=err;
      if(attempt<attempts) await sleep(250*attempt);
    }
  }
  const detail=String(lastError?.message||lastError||"Failed to fetch");
  throw new Error(`GitHub ${phase} network failed: ${detail}`);
}

function mergeArrays(remote=[], local=[]){
  if(!Array.isArray(remote)) remote=[];
  if(!Array.isArray(local)) local=[];
  if(!remote.length) return clone(local);
  if(!local.length) return clone(remote);

  const primitive = [...remote,...local].every(x=>x==null || ["string","number","boolean"].includes(typeof x));
  if(primitive) return [...new Set([...remote,...local])];

  const allWithId = [...remote,...local].every(x=>isObj(x) && x.id);
  if(allWithId){
    const map=new Map(remote.map(x=>[x.id,clone(x)]));
    for(const item of local){
      map.set(item.id, map.has(item.id) ? mergeObjects(map.get(item.id),item) : clone(item));
    }
    return [...map.values()];
  }

  return clone(local);
}
function mergeObjects(remote,local){
  if(!isObj(remote)) return clone(local);
  if(!isObj(local)) return clone(remote);
  const out=clone(remote);
  for(const [k,v] of Object.entries(local)){
    const rv=out[k];
    if(Array.isArray(v)) out[k]=mergeArrays(Array.isArray(rv)?rv:[],v);
    else if(isObj(v)) out[k]=mergeObjects(isObj(rv)?rv:{},v);
    else if(k==='uploadStatus' && rv==='uploaded' && v!=='uploaded') out[k]=rv;
    else if(k==='uploadedAt' && rv && !v) out[k]=rv;
    else out[k]=v;
  }
  return out;
}
function mergeById(remote=[],local=[]){
  const map=new Map((remote||[]).filter(Boolean).map(x=>[x.id,clone(x)]));
  for(const item of local||[]){
    if(!item?.id) continue;
    map.set(item.id,map.has(item.id)?mergeObjects(map.get(item.id),item):clone(item));
  }
  return [...map.values()];
}
function mergeStates(remote={},local={}){
  const out=mergeObjects(remote,local);
  out.companies=mergeById(remote.companies,local.companies);
  out.accounts=mergeById(remote.accounts,local.accounts);
  out.trades=mergeById(remote.trades,local.trades);
  if(Array.isArray(remote.dailySessions)||Array.isArray(local.dailySessions)){
    const combined=[...(remote.dailySessions||[]),...(local.dailySessions||[])];
    out.dailySessions=combined.every(x=>x?.id)?mergeById(remote.dailySessions,local.dailySessions):clone(local.dailySessions?.length?local.dailySessions:remote.dailySessions||[]);
  }
  out.meta=mergeObjects(remote.meta||{},local.meta||{});
  const newest=Math.max(timeMs(remote.meta?.updatedAt),timeMs(local.meta?.updatedAt),Date.now());
  out.meta.updatedAt=new Date(newest).toISOString();
  return out;
}

export async function fetchRemoteState(cfg=getGitHubConfig(), token=getToken()) {
  if(!cfg.owner || !cfg.repo || !token) throw new Error("GitHub غير مرتبط بهذا الجهاز.");
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.dataPath}?ref=${encodeURIComponent(cfg.branch||"main")}`;
  const res=await fetchWithRetry(url,{headers:headers(token)},3,'READ');
  if(!res.ok) throw new Error(`GitHub READ failed: ${res.status}`);
  const obj=await res.json();
  return {state:JSON.parse(base64ToUtf8(obj.content)), sha:obj.sha};
}

async function pushRemoteStateImpl(state, cfg, token, message){
  if(!cfg.owner || !cfg.repo || !token) throw new Error("GitHub غير مرتبط بهذا الجهاز.");
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.dataPath}`;
  let lastError=null;

  for(let attempt=1;attempt<=4;attempt++){
    const current=await fetchRemoteState(cfg,token);
    const merged=mergeStates(current.state,state);
    const body={message,content:utf8ToBase64(JSON.stringify(merged,null,2)),sha:current.sha,branch:cfg.branch||"main"};
    const res=await fetchWithRetry(url,{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify(body)},2,'WRITE');
    if(res.ok){
      const result=await res.json();
      return {...result, mergedState:merged, conflictRetries:attempt-1};
    }
    const text=await res.text();
    lastError=new Error(`GitHub WRITE failed: ${res.status} ${text.slice(0,240)}`);
    if(res.status!==409) throw lastError;
    await sleep(150*attempt);
  }
  throw lastError || new Error("GitHub WRITE failed after conflict retries.");
}

export function pushRemoteState(state, cfg=getGitHubConfig(), token=getToken(), message="Update trading data") {
  const job=()=>pushRemoteStateImpl(clone(state),cfg,token,message);
  const run=writeQueue.then(job,job);
  writeQueue=run.catch(()=>{});
  return run;
}

export async function testConnection(cfg=getGitHubConfig(), token=getToken()) {
  const r=await fetchRemoteState(cfg,token); return {ok:true,updatedAt:r.state.meta?.updatedAt||null};
}

export async function fetchRepoFile(path, cfg=getGitHubConfig(), token=getToken()) {
  if(!cfg.owner || !cfg.repo || !token) throw new Error("GitHub غير مرتبط بهذا الجهاز.");
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch||"main")}`;
  const res=await fetchWithRetry(url,{headers:headers(token)},3,'FILE READ');
  if(!res.ok) throw new Error(`GitHub FILE READ failed: ${res.status}`);
  const obj=await res.json();
  const clean=(obj.content||"").replace(/\n/g,"");
  const binary=atob(clean); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return {bytes,name:path.split('/').pop(),sha:obj.sha};
}
