'use strict';
const HOST_PROTOCOL=2,SHELL_ID='__SHELL_ID__',SHELL_FILES=__SHELL_FILES__;
const BASE=self.registration.scope,PREFIX='kontur@'+new URL(BASE).pathname+'@';
const META=PREFIX+'host-meta-v2',SHELL_CACHE=PREFIX+'shell:'+SHELL_ID;
const absolute=path=>new URL(path,BASE).href;
const activeKey=channel=>absolute('__host_active_'+channel);
const channelCache=release=>PREFIX+'channel:'+release.channel+':'+release.buildId;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const jobs=new Map();
let stagedCatalog=null;
function validChannel(value){return value==='stable'||value==='test';}
function validRelease(release,channel){
 return release&&release.channel===channel&&/^[0-9a-f]{20,64}$/.test(release.buildId)&&/^\d+\.\d{3}(?:\.\d{2,})?$/.test(release.version)&&/^apps\/[a-z0-9-]+\.html$/.test(release.entry)&&Array.isArray(release.files)&&release.files.length>=3&&release.files.every(f=>/^(?:assets\/[a-zA-Z0-9._-]+|apps\/[a-z0-9-]+\.html)$/.test(f.url)&&/^[0-9a-f]{64}$/.test(f.sha256));
}
async function catalog(){
 try{
  const response=await fetch(absolute('channels.json'),{cache:'no-store'});
  if(!response.ok)throw Error('Channel catalog unavailable');
  const data=await response.json();
  if(data.schema!==2||!['stable','test'].every(c=>validRelease(data[c],c)))throw Error('Invalid channel catalog');
  stagedCatalog=data;
  await(await caches.open(META)).put(absolute('__host_catalog'),new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
  return data;
 }catch(error){
  if(stagedCatalog)return stagedCatalog;
  const stored=await(await caches.open(META)).match(absolute('__host_catalog'));
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
 const data=await catalog();active=data[channel];await stageRelease(active,progress);await setActive(active);return active;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 await stageFiles(SHELL_CACHE,SHELL_FILES);
 const data=await catalog();await stageRelease(data.stable);
 await(await caches.open(SHELL_CACHE)).put(absolute('__host_installed_catalog'),new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
 // Only activation may establish a pointer; an installing worker cannot change
 // the game selected by existing clients.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const installed=await(await caches.open(SHELL_CACHE)).match(absolute('__host_installed_catalog'));
 const data=installed?await installed.json():await catalog();
 await(await caches.open(META)).put(absolute('__host_catalog'),new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
 if(!await getActive('stable'))await setActive(data.stable);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==new URL(BASE).origin||!url.href.startsWith(BASE))return;
 if(url.pathname===new URL('channels.json',BASE).pathname){
  event.respondWith((async()=>new Response(JSON.stringify(await catalog()),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}))());return;
 }
 if(['sw.js','release.json'].some(file=>url.pathname===new URL(file,BASE).pathname)){event.respondWith(fetch(request,{cache:'no-store'}));return;}
 event.respondWith((async()=>{
  if(request.mode==='navigate')return await(await caches.open(SHELL_CACHE)).match(absolute('index.html'))||fetch(request);
  const key=new URL(request.url);key.search='';
  return await caches.match(key.href)||fetch(request);
 })());
});
function askClient(client,message){
 return new Promise(resolve=>{
  const pipe=new MessageChannel(),timer=setTimeout(()=>{pipe.port1.close();resolve({ready:false,channel:'legacy'});},3000);
  pipe.port1.onmessage=event=>{clearTimeout(timer);pipe.port1.close();resolve(event.data||{ready:false});};
  client.postMessage(message,[pipe.port2]);
 });
}
async function clientsHere(){return(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(BASE));}
async function applyChannel(channel,expected,progress){
 const data=await catalog(),target=data[channel];
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
 const data=await catalog(),stable=await getActive('stable')||data.stable,test=await getActive('test')||data.test,clients=await clientsHere();
 const answers=await Promise.all(clients.map(client=>askClient(client,{type:'PREPARE_UPDATE',runFormats:stable.runFormats,channelFormats:{stable:stable.runFormats,test:test.runFormats}})));
 if(answers.every(answer=>answer.ready))await self.skipWaiting();
 else for(const client of clients)client.postMessage({type:'UPDATE_ABORTED'});
}
self.addEventListener('message',event=>{
 const message=event.data||{},port=event.ports[0],reply=value=>port?.postMessage({ok:true,value}),progress=(done,total)=>port?.postMessage({progress:{done,total}});
 event.waitUntil((async()=>{
  try{
   if(message.type==='HOST_PROTOCOL'){reply({protocol:HOST_PROTOCOL});return;}
   if(message.type==='GET_RELEASE'){
    const data=await catalog();port?.postMessage({...data.stable,buildId:SHELL_ID,hostProtocol:HOST_PROTOCOL});return;
   }
   if(message.type==='ENSURE_CHANNEL'){reply(await ensureChannel(message.channel,progress));return;}
   if(message.type==='GET_CHANNEL'){reply(await getActive(message.channel));return;}
   if(message.type==='APPLY_CHANNEL'){reply(await applyChannel(message.channel,message.buildId,progress));return;}
   if(message.type==='APPLY_UPDATE'){await applyShell();reply(true);return;}
  }catch(error){port?.postMessage({ok:false,error:error.message});}
 })());
});
