import { refreshFromRemoteIfNewer } from './remote-refresh.js?v=23';

const APP_VERSION='23';

async function bootTradingOS(){
  await refreshFromRemoteIfNewer();
  const res = await fetch(`./js/app.js.gz.b64?v=${APP_VERSION}`, {cache:'reload'});
  if(!res.ok) throw new Error(`App bundle load failed: ${res.status}`);
  const b64 = (await res.text()).trim();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  if(typeof DecompressionStream === 'undefined') throw new Error('This browser does not support DecompressionStream. Use a current Chrome/Edge browser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  let code = await new Response(stream).text();
  const base = new URL('./js/', location.href);
  code = code
    .replace('from "./engine.js"', `from "${new URL(`engine.js?v=${APP_VERSION}`, base).href}"`)
    .replace('from "./store.js"', `from "${new URL(`store.js?v=${APP_VERSION}`, base).href}"`)
    .replace('from "./github-sync.js"', `from "${new URL(`github-sync.js?v=${APP_VERSION}`, base).href}"`);
  const url = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
  try { await import(url); }
  finally { setTimeout(()=>URL.revokeObjectURL(url), 1000); }
}
bootTradingOS().catch(err=>{
  console.error(err);
  document.getElementById('app').innerHTML = `<div style="padding:40px;color:#fff;font-family:Segoe UI,Arial">تعذر تشغيل Trading OS<br><small style="color:#9aa8b8">${String(err.message||err)}</small></div>`;
});
