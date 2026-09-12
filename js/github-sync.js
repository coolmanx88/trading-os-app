const CONFIG_KEY = "trading-os-github-config-v1";
const TOKEN_KEY = "trading-os-github-token-v2";
const LEGACY_TOKEN_KEY = "trading-os-github-token-v1";

const DEFAULT_CONFIG = {
  owner: "coolmanx88",
  repo: "trading-os-data",
  branch: "main",
  dataPath: "data/state.json"
};

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

export async function fetchRemoteState(cfg=getGitHubConfig(), token=getToken()) {
  if(!cfg.owner || !cfg.repo || !token) throw new Error("GitHub غير مرتبط بهذا الجهاز.");
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.dataPath}?ref=${encodeURIComponent(cfg.branch||"main")}`;
  const res=await fetch(url,{headers:headers(token)});
  if(!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const obj=await res.json();
  return {state:JSON.parse(base64ToUtf8(obj.content)), sha:obj.sha};
}

export async function pushRemoteState(state, cfg=getGitHubConfig(), token=getToken(), message="Update trading data") {
  const current=await fetchRemoteState(cfg,token);
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.dataPath}`;
  const body={message,content:utf8ToBase64(JSON.stringify(state,null,2)),sha:current.sha,branch:cfg.branch||"main"};
  const res=await fetch(url,{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!res.ok){ const t=await res.text(); throw new Error(`GitHub write failed: ${res.status} ${t.slice(0,180)}`); }
  return await res.json();
}

export async function testConnection(cfg=getGitHubConfig(), token=getToken()) {
  const r=await fetchRemoteState(cfg,token); return {ok:true,updatedAt:r.state.meta?.updatedAt||null};
}

export async function fetchRepoFile(path, cfg=getGitHubConfig(), token=getToken()) {
  if(!cfg.owner || !cfg.repo || !token) throw new Error("GitHub غير مرتبط بهذا الجهاز.");
  const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch||"main")}`;
  const res=await fetch(url,{headers:headers(token)});
  if(!res.ok) throw new Error(`GitHub file read failed: ${res.status}`);
  const obj=await res.json();
  const clean=(obj.content||"").replace(/\n/g,"");
  const binary=atob(clean); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return {bytes,name:path.split('/').pop(),sha:obj.sha};
}
