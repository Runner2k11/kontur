'use strict';
const RELEASE=__RELEASE__;
const FILES=__PRECACHE__;
const BASE=self.registration.scope;
const PREFIX='kontur@'+new URL(BASE).pathname+'@';
const CACHE=PREFIX+RELEASE.buildId;
const absolute=path=>new URL(path,BASE).href;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{
  // Reuse immutable graphics from earlier releases; verify every complete file.
  for(const file of FILES){
   const key=absolute(file.url),old=file.url.startsWith('assets/')?await caches.match(key):null;
   let response=old;
   if(!response){
    const requestURL=new URL(key);
    if(!file.url.startsWith('assets/'))requestURL.searchParams.set('build',RELEASE.buildId);
    response=await fetch(requestURL,{cache:file.url.startsWith('assets/')?'default':'no-store'});
   }
   if(!response?.ok||await digest(await response.clone().arrayBuffer())!==file.sha256)throw Error('Incomplete release: '+file.url);
   await cache.put(key,response);
  }
 }catch(error){await caches.delete(CACHE);throw error;}
 // A newer version deliberately waits; the running battle keeps its old code.
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const names=(await caches.keys()).filter(name=>name.startsWith(PREFIX)&&name!==CACHE);
 const previous=names.at(-1);
 await Promise.all(names.filter(name=>name!==previous).map(name=>caches.delete(name)));
 await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||!url.href.startsWith(BASE))return;
 if(url.pathname===new URL('release.json',BASE).pathname||url.pathname===new URL('sw.js',BASE).pathname){
  event.respondWith(fetch(request,{cache:'no-store'}));return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(request.mode==='navigate')return await cache.match(absolute('index.html'))||fetch(request);
  return await cache.match(request,{ignoreSearch:true})||await caches.match(request,{ignoreSearch:true})||fetch(request);
 })());
});

function prepare(client){
 return new Promise(resolve=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>resolve(false),3000);
  channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.ready===true);};
  client.postMessage({type:'PREPARE_UPDATE',runFormats:RELEASE.runFormats},[channel.port2]);
 });
}
self.addEventListener('message',event=>{
 if(event.data?.type==='GET_RELEASE'){event.ports[0]?.postMessage(RELEASE);return;}
 if(event.data?.type!=='APPLY_UPDATE')return;
 event.waitUntil((async()=>{
  const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>client.url.startsWith(BASE));
  const ready=await Promise.all(clients.map(prepare));
  if(ready.every(Boolean))await self.skipWaiting();
  else for(const client of clients)client.postMessage({type:'UPDATE_ABORTED'});
 })());
});
