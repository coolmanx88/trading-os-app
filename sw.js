const CACHE='trading-os-v24';
const ASSETS=['./','./index.html','./assets/styles.css','./assets/analytics.css','./assets/ux-enhancements.css','./assets/equity-chart.css','./assets/trade-documentation.css','./assets/trade-ux-v2.css','./assets/closed-trade-router.css','./assets/chart-layout-v2.css','./assets/pending-review.css','./js/sync-hotfix.js','./js/loader.js','./js/remote-refresh.js','./js/app.js.gz.b64','./js/engine.js','./js/store.js','./js/github-sync.js','./js/fee-ui-patch.js','./js/analytics.js','./js/equity-chart.js','./js/dashboard-calendar.js','./js/trade-documentation.js','./js/review-lock.js','./js/trade-ux-v2.js','./js/closed-trade-router.js','./js/pending-review.js','./data/state.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  if(e.request.headers.has('Authorization'))return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
