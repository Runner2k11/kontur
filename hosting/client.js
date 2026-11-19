/* Version switching and update UI; game storage is supplied before game boot. */
(() => {
 'use strict';
 const env=window.KONTUR_HOST;if(!env)return;
 let registration=env.registration,pending=null,catalog=null,prepared=false,busy=false,hadController=!!navigator.serviceWorker?.controller;
 const notice=document.createElement('aside');notice.id='updateNotice';notice.hidden=true;notice.setAttribute('role','status');
 const message=document.createElement('span'),apply=document.createElement('button');apply.type='button';apply.textContent='Обновить';notice.append(message,apply);document.body.append(notice);
 const nativeKey=key=>env.channel==='test'?env.testPrefix+key:key;
 function compatible(formats){
  if(!formats)return false;
  try{
   const key=testModeActive?TEST_APP_KEY:APP_KEY;
   const runs=JSON.parse(env.storage.getItem(key)||'null')?.runs||appData.runs;
   return ['campaign','endless'].every(mode=>{const run=runs[mode];return !run||!['build','wave'].includes(run.phase)||(mode==='campaign'?run.rulesVersion:run.mapVersion)===formats[mode];});
  }catch(_error){return false;}
 }
 function canPrepare(formats){return appScreen==='home'&&!sessionStarted&&!anyDialogOpen()&&compatible(formats);}
 function backup(){
  const keys=[APP_KEY,SAVE_KEY,BEST_KEY,TEST_APP_KEY,'kontur_best_test_v1'];
  const values=Object.fromEntries(keys.map(key=>[key,env.raw.getItem(nativeKey(key))]));
  env.storage.setItem('kontur_update_backup_v1',JSON.stringify({channel:env.channel,version:GAME_VERSION,createdAt:Date.now(),values}));
 }
 function unfreeze(){prepared=false;busy=false;document.body.classList.remove('pwa-updating');refreshNotice();}
 // Menu actions already persist their changes. A stale home-screen tab must
 // never flush its old snapshot over a newer save during reload or switching.
 const originalSaveProgress=saveProgress;
 saveProgress=function(){if(prepared||busy||!sessionStarted&&appScreen!=='battle')return;return originalSaveProgress();};
 window.removeEventListener('pagehide',originalSaveProgress);
 window.addEventListener('pagehide',saveProgress);
 function refreshNotice(){
  notice.hidden=appScreen!=='home'||(!pending&&!busy);
  if(busy){apply.disabled=true;return;}
  if(!pending)return;
  const formats=pending.kind==='shell'?env.release.runFormats:pending.release.runFormats;
  message.textContent=prepared?'Обновление…':!compatible(formats)?'Обновление готово. Сначала заверши сохранённый бой этой версии.':pending.kind==='shell'?'Готово обновление загрузчика игры.':'Готова '+(env.channel==='test'?'тестовая версия ':'версия ')+pending.release.version+'.';
  apply.textContent='Обновить';apply.disabled=prepared||!canPrepare(formats);
 }
 env.onProgress=progress=>{if(busy){message.textContent='Загрузка версии · '+progress.done+' / '+progress.total;notice.hidden=false;}};
 async function check(){
  if(busy||prepared)return;
  try{
   catalog=await env.catalog();
   if(registration?.waiting){pending={kind:'shell',worker:registration.waiting};}
   else if(catalog[env.channel].buildId!==env.release.buildId)pending={kind:'channel',release:catalog[env.channel]};
   else pending=null;
   if(registration?.active&&document.visibilityState==='visible')registration.update().catch(()=>{});
  }catch(_error){/* Cached builds remain available offline. */}
  refreshNotice();
 }
 async function switchChannel(next){
  if(busy||prepared||sessionStarted||!['home','campaign'].includes(appScreen))return false;
  if(env.registration&&!env.supportsChannels){notify('Сначала обнови загрузчик кнопкой «Обновить» на заставке.',true);await check();return false;}
  busy=true;notice.hidden=false;message.textContent='Загрузка '+(next==='test'?'тестовой':'основной')+' версии…';apply.disabled=true;
  try{
   if(env.supportsChannels)await env.request(env.worker(),'ENSURE_CHANNEL',{channel:next});
   else {const available=await env.catalog();if(!available[next])throw Error('Версия пока недоступна.');}
   // Switching never rewrites the other channel's profile or saved battle.
   env.select(next);location.reload();return true;
  }catch(error){busy=false;notice.hidden=true;notify(error.message,true);refreshNotice();return false;}
 }
 env.switchChannel=switchChannel;
 apply.addEventListener('click',async()=>{
  if(!pending||prepared||busy||!canPrepare(pending.kind==='shell'?env.release.runFormats:pending.release.runFormats))return;
  const update=pending;busy=true;message.textContent='Подготовка обновления…';apply.disabled=true;
  try{
   if(update.kind==='shell')await env.request(update.worker,'APPLY_UPDATE');
   else await env.request(env.worker(),'APPLY_CHANNEL',{channel:env.channel,buildId:update.release.buildId});
  }catch(error){unfreeze();notify(error.message,true);}
 });
 navigator.serviceWorker?.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type==='PREPARE_CHANNEL_UPDATE'||data.type==='PREPARE_UPDATE'){
   if(data.type==='PREPARE_CHANNEL_UPDATE'&&data.channel!==env.channel){event.ports[0]?.postMessage({ready:true,channel:env.channel,protocol:2});return;}
   const formats=data.type==='PREPARE_UPDATE'?(data.channelFormats?.[env.channel]||data.runFormats):data.runFormats;
   let ready=canPrepare(formats);
   if(ready){try{backup();prepared=true;document.body.classList.add('pwa-updating');setTimeout(unfreeze,15000);}catch(_error){ready=false;}}
   event.ports[0]?.postMessage({ready,channel:env.channel,protocol:2});refreshNotice();
  }
  if(data.type==='CHANNEL_UPDATE_ABORTED'&&data.channel===env.channel||data.type==='UPDATE_ABORTED'){unfreeze();notify('Заверши бой или закрой другие вкладки обновляемой версии.',true);}
  if(data.type==='CHANNEL_UPDATED'&&data.channel===env.channel)location.reload();
 });
 document.addEventListener('click',event=>{if(prepared||busy){event.preventDefault();event.stopImmediatePropagation();}},true);
 navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(hadController)location.reload();else{hadController=true;env.request(env.worker(),'HOST_PROTOCOL',{},1500).then(reply=>{env.supportsChannels=reply.protocol===2;}).catch(()=>{});}});
 let taps=0,last=0;
 $('gameVersion').addEventListener('click',event=>{
  event.preventDefault();event.stopImmediatePropagation();
  if(appScreen!=='home'||sessionStarted)return;
  const time=performance.now();taps=time-last<900?taps+1:1;last=time;
  if(taps>=7){taps=0;switchChannel(env.channel==='test'?'stable':'test');}
 },true);
 const originalLabUI=refreshLabUI;
 refreshLabUI=function(){
  originalLabUI();
  if(env.channel==='test'){
   $('testLabBadge').textContent='ТЕСТ · '+GAME_VERSION;$('testLabBadge').hidden=false;
   $('labLeave').textContent='Вернуться в основную';$('gameVersion').title='Тестовая сборка. Семь нажатий — основная версия.';
  }else $('gameVersion').title='Семь нажатий — тестовая версия игры.';
 };
 if(env.channel==='test'){
  $('labLeave').addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();switchChannel('stable');},true);
  const copy=document.createElement('button');copy.type='button';copy.className='menu-item';copy.id='copyStableProfile';copy.innerHTML='Скопировать профиль основной версии<span>Сектора, звёзды и технологии · без переноса боя</span>';
  $('helpBtn').before(copy);
  copy.addEventListener('click',()=>{
   if(sessionStarted){notify('Копировать профиль можно между боями.',true);return;}
   let source;
   try{source=JSON.parse(env.raw.getItem(APP_KEY)||'null');if(!source?.profile||!validateProfile(source.profile))throw Error();}catch(_error){notify('В основной версии пока нет сохранённого профиля.',true);return;}
   if(!confirm('Заменить тестовый профиль копией основного? Тестовые незавершённые бои будут сброшены. Основной профиль останется на месте.'))return;
   const value=JSON.stringify({version:12,profile:cloneData(source.profile),runs:{campaign:null,endless:null},lastMode:'campaign'});
   Object.assign(appData,JSON.parse(value));env.storage.setItem(TEST_APP_KEY,value);env.storage.setItem(APP_KEY,value);location.reload();
  });
 }
 env.ready=true;
 assetsReady.then(()=>{
  if(env.channel==='test'&&!testModeActive)testLabToggle();
  refreshLabUI();refreshUI();
  document.title='КОНТУР '+GAME_VERSION+(env.channel==='test'?' · ТЕСТ':' · Кампания и штурмы');
 });
 registration?.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')check();});});
 window.addEventListener('online',check);window.addEventListener('focus',check);
 setInterval(check,5*60*1000);setInterval(refreshNotice,750);check();
})();
