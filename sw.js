const CACHE='budget-shell-v1';
const SHELL=['/','/index.html','/styles.css','/app.js','/model.js','/ai-client.js','/auth.js','/cloud-sync.js','/redirect.js','/pwa.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('budget-shell-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const {request}=event,url=new URL(request.url);
  // Only fixed public files. Never intercept APIs, authentication or user data.
  if(request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname)||url.search)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(url.pathname);
    if(cached)return cached;
    return fetch(request);
  })());
});
