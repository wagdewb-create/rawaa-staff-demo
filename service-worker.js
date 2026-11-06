/* RAWAA: fast, safe repeat launches. Only public app-shell files enter Cache Storage.
 * Authentication, workspace payloads and financial records are never cached. */
'use strict';
const CACHE='rawaa-shell-v232';
const ROOT=new URL('./',self.registration.scope);
const CLOUD=new URL('cloud.html',ROOT);
const SHELL=[
  './index.html','./cloud.html','./work.html','./manifest.webmanifest','./icon.svg',
  './staff.css?v=115','./easy-ui.css?v=215','./brand.css?v=226',
  './staff.js?v=229','./daily-batch.js','./weekly-report.js',
  './shift-planner.js?v=217','./daily-operations.js?v=222',
  './payroll-audit.js?v=230','./monthly-close.js?v=231','./easy-ui.js?v=226',
  './work-vault.js?v=116','./cloud-sync.js?v=223'
];
const STATIC_PATHS=new Set(SHELL.map(s=>new URL(s,ROOT).pathname));
const isPublicResponse=response=>response.ok&&!response.redirected&&response.type!=='opaque';

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // A temporarily unavailable optional asset should not prevent installation.
    await Promise.allSettled(SHELL.map(item=>cache.add(new URL(item,ROOT).toString())));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    // Old worker versions could cache GET /auth and /data responses: purge them.
    await Promise.all(names.filter(name=>
      (name.startsWith('rawaa-demo-')||name.startsWith('rawaa-shell-'))&&name!==CACHE
    ).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  // Do not intercept, cache, or serve stale authentication or payroll API results.
  if(/^\/(auth|data)(\/|$)/.test(url.pathname))return;

  if(request.mode==='navigate'&&(url.pathname===ROOT.pathname||url.pathname===CLOUD.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(CLOUD.toString());
      // Show the static interface immediately on repeat visits, even if Render
      // is cold-starting; all private data still loads through fresh API requests.
      if(cached)return cached;
      const response=await fetch(request);
      if(isPublicResponse(response)&&String(response.headers.get('content-type')||'').includes('text/html')){
        await cache.put(CLOUD.toString(),response.clone());
      }
      return response;
    })());
    return;
  }

  if(!STATIC_PATHS.has(url.pathname)||request.mode==='navigate')return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(isPublicResponse(response))await cache.put(request,response.clone());
    return response;
  })());
});