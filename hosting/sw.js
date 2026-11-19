'use strict';
const HOST_PROTOCOL=2,SHELL_ID='__SHELL_ID__',SHELL_FILES=__SHELL_FILES__;
const BASE=self.registration.scope,PREFIX='kontur@'+new URL(BASE).pathname+'@';
const META=PREFIX+'host-meta-v2',SHELL_CACHE=PREFIX+'shell:'+SHELL_ID;
const absolute=path=>new URL(path,BASE).href;
const activeKey=channel=>absolute('__host_active_'+channel);
const channelCache=release=>PREFIX+'channel:'+release.channel+':'+release.buildId;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const jobs=new Map();
const stagedReleases=new Map();
const jsonResponse=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const shellKey=absolute('__host_active_shell');
const handoffKey=absolute('__host_legacy_handoff');
function validChannel(value){return value==='stable'||value==='test';}
function validRelease(release,channel){
 return release&&release.channel===channel&&/^[0-9a-f]{20,64}$/.test(release.buildId)&&/^\d+\.\d{3}(?:\.\d{2,})?$/.test(release.version)&&/^apps\/[a-z0-9-]+\.html$/.test(release.entry)&&Array.isArray(release.files)&&release.files.length>=3&&release.files.every(f=>/^(?:assets\/[a-zA-Z0-9._-]+|apps\/[a-z0-9-]+\.html)$/.test(f.url)&&/^[0-9a-f]{64}$/.test(f.sha256));
}
async function latest(channel){
 if(!validChannel(channel))throw Error('Unknown channel');
 const key=absolute('__host_latest_'+channel);
 try{
  const response=await fetch(absolute('releases/'+channel+'.json'),{cache:'no-store'});
  if(!response.ok)throw Error('Channel release unavailable');
  const release=await response.json();
  if(!validRelease(release,channel))throw Error('Invalid channel release');
  stagedReleases.set(channel,release);
  await(await caches.open(META)).put(key,jsonResponse(release));
  return release;
 }catch(error){
  if(stagedReleases.has(channel))return stagedReleases.get(channel);
  const stored=await(await caches.open(META)).match(key);
  if(stored)return stored.json();throw error;
 }
}
async function getActive(channel){const response=await(await caches.open(META)).match(activeKey(channel));return response?response.json():null;}
async function setActive(release){await(await caches.open(META)).put(activeKey(release.channel),new Response(JSON.stringify(release),{headers:{'Content-Type':'application/json'}}));}
async function stageFiles(name,files,progress){
 const cache=await caches.open(name);
 try{
  let done=0;
  for(const file of files){
   const key=absolute(file.url);let response=await cache.match(key)||await caches.match(key);
   if(response&&await digest(await response.clone().arrayBuffer())!==file.sha256)response=null;
   if(!response){response=await fetch(key,{cache:'no-store'});if(!response.ok||await digest(await response.clone().arrayBuffer())!==file.sha256)throw Error('Incomplete release file: '+file.url);}
   await cache.put(key,response);progress?.(++done,files.length);
  }
 }catch(error){await caches.delete(name);throw Error('Не удалось полностью скачать версию. Повтори обновление.');}
 return cache;
}
async function stageRelease(release,progress){
 const key=channelCache(release);if(jobs.has(key))return jobs.get(key);
 const task=stageFiles(key,release.files,progress);jobs.set(key,task);
 try{await task;}finally{jobs.delete(key);}
 return release;
}
async function ensureChannel(channel,progress){
 if(!validChannel(channel))throw Error('Unknown channel');
 let active=await getActive(channel);
 if(active){
  const cache=await caches.open(channelCache(active));
  if(await cache.match(absolute(active.entry)))return active;
  await stageRelease(active,progress);return active;
 }
 active=await latest(channel);await stageRelease(active,progress);await setActive(active);return active;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 await stageFiles(SHELL_CACHE,SHELL_FILES);
 const stable=await latest('stable');await stageRelease(stable);
 await(await caches.open(SHELL_CACHE)).put(absolute('__host_installed_stable'),jsonResponse(stable));
 // Only activation may establish a pointer; an installing worker cannot change
 // the game selected by existing clients.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const installed=await(await caches.open(SHELL_CACHE)).match(absolute('__host_installed_stable'));
 const stable=installed?await installed.json():await latest('stable');
 if(!await getActive('stable'))await setActive(stable);
 // A shell change can alter its adapter asset hashes without changing either
 // game. Adopt those verified adapters in the same activation, so the user
 // does not get a second "new 1.029" prompt after updating the loader.
 for(const channel of ['stable']){
  const active=await getActive(channel),next=stable;
  if(active&&next.sourceBuildId&&active.sourceBuildId===next.sourceBuildId&&active.version===next.version&&active.buildId!==next.buildId){
   await stageRelease(next);await setActive(next);
  }
 }
 await(await caches.open(META)).put(shellKey,jsonResponse(SHELL_ID));
 await self.clients.claim();
 // claim() changes the controller, not the already loaded document. An old
 // page's first-controller handler deliberately does not reload that document.
 // Complete that handoff explicitly, after its usual save/battle handshake.
 const cache=await caches.open(SHELL_CACHE),saved=await cache.match(handoffKey);
 const prepared=new Set(saved?await saved.json():[]);
 for(const client of await clientsHere()){
  if(prepared.has(client.id))continue;
  const info=await askClient(client,{type:'HOST_CLIENT_INFO'},700);
  if(info.protocol===HOST_PROTOCOL)continue;
  const answer=await askClient(client,{type:'PREPARE_UPDATE',runFormats:stable.runFormats});
  if(answer.ready&&answer.protocol!==HOST_PROTOCOL)prepared.add(client.id);
 }
 await cache.put(handoffKey,jsonResponse([...prepared]));
 // Navigation fetches wait for activation to finish. Queue a separate message
 // instead of awaiting navigate() inside activate (which would deadlock).
 self.registration.active.postMessage({type:'COMPLETE_LEGACY_HANDOFF'});
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==new URL(BASE).origin||!url.href.startsWith(BASE))return;
 const selected=['stable','test'].find(channel=>url.pathname===new URL('releases/'+channel+'.json',BASE).pathname);
 if(selected){
  event.respondWith((async()=>new Response(JSON.stringify(await latest(selected)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}))());return;
 }
 if(url.pathname===new URL('channels.json',BASE).pathname){
  // Compatibility for an already open old adapter. New documents never use it.
  event.respondWith((async()=>{try{return await fetch(request,{cache:'no-store'});}catch(error){return await(await caches.open(META)).match(absolute('__host_catalog'))||Response.error();}})());return;
 }
 if(['sw.js','release.json'].some(file=>url.pathname===new URL(file,BASE).pathname)){event.respondWith(fetch(request,{cache:'no-store'}));return;}
 event.respondWith((async()=>{
  if(request.mode==='navigate')return await(await caches.open(SHELL_CACHE)).match(absolute('index.html'))||fetch(request);
  const key=new URL(request.url);key.search='';
  return await caches.match(key.href)||fetch(request);
 })());
});
function askClient(client,message,timeout=3000){
 return new Promise(resolve=>{
  const pipe=new MessageChannel(),timer=setTimeout(()=>{pipe.port1.close();resolve({ready:false,channel:'legacy'});},timeout);
  pipe.port1.onmessage=event=>{clearTimeout(timer);pipe.port1.close();resolve(event.data||{ready:false});};
  try{client.postMessage(message,[pipe.port2]);}catch(_error){clearTimeout(timer);pipe.port1.close();resolve({ready:false,channel:'legacy'});}
 });
}
async function navigateLegacy(client){
 // The client may already have reloaded in its controllerchange handler.
 const current=await self.clients.get(client.id);if(!current)return;
 try{await current.navigate(BASE);}catch(_error){/* A closed/navigating tab needs no second navigation. */}
}
async function completeLegacyHandoff(){
 const cache=await caches.open(SHELL_CACHE),response=await cache.match(handoffKey);
 if(!response)return;
 const ids=await response.json();await cache.delete(handoffKey);
 for(const id of ids){const client=await self.clients.get(id);if(client)await navigateLegacy(client);}
}
async function clientsHere(){return(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(BASE));}
async function applyChannel(channel,expected,progress){
 const target=await latest(channel);
 if(!validChannel(channel)||target.buildId!==expected)throw Error('Список версий изменился. Проверь обновления ещё раз.');
 await stageRelease(target,progress);
 const clients=await clientsHere(),answers=await Promise.all(clients.map(client=>askClient(client,{type:'PREPARE_CHANNEL_UPDATE',channel,runFormats:target.runFormats})));
 const ready=answers.every(answer=>answer.channel!==channel&&(answer.channel!=='legacy'||channel==='test')||answer.ready===true);
 if(!ready){for(const client of clients)client.postMessage({type:'CHANNEL_UPDATE_ABORTED',channel});throw Error('Заверши бой или закрой другие вкладки этой версии.');}
 await setActive(target);
 for(const client of clients)client.postMessage({type:'CHANNEL_UPDATED',channel,buildId:target.buildId});
 return target;
}
async function applyShell(){
 const stable=await getActive('stable')||await latest('stable'),test=await getActive('test'),clients=await clientsHere();
 const answers=await Promise.all(clients.map(client=>askClient(client,{type:'PREPARE_UPDATE',runFormats:stable.runFormats,channelFormats:{stable:stable.runFormats,...(test?{test:test.runFormats}:{})}})));
 if(!answers.every(answer=>answer.ready)){
  for(const client of clients)client.postMessage({type:'UPDATE_ABORTED'});
  throw Error('Заверши бой или закрой другие вкладки игры, затем обнови.');
 }
 const legacy=clients.filter((_client,index)=>answers[index].protocol!==HOST_PROTOCOL);
 const marker=await(await caches.open(META)).match(shellKey);
 if(marker&&await marker.json()===SHELL_ID){
  // A legacy updater can retain a reference to a worker that is active now.
  // skipWaiting() alone is then a no-op and leaves its stale notice in a loop.
  await self.clients.claim();
  for(const client of legacy)await navigateLegacy(client);
 }else{
  await(await caches.open(SHELL_CACHE)).put(handoffKey,jsonResponse(legacy.map(client=>client.id)));
  await self.skipWaiting();
 }
}
self.addEventListener('message',event=>{
 const message=event.data||{},port=event.ports[0],reply=value=>port?.postMessage({ok:true,value}),progress=(done,total)=>port?.postMessage({progress:{done,total}});
 event.waitUntil((async()=>{
  try{
   if(message.type==='COMPLETE_LEGACY_HANDOFF'){await completeLegacyHandoff();reply(true);return;}
   if(message.type==='HOST_PROTOCOL'){reply({protocol:HOST_PROTOCOL,shellId:SHELL_ID});return;}
   if(message.type==='GET_RELEASE'){
    const stable=await latest('stable');port?.postMessage({...stable,buildId:SHELL_ID,hostProtocol:HOST_PROTOCOL});return;
   }
   if(message.type==='ENSURE_CHANNEL'){reply(await ensureChannel(message.channel,progress));return;}
   if(message.type==='GET_CHANNEL'){reply(await getActive(message.channel));return;}
   if(message.type==='APPLY_CHANNEL'){reply(await applyChannel(message.channel,message.buildId,progress));return;}
   if(message.type==='APPLY_UPDATE'){await applyShell();reply(true);return;}
  }catch(error){port?.postMessage({ok:false,error:error.message});}
 })());
});
