/* One document address, independently cached game releases. */
(async()=>{
 'use strict';
 const base=new URL('./',location.href),selectionKey='kontur_host_channel_v1',testPrefix='kontur_preview_v1:';
 const memory=new Map();
 const fallback={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]??null,get length(){return memory.size;}};
 let raw,tab;
 try{raw=localStorage;raw.getItem(selectionKey);}catch(_error){raw=fallback;}
 try{tab=sessionStorage;tab.getItem(selectionKey);}catch(_error){tab=fallback;}
 const chosen=tab.getItem(selectionKey)||raw.getItem(selectionKey),channel=chosen==='test'?'test':'stable';
 tab.setItem(selectionKey,channel);
 const prefix=channel==='test'?testPrefix:'';
 const keys=()=>Array.from({length:raw.length},(_,i)=>raw.key(i)).filter(k=>k&&(prefix?k.startsWith(prefix):k.startsWith('kontur_')&&!k.startsWith('kontur_host_')&&!k.startsWith(testPrefix)));
 const storage=Object.freeze({
  getItem:key=>raw.getItem(prefix+key),setItem:(key,value)=>raw.setItem(prefix+key,String(value)),removeItem:key=>raw.removeItem(prefix+key),
  key:index=>keys()[index]?.slice(prefix.length)??null,clear:()=>keys().forEach(key=>raw.removeItem(key)),get length(){return keys().length;}
 });
 const status=message=>{const el=document.getElementById('hostStatus');if(el)el.textContent=message;};
 const env=window.KONTUR_HOST={protocol:2,base,channel,storage,raw,tab,testPrefix,selectionKey,registration:null,supportsChannels:false,shellId:null,ready:false,release:null};
 env.select=next=>{if(!['stable','test'].includes(next))throw Error('Unknown channel');raw.setItem(selectionKey,next);tab.setItem(selectionKey,next);};
 env.request=(worker,type,data={},timeout=90000)=>new Promise((resolve,reject)=>{
  if(!worker){reject(Error('Офлайн-загрузчик ещё не готов.'));return;}
  const pipe=new MessageChannel(),timer=setTimeout(()=>{pipe.port1.close();reject(Error('Не удалось дождаться загрузчика.'));},timeout);
  pipe.port1.onmessage=event=>{
   const reply=event.data;
   if(reply?.progress){status('Загрузка '+(channel==='test'?'тестовой версии':'игры')+' · '+reply.progress.done+' / '+reply.progress.total);env.onProgress?.(reply.progress);return;}
   clearTimeout(timer);pipe.port1.close();if(reply?.ok===false)reject(Error(reply.error||'Не удалось загрузить версию.'));else resolve(reply?.value??reply);
  };
  worker.postMessage({type,...data},[pipe.port2]);
 });
 env.worker=()=>navigator.serviceWorker?.controller||env.registration?.active;
 env.latest=async(selected=channel)=>{
  if(!['stable','test'].includes(selected))throw Error('Неверная версия.');
  const response=await fetch(new URL('releases/'+selected+'.json',base),{cache:'no-store'});
  if(!response.ok)throw Error('Не удалось проверить обновление этой версии.');
  const release=await response.json();
  if(release.channel!==selected||!release.buildId||!release.entry)throw Error('Неверное описание версии.');
  return release;
 };
 // A root page can answer update coordination even before its game is loaded.
 if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='HOST_CLIENT_INFO')event.ports[0]?.postMessage({channel,protocol:2});
  if(!env.ready&&['PREPARE_CHANNEL_UPDATE','PREPARE_UPDATE'].includes(event.data?.type))event.ports[0]?.postMessage({ready:true,channel,protocol:2});
 });
 try{
  let release;
  if('serviceWorker' in navigator){
   try{
    env.registration=await navigator.serviceWorker.getRegistration(base.pathname);
    if(env.registration)navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'}).catch(()=>{});
    else env.registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});
    const registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Загрузчик ещё устанавливается.')),30000))]);env.registration=registration;
    const hello=await env.request(env.worker(),'HOST_PROTOCOL',{},1500);
    env.supportsChannels=hello.protocol===2;
    env.shellId=hello.shellId||null;
    if(env.supportsChannels){
     if(!raw.getItem('kontur_host_migrated_v2')){
      // Legacy clients backed up current storage before the coordinated SW
      // update, but their old pagehide handler could then flush a stale tab.
      try{
       const saved=JSON.parse(raw.getItem('kontur_update_backup_v1')||'null');
       const allowed=['kontur_campaign_v12','kontur_save_v2','kontur_best_v2','kontur_test_lab_v1','kontur_best_test_v1'];
       if(saved&&!saved.channel&&Date.now()-saved.createdAt>=0&&Date.now()-saved.createdAt<60000&&saved.values&&Object.keys(saved.values).every(key=>allowed.includes(key)&&[null,'string'].includes(saved.values[key]===null?null:typeof saved.values[key])))
        for(const [key,value]of Object.entries(saved.values))if(value===null)raw.removeItem(key);else raw.setItem(key,value);
      }catch(_error){/* Preserve existing data if a legacy backup is invalid. */}
      raw.setItem('kontur_host_migrated_v2','2');
     }
     release=await env.request(env.worker(),'ENSURE_CHANNEL',{channel});
    }
   }catch(error){env.workerError=error.message;/* A legacy controller may need its normal home-screen update. */}
  }
  if(!release)release=await env.latest(channel);
  if(!release?.entry||release.channel!==channel)throw Error('Сборка этого режима недоступна.');
  env.release=release;status('Запуск '+(channel==='test'?'тестовой ':'')+release.version+'…');
  const response=await fetch(new URL(release.entry,base));
  if(!response.ok)throw Error('Не удалось открыть выбранную сборку.');
  const html=await response.text(),doc=new DOMParser().parseFromString(html,'text/html'),styles=[];
  // Previously cached entries contain their old adapter. Always use the one
  // delivered by this shell, even while keeping an older game release active.
  const scripts=[...doc.querySelectorAll('script[src]')].map(node=>node.getAttribute('src')).filter(source=>!/^assets\/channel-client-/.test(source));
  scripts.push('__CLIENT__');
  doc.querySelectorAll('script[src]').forEach(node=>node.remove());
  for(const node of [...doc.head.children]){
   if(node.tagName==='SCRIPT'||node.matches('link[rel="manifest"]'))continue;
   const clone=document.importNode(node,true);
   if(clone.matches('link[rel="stylesheet"]'))styles.push(new Promise((resolve,reject)=>{clone.onload=resolve;clone.onerror=()=>reject(Error('Не загрузилось оформление.'));}));
   document.head.append(clone);
  }
  document.body.replaceChildren(...[...doc.body.childNodes].map(node=>document.importNode(node,true)));
  await Promise.all(styles);
  for(const source of scripts){
   const url=new URL(source,base);
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname+'assets/'))throw Error('Неверный адрес файла сборки.');
   await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>reject(Error('Не загрузился код игры.'));document.body.append(script);});
  }
 }catch(error){
  let screen=document.getElementById('hostBoot');
  if(!screen){screen=document.createElement('section');screen.id='hostBoot';screen.innerHTML='<h1>КОНТУР</h1><p id="hostStatus"></p><button id="hostRetry">Повторить</button>';document.body.replaceChildren(screen);document.getElementById('hostRetry').onclick=()=>location.reload();}
  status(error.message);document.getElementById('hostProgress')?.remove();const button=document.getElementById('hostRetry');if(button)button.hidden=false;
 }
})();
