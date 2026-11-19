/* Offline shell and coordinated updates. Game saves never enter the asset cache. */
(() => {
 'use strict';
 if(!('serviceWorker' in navigator)||!/^https?:$/.test(location.protocol))return;
 const base=new URL('../',document.currentScript.src);
 let registration=null,waiting=null,target=null,prepared=false,hadController=!!navigator.serviceWorker.controller;
 const notice=document.createElement('aside');notice.id='updateNotice';notice.hidden=true;notice.setAttribute('role','status');
 const text=document.createElement('span'),button=document.createElement('button');button.type='button';button.textContent='Обновить';button.disabled=true;
 notice.append(text,button);document.body.append(notice);
 let releaseAttempt=0;

 function compatible(formats){
  if(!formats)return false;
  let runs;try{runs=JSON.parse(localStorage.getItem(APP_KEY)||'null')?.runs||appData.runs;}catch(_error){return false;}
  return ['campaign','endless'].every(mode=>{
   const run=runs[mode];
   return !run||!['build','wave'].includes(run.phase)||(mode==='campaign'?run.rulesVersion:run.mapVersion)===formats[mode];
  });
 }
 function canUpdate(formats){
  return appScreen==='home'&&!sessionStarted&&!testModeActive&&!anyDialogOpen()&&compatible(formats);
 }
 function backup(){
  // Another tab may have a newer battle save. Back up storage as it is;
  // a home-screen tab must never overwrite it with its in-memory snapshot.
  const keys=[APP_KEY,SAVE_KEY,BEST_KEY,TEST_APP_KEY,'kontur_best_test_v1'];
  const values=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]));
  localStorage.setItem('kontur_update_backup_v1',JSON.stringify({version:GAME_VERSION,createdAt:Date.now(),values}));
 }
 function unfreeze(){prepared=false;document.body.classList.remove('pwa-updating');refreshNotice();}
 function refreshNotice(){
  notice.hidden=!waiting||appScreen!=='home';
  if(!waiting)return;
  text.textContent=prepared?'Обновляем игру…':testModeActive?'Новая версия готова. Выйди из тестового режима.':
   target&&!compatible(target.runFormats)?'Новая версия готова. Сначала заверши сохранённый бой.':
   'Готова новая версия'+(target?' '+target.version:'')+'.';
  button.disabled=prepared||!target||!canUpdate(target.runFormats);
 }
 function askRelease(worker){
  const attempt=++releaseAttempt,channel=new MessageChannel();
  channel.port1.onmessage=event=>{channel.port1.close();if(attempt!==releaseAttempt)return;target=event.data;refreshNotice();};
  worker.postMessage({type:'GET_RELEASE'},[channel.port2]);
 }
 function watchWaiting(){
  if(!registration?.waiting||!navigator.serviceWorker.controller)return;
  waiting=registration.waiting;target=null;askRelease(waiting);refreshNotice();
 }
 button.addEventListener('click',()=>{
  if(waiting&&target&&canUpdate(target.runFormats))waiting.postMessage({type:'APPLY_UPDATE'});
 });
 navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='PREPARE_UPDATE'){
   let ready=canUpdate(event.data.runFormats);
   if(ready){try{backup();prepared=true;document.body.classList.add('pwa-updating');setTimeout(unfreeze,8000);}catch(_error){ready=false;}}
   event.ports[0]?.postMessage({ready});refreshNotice();
  }
  if(event.data?.type==='UPDATE_ABORTED'){
   unfreeze();text.textContent='Заверши бой или закрой другие вкладки игры, затем обнови.';
  }
 });
 document.addEventListener('click',event=>{if(prepared){event.preventDefault();event.stopImmediatePropagation();}},true);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(hadController){location.reload();return;}
  hadController=true;
 });
 async function check(){
  if(!registration?.active||registration.installing||document.visibilityState!=='visible')return;
  try{await registration.update();watchWaiting();}catch(_error){/* The current offline version remains playable. */}
 }
 function track(worker){worker?.addEventListener('statechange',()=>{if(worker.state==='installed')setTimeout(watchWaiting,0);});}
 function start(){
  assetsReady.then(()=>navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'})).then(reg=>{
   registration=reg;watchWaiting();
   reg.addEventListener('updatefound',()=>track(reg.installing));track(reg.installing);
  }).catch(()=>{/* Online play still works if offline storage is unavailable. */});
 }
 if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
 window.addEventListener('online',check);window.addEventListener('focus',check);
 setInterval(check,5*60*1000);setInterval(()=>{if(registration?.waiting&&waiting!==registration.waiting)watchWaiting();refreshNotice();},1000);
})();
