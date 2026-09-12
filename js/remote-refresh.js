import { getToken, fetchRemoteState } from './github-sync.js?v=23';

const STATE_KEY = 'trading-os-state-v1';

function ts(value){
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

export async function refreshFromRemoteIfNewer(){
  if(!getToken()) return {updated:false,reason:'NO_TOKEN'};
  try{
    const remote = await fetchRemoteState();
    const remoteState = remote?.state;
    if(!remoteState) return {updated:false,reason:'NO_REMOTE_STATE'};

    let localState = null;
    try { localState = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (_) {}

    const remoteUpdated = ts(remoteState.meta?.updatedAt);
    const localUpdated = ts(localState?.meta?.updatedAt);
    if(!localState || remoteUpdated > localUpdated){
      localStorage.setItem(STATE_KEY, JSON.stringify(remoteState));
      return {updated:true,remoteUpdated,localUpdated};
    }
    return {updated:false,reason:'LOCAL_IS_SAME_OR_NEWER',remoteUpdated,localUpdated};
  } catch (error){
    console.warn('Remote refresh skipped:', error);
    return {updated:false,reason:'ERROR',error};
  }
}
