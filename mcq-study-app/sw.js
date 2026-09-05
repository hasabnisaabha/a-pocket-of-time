const CACHE='mcq-study-v1';
const CORE=['./','./index.html','./styles.css','./manifest.webmanifest','./icon-192.svg','./icon-512.svg','./bundle.js'];
const CDN=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs','https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/tesseract.min.js','https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/worker.min.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async c=>{await c.addAll(CORE);for(const u of CDN){try{await c.add(u)}catch(_){}}} ).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(x=>x.put(e.request,copy));return r}).catch(()=>caches.match('./index.html'))));});