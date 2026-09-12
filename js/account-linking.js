export const normalizeAccountNumber=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');

export function accountByNumber(state,companyId,sourceAccount){
  const wanted=normalizeAccountNumber(sourceAccount);if(!wanted)return null;
  return (state.accounts||[]).find(a=>a.companyId===companyId&&normalizeAccountNumber(a.accountNumber)===wanted)||null;
}

export function mappingForAccount(source,state,companyId){
  const exact=accountByNumber(state,companyId,source);if(exact)return exact.id;
  const map=state.settings?.tradovateAccountMap||{};
  return map[`${companyId}:${source}`]||(companyId==='CO-TRADEIFY'?map[`Tradeify:${source}`]:'')||'';
}

export function accountLabelWithNumber(a){
  const base=`${a.stage||'—'} · ${a.sizeK||'—'}K · #${a.sequence||'—'} · ${a.status||'—'}`;
  return a.accountNumber?`${base} · ${a.accountNumber}`:base;
}

export function persistAccountMappings(state,map,companyId){
  state.settings=state.settings||{};
  state.settings.tradovateAccountMap=state.settings.tradovateAccountMap||{};
  for(const [src,id] of Object.entries(map)){
    if(!id)continue;
    state.settings.tradovateAccountMap[`${companyId}:${src}`]=id;
    const a=(state.accounts||[]).find(x=>x.id===id&&x.companyId===companyId);
    if(a&&!normalizeAccountNumber(a.accountNumber))a.accountNumber=String(src||'').trim();
  }
}

export function mappingOrigin(source,state,companyId){
  if(accountByNumber(state,companyId,source))return 'accountNumber';
  const map=state.settings?.tradovateAccountMap||{};
  if(map[`${companyId}:${source}`]||(companyId==='CO-TRADEIFY'&&map[`Tradeify:${source}`]))return 'savedMap';
  return 'none';
}
