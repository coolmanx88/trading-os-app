const LOCAL_KEY = "trading-os-state-v1";
const PENDING_KEY = "trading-os-pending-v1";

export function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

export async function loadInitialState() {
  const localRaw = localStorage.getItem(LOCAL_KEY);
  const pending = localStorage.getItem(PENDING_KEY) === "1";
  let remote = null;
  try {
    const res = await fetch(`./data/state.json?ts=${Date.now()}`, {cache:"no-store"});
    if (res.ok) remote = await res.json();
  } catch (_) {}
  if (pending && localRaw) return JSON.parse(localRaw);
  if (localRaw && remote) {
    const local = JSON.parse(localRaw);
    const lt = new Date(local.meta?.updatedAt || 0).getTime();
    const rt = new Date(remote.meta?.updatedAt || 0).getTime();
    return lt > rt ? local : remote;
  }
  if (localRaw) return JSON.parse(localRaw);
  if (remote) return remote;
  throw new Error("تعذر تحميل بيانات النظام الأساسية.");
}

export function saveLocal(state, pending=true) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  localStorage.setItem(PENDING_KEY, pending ? "1" : "0");
}

export function hasPendingSync(){ return localStorage.getItem(PENDING_KEY) === "1"; }
export function markSynced(){ localStorage.setItem(PENDING_KEY,"0"); }
export function clearLocal(){ localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(PENDING_KEY); }
