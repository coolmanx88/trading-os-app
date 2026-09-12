const CACHE='trading-os-v9';
const ASSETS=['./','./index.html','./assets/styles.css','./assets/analytics.css','./js/loader.js','./js/app.js.gz.b64','./js/engine.js','./js/store.js','./js/github-sync.js','./js/fee-ui-patch.js','./js/analytics.js','./data/state.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)));
});
