

'use strict';
const GAME_VERSION='__GAME_VERSION__';
let testModeActive=false,mainAppSnapshot=null,mainLabBest=0;
// КОНТУР: автономная игра. Внешние библиотеки, сервер и интернет не требуются.
const COLS=24, ROWS=12, CELL=48, WIDTH=COLS*CELL, HEIGHT=ROWS*CELL;
const MAX_ACTIVE_WAVES=2;
const SAVE_KEY='kontur_save_v2', BEST_KEY='kontur_best_v2';
const PAUSE_ICON='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2h3v12H4zm5 0h3v12H9z"/></svg>';
const PLAY_ICON='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m4 2 10 6-10 6Z"/></svg>';
const WIN_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';
const LOSE_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const ENEMY_ICONS={scout:'<path d="m12 3 8 9-8 9-8-9Z"/>',runner:'<path d="m5 6 7 6-7 6m6-12 7 6-7 6"/>',armor:'<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m12 7 4 5-4 5-4-5Z"/>',swarm:'<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="12" cy="17" r="2"/>',boss:'<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m8 8 8 8m-8 0 8-8"/>'};
const $=id=>document.getElementById(id);
const canvas=$('board'), ctx=canvas.getContext('2d');
// Три независимых коридора сходятся только у ядра.
let ROUTES=[
 {name:'СЕВЕР / A',color:'#78d7e1',cells:[[-1,1],[6,1],[6,3],[18,3],[18,1],[22,1],[22,5],[23,5]]},
 {name:'ЦЕНТР / B',color:'#d4fa7a',cells:[[-1,5],[23,5]]},
 {name:'ЮГ / C',color:'#ffb56b',cells:[[-1,11],[8,11],[8,9],[18,9],[18,7],[22,7],[22,5],[23,5]]}
].map(route=>{
 const points=route.cells.map(([c,r])=>({x:(c+.5)*CELL,y:(r+.5)*CELL})),segments=[];let length=0;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.y-a.y);segments.push({a,b,length:len,start:length});length+=len;}
 return {...route,points,segments,length};
});
let CORE=ROUTES[0].points.at(-1);const road=new Set();
for(const route of ROUTES)for(const seg of route.segments)for(let d=0;d<=seg.length;d+=CELL){const c=Math.floor((seg.a.x+(seg.b.x-seg.a.x)*d/seg.length)/CELL),r=Math.floor((seg.a.y+(seg.b.y-seg.a.y)*d/seg.length)/CELL);if(c>=0&&c<COLS&&r>=0&&r<ROWS)road.add(c+','+r);}
const TOWERS={
 pulse:{name:'Импульс',cost:65,damage:18,rate:.48,range:145,color:'#6bdfef',speed:520,desc:'Скорострельная башня против наземных и воздушных целей. Выгодна против лёгких дронов.',special:'Земля и воздух'},
 cannon:{name:'Мортира',cost:125,damage:48,rate:1.35,range:155,color:'#ffb56b',speed:270,splash:67,desc:'Только наземные цели. Разрывные снаряды наносят урон по площади. Обе специализации усиливают покрытие взрывами.',special:'Площадь · только земля'},
 frost:{name:'Крио',cost:90,damage:7,rate:.8,range:130,color:'#8cbaff',speed:370,slow:.48,desc:'Замедляет наземные и воздушные цели на 52% на 1.8 секунды. Поддерживает соседние орудия.',special:'Замедление 52%'},
 rail:{name:'Рельса',cost:180,damage:100,rate:1.8,range:240,color:'#c6a1ff',speed:1000,pierce:true,desc:'Атакует землю и воздух, игнорирует броню. Эффективна против броневиков и тяжёлых штурмовиков.',special:'Игнорирует броню'}
};
const ENEMIES={
 scout:{name:'Разведчики',hp:46,speed:65,reward:9,armor:0,damage:1,color:'#f4be84',radius:9,symbol:'◇'},
 runner:{name:'Бегуны',hp:32,speed:112,reward:9,armor:0,damage:1,color:'#f08b9c',radius:8,symbol:'»'},
 armor:{name:'Броневики',hp:160,speed:43,reward:20,armor:7,damage:3,color:'#dca7f4',radius:13,symbol:'⬡'},
 swarm:{name:'Стая',hp:25,speed:84,reward:6,armor:0,damage:1,color:'#f7dc75',radius:6,symbol:'•'},
 drone:{name:'Дроны',flying:true,hp:24,speed:86,reward:8,armor:0,damage:1,color:'#82eaff',radius:11,symbol:'✦'},
 gunship:{name:'Штурмовики',flying:true,hp:140,speed:58,reward:24,armor:4,damage:3,color:'#f9ad70',radius:17,symbol:'✧'},
 guardian:{name:'Щитоносцы',hp:1300,speed:35,reward:14,armor:10,damage:3,color:'#99c5ff',radius:14,symbol:'⬡'},
 medic:{name:'Ремонтники',hp:850,speed:48,reward:10,armor:4,damage:2,color:'#b2ffbf',radius:11,symbol:'+'},
 boss:{name:'Босс',hp:420,speed:30,reward:120,armor:10,damage:8,color:'#ff777e',radius:21,symbol:'♜'}
};
function freshState(){return {money:240,lives:20,maxLives:20,wave:0,completed:0,kills:0,score:0,towers:[],enemies:[],shots:[],queue:[],waves:[],spawnTimer:0,...freshProgression(),phase:'build',time:0,nextId:1,nextWaveIn:0,launchCooldown:0};}
let AIR_ROUTES=[];
let state=freshState(), selectedType='pulse', selectedId=null, hover=null, keyboardCell={c:3,r:2}, paused=false, speed=1, sound=false;
let particles=[],beams=[],floaters=[],now=0,uiDirty=true,lastUI=0,lastFrame=0,toastTimer=0,audioCtx=null,lastSound=0,dialogPaused=false,storageAvailable=true,lastSave=0;
let best=0;
try{best=Math.max(0,Number(localStorage.getItem(BEST_KEY))||0);}catch(e){storageAvailable=false;}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function towerStats(t){
 const d=TOWERS[t.type],l=t.level-1,s={...d,damage:d.damage*Math.pow(state.mode==='campaign'?1.45:1.65,l),rate:d.rate*Math.pow(.92,l),range:d.range+14*l,slow:d.slow?Math.max(.3,d.slow-.07*l):null,slowDuration:1.8};
 if(t.branch==='rapid'){s.rate*=.52;s.damage*=.85;}
 if(t.branch==='piercer'){s.damage*=1.45;s.rate*=1.12;s.pierce=true;}
 if(t.branch==='blast'){s.splash*=1.55;s.damage*=.85;}
 if(t.branch==='scorch'){s.scorch=true;s.damage*=.65;s.splash*=.85;s.rate*=1.1;s.scorchDuration=3;}
 if(t.branch==='permafrost'){s.slow=.24;s.slowDuration=3;s.damage*=.85;}
 if(t.branch==='blizzard'){s.splash=60;s.slow=.62;s.slowDuration=1.6;}
 if(t.branch==='sniper'){s.damage*=1.75;s.range+=48;s.rate*=1.2;}
 if(t.branch==='chain')s.chain=true;
 s.damage=Math.round(s.damage*(1+.12*perkRank('reactor')));s.range*=1+.08*perkRank('optics');s.rate/=1+.1*perkRank('loader');
 if(s.splash)s.splash*=1+.15*perkRank('blast');if(s.scorch)s.scorchDps=Math.round(s.damage/.65*.4);s.slowDuration*=1+.25*perkRank('cryo');return s;
}
// Target priority is remaining distance along the enemy's route, never speed or ETA.
function remainingDistance(enemy) {
 return Math.max(0, enemyRoute(enemy).length - enemy.distance);
}
function chooseTarget(tower, enemies = state.enemies) {
 const range = towerStats(tower).range;
 let target = null, nearest = Infinity;
 for (const enemy of enemies) {
  if (enemy.hp <= 0 || !canHitTarget(tower,enemy) || Math.hypot(enemy.x - tower.x, enemy.y - tower.y) > range) continue;
  const remaining = remainingDistance(enemy);
  if (remaining < nearest || (remaining === nearest && (!target || enemy.id < target.id))) {
   target = enemy;
   nearest = remaining;
  }
 }
 return target;
}

function upgradeCost(t){return Math.round(TOWERS[t.type].cost*(state.mode==='campaign'?(t.level===1?.6:.95):(t.level===1?.9:1.4)));}
function sellValue(t){return Math.floor(t.invested*.7);}
function pointOnPath(distance,routeIndex=0,flying=false){
 const route=(flying?AIR_ROUTES:ROUTES)[routeIndex],d=clamp(distance,0,route.length),seg=route.segments.find(s=>d<=s.start+s.length)||route.segments.at(-1),f=clamp((d-seg.start)/seg.length,0,1);
 return {x:seg.a.x+(seg.b.x-seg.a.x)*f,y:seg.a.y+(seg.b.y-seg.a.y)*f,angle:Math.atan2(seg.b.y-seg.a.y,seg.b.x-seg.a.x)};
}

function wavePlan(n){
 if(state.mode==='campaign')return sectorWavePlan(n);
 const types=[],count=Math.min(96,10+Math.floor(n*2.4)+2*Math.floor(n/5));
 for(let i=0;i<count;i++){
  let type='scout';
  if(n>=2&&i%4===2)type='runner';
  if(n>=3&&i%6===5)type='armor';
  if(n>=5&&i%7<3)type='swarm';
  if(n>=9&&i%5===4)type='armor';
  if(n>=12&&i%8===3)type='runner';
  if(n>=18&&i%7===6)type='armor';
  if(n>=4&&n%3===1&&i%8===2)type='drone';
   if(n>=12&&n%4===0&&i%17===7)type='gunship';
   types.push(type);
 }
 if(n%5===0)for(let b=0;b<Math.min(4,1+Math.floor(n/20));b++)types.splice(Math.floor(types.length*(.45+b*.12)),0,'boss');
 let finalBossRoute=0;
 return types.map((type,i)=>({type,route:type==='boss'&&n===50?finalBossRoute++%ROUTES.length:(i+n-1)%ROUTES.length,wave:n}));
}
function waveInterval(n){return pauseBeforeWave(n);}
function waveBonus(n){if(state.mode==='campaign')return campaignWaveBonus(n);return 30+n*6;}
function earlyBonus(){
 if(state.wave===0||campaignAtFinal()||state.waves.length>=MAX_ACTIVE_WAVES||state.mode==='campaign'&&state.difficulty>0)return 0;
 return scheduledBonus();
}
function waveHealth(n){return Math.pow(1.085,Math.min(n-1,500))*(1+.13*(n-1));}
function timeLabel(seconds){const n=Math.max(0,Math.ceil(seconds));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function announce(s){$('announcer').textContent=s;}
function notify(message,error=false){clearTimeout(toastTimer);const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,2900);announce(message);}
function saveProgress(){
 if(typeof appData==='undefined')return;
 if(appScreen==='battle'||sessionStarted){
  appData.runs[state.mode]=JSON.parse(JSON.stringify({...state,enemies:state.enemies.filter(e=>e.hp>0&&!e.resolved)}));
  appData.lastMode=state.mode;
 }
 persistApp();lastSave=state.time;uiDirty=true;
}

function updateBest(){if(state.score>best){best=state.score;try{localStorage.setItem(testModeActive?'kontur_best_test_v1':BEST_KEY,String(best));}catch(e){storageAvailable=false;}}}
function towerAt(c,r){return state.towers.find(t=>t.c===c&&t.r===r);}
function validCell(c,r){return c>=0&&c<COLS&&r>=0&&r<ROWS&&!road.has(c+','+r)&&!towerAt(c,r)&&(state.mode!=='campaign'||!!buildPadAt(c,r));}
function chooseType(type){if(!Object.hasOwn(TOWERS,type)||!towerAllowed(type))return;abilityAim=null;selectedType=type;selectedId=null;uiDirty=true;beep(550,.035,.025);}
function selectedTower(){return state.towers.find(t=>t.id===selectedId);}
function placeAt(c,r){
 if(paused||!['build','wave'].includes(state.phase)||!towerAllowed(selectedType))return;
 const existing=towerAt(c,r);
 if(existing){selectedId=existing.id;selectedType=null;uiDirty=true;beep(650,.03,.03);return;}
 if(!selectedType){selectedId=null;uiDirty=true;return;}
 if(!validCell(c,r)){notify(state.mode==='campaign'?'Строить можно только на строительных площадках.':'На дороге строить нельзя. Выбери свободную клетку.',true);return;}
 const def=TOWERS[selectedType];
 if(state.money<def.cost){notify('Нужно '+def.cost+' кредитов. Сейчас: '+state.money+'.',true);return;}
 state.money-=def.cost;
 const t={branch:null,id:state.nextId++,c,r,x:(c+.5)*CELL,y:(r+.5)*CELL,type:selectedType,level:1,invested:def.cost,angle:-Math.PI/2,cooldown:.15,recoil:0};
 state.towers.push(t);burst(t.x,t.y,def.color,14);floatText(t.x,t.y-20,'−'+def.cost,'#d4fa7a');beep(440,.08,.04,'triangle');saveProgress();uiDirty=true;
 announce(def.name+' построена. Осталось '+state.money+' кредитов.');
}
function upgradeSelected(){
 const t=selectedTower();if(!t||t.level>=towerLevelCap()||t.disabled||paused||!['build','wave'].includes(state.phase))return;
 if(t.level===2){showContext('tower',{c:t.c,r:t.r});notify('Выбери специализацию для третьего уровня.');return;}
 const cost=upgradeCost(t);if(state.money<cost){notify('Для улучшения нужно '+cost+' кредитов.',true);return;}
 state.money-=cost;t.invested+=cost;t.level++;burst(t.x,t.y,TOWERS[t.type].color,20);floatText(t.x,t.y-26,'УРОВЕНЬ '+t.level,'#d4fa7a');beep(780,.12,.045,'triangle');saveProgress();uiDirty=true;
}
function sellSelected(){
 const t=selectedTower();if(!t||t.disabled||paused||!['build','wave'].includes(state.phase))return;
 const refund=sellValue(t);state.money+=refund;state.towers=state.towers.filter(x=>x.id!==t.id);closeContextPanel();selectedId=null;selectedType=null;burst(t.x,t.y,'#b6c7ce',12);floatText(t.x,t.y-20,'+'+refund,'#d4fa7a');saveProgress();uiDirty=true;beep(330,.07,.03);
}
function startWave(early=false){
 if(!sessionStarted||paused||!['build','wave'].includes(state.phase)||campaignAtFinal()||state.waves.length>=MAX_ACTIVE_WAVES)return false;
 const bonus=early?earlyBonus():0,n=state.wave+1,plan=wavePlan(n);
 state.money+=bonus;state.wave=n;state.phase='wave';state.waves.push({id:n,total:plan.length,remaining:plan.length,bossKills:0,totalThreat:plan.reduce((v,e)=>v+enemyThreat(e),0)});
 let spawnAt=state.time+.3;
 for(const item of plan){state.queue.push({...item,spawnAt:item.spawnOffset===undefined?spawnAt:state.time+.3+item.spawnOffset});spawnAt+=spawnGap(item,state.mode);}
 state.queue.sort((a,b)=>a.spawnAt-b.spawnAt||a.wave-b.wave);
 state.spawnTimer=Math.max(0,state.queue[0].spawnAt-state.time);
 const lastSpawn=Math.max(...state.queue.filter(q=>q.wave===n).map(q=>q.spawnAt));
 state.waveClock=makeWaveClock(n,state.time,lastSpawn,earlyRewardCap(n+1));state.nextWaveIn=waveInterval(n+1);state.launchCooldown=0;
 notify('Волна '+n+(plan.some(e=>e.type==='boss')?' — босс!':'')+' · в бою '+state.waves.length+'/'+MAX_ACTIVE_WAVES+(bonus?' · ранний вызов +'+bonus+' монет':''));
 beep(240,.18,.045,'triangle');saveProgress();uiDirty=true;return true;
}
// The campaign finale has a separate health budget; earlier waves keep their tuning.
const FINAL_BOSS_HP_FACTOR=.70;
function enemyHealth(type,wave){
 if(state.mode==='campaign')return type==='boss'?bossHealthForSector(state.sectorId):CAMPAIGN_ENEMY_HP[type];
 const d=ENEMIES[type],boss=type==='boss';
 return Math.round(d.hp*waveHealth(wave)*(boss?1+wave/25:1)*(boss&&wave===50?FINAL_BOSS_HP_FACTOR:1));
}


function baseSpawnEnemy(item){
 const {type,route,wave}=item,d=ENEMIES[type],hp=Math.round(enemyHealth(type,wave)*(item.hpScale||1)*(item.elite?ELITE_HP_MULTIPLIER:1)),p=pointOnPath(0,route,isAirUnit(type));
 state.enemies.push({id:state.nextId++,bounty:item.bounty,elite:!!item.elite,convoy:!!item.convoy,type,route,wave,hp,maxHp:hp,distance:0,x:p.x,y:p.y,angle:p.angle,speed:state.mode==='campaign'&&item.convoy?ENEMIES.boss.speed:d.speed*(state.mode==='campaign'?(item.elite?1.05:1):(1+Math.min(.55,Math.max(0,wave-5)*.012))),armor:d.armor+(state.mode==='campaign'?(item.elite?ELITE_EXTRA_ARMOR:0):Math.floor((wave-1)/6)),slowUntil:0,slowFactor:1,slowEffects:[],thermalCarry:0,stunUntil:0,hit:0,resolved:false});
}
function resolveEnemy(e){
 if(e.resolved)return;e.resolved=true;const w=state.waves.find(w=>w.id===e.wave);if(!w)return;w.remaining--;if(w.remaining===0)completeWave(w.id);
}
function damageEnemy(e,damage,pierce=false){
 if(e.hp<=0)return;const d=ENEMIES[e.type],reward=enemyReward(e),dealt=Math.max(1,Math.round(damage*shieldDamageFactor(e)-(pierce?0:e.armor+(e.bossArmor||0))));e.hp-=dealt;e.hit=.12;
 if(e.hp<=0){enemyDestroyed(e);state.money+=reward;state.kills++;state.score+=reward*10+Math.round(e.maxHp);burst(e.x,e.y,d.color,e.type==='boss'?36:9);if(reward)floatText(e.x,e.y-15,'+'+reward,'#d4fa7a');if(e.type==='boss'){if(state.mode==='campaign')state.finalBossKilled=true;const wave=state.waves.find(w=>w.id===e.wave);if(wave)wave.bossKills=(wave.bossKills||0)+1;notify('Босс уничтожен!'+(reward?' +'+reward+' монет.':''));beep(180,.22,.08,'sawtooth');}awardBossPoints(e);resolveEnemy(e);uiDirty=true;}
}
function fire(t,target){
 if(!target||target.hp<=0||!canHitTarget(t,target))return;
 const s=towerStats(t);t.cooldown=s.rate;t.angle=Math.atan2(target.y-t.y,target.x-t.x);t.recoil=1;
 const muzzle=gunFireVisual(t,target);
 if(t.type==='rail'){
  damageEnemy(target,s.damage,true);hitVisual(target.x,target.y,'rail');beams.push({x:muzzle.x,y:muzzle.y,tx:target.x,ty:target.y,color:s.color,life:.24,maxLife:.24});
  if(s.chain){let previous=target;const hitIds=new Set([target.id]);for(const ratio of [.55,.3]){const next=state.enemies.filter(e=>e.hp>0&&!hitIds.has(e.id)&&Math.hypot(e.x-previous.x,e.y-previous.y)<=130).sort((a,b)=>remainingDistance(a)-remainingDistance(b)||a.id-b.id)[0];if(!next)break;beams.push({x:previous.x,y:previous.y,tx:next.x,ty:next.y,color:'#b4b6ff',life:.3,maxLife:.3});damageEnemy(next,Math.round(s.damage*ratio),true);hitVisual(next.x,next.y,'rail');hitIds.add(next.id);previous=next;}}
  beep(190,.055,.025,'sawtooth');return;
 }
 state.shots.push({x:muzzle.x,y:muzzle.y,sx:muzzle.x,sy:muzzle.y,startDist:Math.hypot(target.x-muzzle.x,target.y-muzzle.y),age:0,targetId:target.id,tx:target.x,ty:target.y,type:t.type,scorch:!!s.scorch,scorchDps:s.scorchDps||0,scorchDuration:s.scorchDuration||0,damage:s.damage,pierce:!!s.pierce,speed:s.speed,splash:s.splash||0,slow:s.slow||0,slowDuration:s.slowDuration,ttl:4,color:s.color});
 beep(t.type==='cannon'?100:t.type==='frost'?620:400,.025,.015,t.type==='cannon'?'triangle':'sine');
}
function explodeShot(b,target){
 if(b.scorch){for(const e of state.enemies)if(e.hp>0&&!isAirUnit(e)&&Math.hypot(e.x-b.tx,e.y-b.ty)<=b.splash)damageEnemy(e,b.damage,!!b.pierce);hitVisual(b.tx,b.ty,'cannon');addScorchField(b);return;}
 if(b.splash){for(const e of state.enemies)if(e.hp>0&&canHitTarget(b,e)&&Math.hypot(e.x-b.tx,e.y-b.ty)<=b.splash){damageEnemy(e,b.damage,!!b.pierce);if(b.slow)applySlow(e,b.slow,b.slowDuration||1.8);}hitVisual(b.tx,b.ty,b.type);if(b.type==='frost')ring(b.tx,b.ty,'#a5ddff',b.splash,.5,'shield');}
 else if(target&&target.hp>0&&canHitTarget(b,target)){damageEnemy(target,b.damage,!!b.pierce);if(b.slow)applySlow(target,b.slow,b.slowDuration||1.8);hitVisual(b.tx,b.ty,b.type);}
}
function completeWave(id){
 const w=state.waves.find(w=>w.id===id);if(!w||w.remaining>0)return;
 state.waves=state.waves.filter(w=>w.id!==id);state.completed++;const bonus=waveBonus(id);state.money+=bonus;state.score+=id*100+state.lives*10;
 state.phase=state.waves.length?'wave':'build';
 onBossWaveComplete(w);updateBest();notify('Волна '+id+' отбита! +'+bonus+' монет.');beep(660,.13,.04,'triangle');uiDirty=true;
 announce('Волна '+id+' отбита.');
}
function loseGame(){
 if(['lose','win'].includes(state.phase))return;
 stopTowerRepair(false);state.bossShots=[];abilityAim=null;state.rewardQueue=[];state.orbitalStrikes=[];state.coreShield=0;state.lives=0;state.phase='lose';state.queue=[];state.shots=[];state.enemies=[];state.waves=[];
 beginBattleResult();updateBest();saveProgress();uiDirty=true;beep(95,.4,.06,'sawtooth');announce('Ядро потеряно. Игра окончена.');
}
function update(dt){
 if(paused||state.rewardQueue.length||state.phase==='lose'||state.phase==='win'||ART.loading)return;
 state.time+=dt;progressTick(dt);tickScorchFields(dt);supportTick(dt);if(state.rewardQueue.length){saveProgress();return;}state.launchCooldown=Math.max(0,state.launchCooldown-dt);updateWaveClock(false);
 for(const t of state.towers)t.recoil=Math.max(0,t.recoil-dt*6);
 if(state.phase==='wave'){
  spawnQueuedEnemies();
  for(const e of state.enemies){
   if(e.hp<=0)continue;refreshEnemySlow(e);const def=ENEMIES[e.type],factor=e.stunUntil>state.time?0:e.slowUntil>state.time?e.slowFactor:1;
   advanceCombatEnemy(e,dt,factor);const p=pointOnPath(e.distance,e.route,isAirUnit(e));e.x=p.x;e.y=p.y;e.angle=p.angle;e.hit=Math.max(0,e.hit-dt);
   if(e.distance>=enemyRoute(e).length){e.leakHp=e.hp;e.hp=0;onEnemyLeak(e);applyCoreDamage(def.damage);if(state.mode==='campaign'&&e.type==='boss'){state.defeatReason='Босс прорвался к ядру';loseGame();break;}burst(e.x,e.y,'#ff777e',18);uiDirty=true;beep(130,.09,.04,'sawtooth');if(state.lives<=0){loseGame();break;}resolveEnemy(e);}
  }
  if(state.phase!=='lose'){
   for(const t of state.towers){
    if(t.disabled)continue;t.cooldown-=dt;if(t.cooldown>0)continue;
    const target=chooseTarget(t);
    if(target)fire(t,target);else t.cooldown=0;
   }
   state.shots=state.shots.filter(b=>{
    b.ttl-=dt;b.age=(b.age||0)+dt;if(b.ttl<=0)return false;const target=state.enemies.find(e=>e.id===b.targetId&&e.hp>0);
    if(target){b.tx=target.x;b.ty=target.y;}
    const dx=b.tx-b.x,dy=b.ty-b.y,dist=Math.hypot(dx,dy),step=b.speed*dt;
    if(dist<=step+5){explodeShot(b,target);return false;}b.x+=dx/dist*step;b.y+=dy/dist*step;return true;
   });
   state.enemies=state.enemies.filter(e=>e.hp>0);
  }
 }
 if(!state.waves.length)state.shots=[];
 advanceDebris(dt);
 updateWaveClock();updateVisuals(dt);checkCampaignVictory();if(progressSaveNeeded){progressSaveNeeded=false;saveProgress();}
}
function advanceDebris(dt){
 for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.pow(.09,dt);p.vy*=Math.pow(.09,dt);p.life-=dt;}particles=particles.filter(p=>p.life>0);
 for(const b of beams)b.life-=dt;beams=beams.filter(b=>b.life>0);
 for(const f of floaters){f.y-=19*dt;f.life-=dt;}floaters=floaters.filter(f=>f.life>0);
}
function burst(x,y,color,count){count=Math.ceil(count*(fullEffects?1:.4));if(particles.length>600)return;for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,v=25+Math.random()*95;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.25+Math.random()*.45,color,size:1+Math.random()*2});}}
function floatText(x,y,text,color){floaters.push({x,y,text,color,life:1.1});if(floaters.length>70)floaters.shift();}
function beep(freq,duration=.05,volume=.03,type='sine'){
 if(!sound||!audioCtx)return;const t=audioCtx.currentTime;if(t-lastSound<.035)return;lastSound=t;
 try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.65),t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+duration);}catch(e){}
}
function toggleSound(){
 sound=!sound;
 if(sound){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume().catch(()=>{});}catch(e){sound=false;notify('Звук недоступен в этом браузере.',true);}}
 $('soundWaves').setAttribute('d',sound?'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14':'m16 9 6 6m0-6-6 6');$('soundBtn').setAttribute('aria-pressed',String(sound));$('soundBtn').setAttribute('aria-label',sound?'Выключить звук':'Включить звук');$('soundBtn').title=(sound?'Выключить':'Включить')+' звук (M)';beep(550,.09,.04);
}
function hex(x,y,r,rotation=0){ctx.beginPath();for(let i=0;i<6;i++){const a=rotation+i*Math.PI/3;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
const landscape=document.createElement('canvas');landscape.width=WIDTH;landscape.height=HEIGHT;
// Raster game art is embedded in the standalone HTML. Visual state is separate from combat state.
const ART={ready:false,loading:false,terrain:null,atlas:null,logo:null,sprites:{},error:null};
const FX={smoke:[],rings:[],muzzles:[],decals:[],empWaves:[],orbitalImpacts:[],sabotageHits:[],shake:0,coreHit:0};
let fullEffects=true;
const REDUCED_MOTION=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function loadArt(){
 ART.loading=true;
 // Always return a promise: a decoding or URL API error must not interrupt boot.
 // Keep embedded data URLs intact; no blob URL support or permission is needed.
 return Promise.resolve().then(async()=>{
  const data=JSON.parse($('assetData').textContent);ART.sprites=data.sprites||{};
  const load=url=>new Promise(resolve=>{
   if(!url||typeof Image==='undefined'){resolve(null);return;}
   let image=null,settled=false;
   const done=value=>{if(settled)return;settled=true;clearTimeout(timer);if(image){image.onload=null;image.onerror=null;}resolve(value);};
   const timer=setTimeout(()=>done(null),30000);
   try{image=new Image();image.onload=()=>done(image);image.onerror=()=>done(null);image.src=url;}catch(e){done(null);}
  });
  const [terrain,atlas,logo,uiAtlas,statusAtlas,airAtlas,planetAtlas,planetTerrainAtlas,campaignBackdrop,startBackdrop,battleBackdrop]=await Promise.all([load(data.terrain),load(data.atlas),load(data.logo),load(data.uiAtlas),load(data.statusAtlas),load(data.airAtlas),load(data.planetAtlas),load(data.planetTerrainAtlas),load(data.campaignBackdrop),load(data.startBackdrop),load(data.battleBackdrop)]);
  Object.assign(ART,{terrain,atlas,logo,uiAtlas,statusAtlas,airAtlas,planetAtlas,planetTerrainAtlas,campaignBackdrop,startBackdrop,battleBackdrop,uiAtlasUrl:data.uiAtlas,ready:!!(terrain&&atlas)});
  // CSS rejects very large data URL tokens. Icons only need small atlases.
  const cssAtlas=(image,width)=>{const c=document.createElement('canvas');c.width=Math.min(width,image.width);c.height=Math.round(image.height*c.width/image.width);c.getContext('2d').drawImage(image,0,0,c.width,c.height);return 'url("'+c.toDataURL('image/png')+'")';};
  if(statusAtlas)document.documentElement.style.setProperty('--status-atlas',cssAtlas(statusAtlas,384));
  if(uiAtlas)document.documentElement.style.setProperty('--ui-atlas',cssAtlas(uiAtlas,512));
  if(startBackdrop)$('startScene').src=startBackdrop.src;if(campaignBackdrop)$('campaignScene').src=campaignBackdrop.src;makeLandscape();if(ART.ready){refreshArsenalArt();refreshUnitArt();}else{ART.error='image loading';notify('Картинки недоступны: включён резервный режим. Управление работает.',true);}
  uiDirty=true;return ART.ready;
 }).catch(e=>{ART.ready=false;ART.error='asset loading';notify('Не удалось загрузить картинки: включён резервный режим.',true);return false;}).finally(()=>{ART.loading=false;$('artLoader').hidden=true;uiDirty=true;});
}
function sprite(g,key,x,y,width,angle=0,alpha=1,height=null){
 if(!ART.ready)return;const s=ART.sprites[key];if(!s||s.atlas==='air'&&!ART.airAtlas)return;
 const h=height??width*s.h/s.w;
 g.save();g.translate(x,y);if(angle)g.rotate(angle);g.globalAlpha*=alpha;
 g.drawImage(s.atlas==='air'?ART.airAtlas:ART.atlas,s.x,s.y,s.w,s.h,-s.px*width,-s.py*h,width,h);g.restore();
}
const UNIT_PORTRAITS=Object.create(null);
function refreshUnitArt(){
 if(!ART.ready)return;
 for(const type of Object.keys(ENEMIES)){
  const s=ART.sprites['enemy_'+type];if(!s||s.atlas==='air'&&!ART.airAtlas)continue;
  const c=document.createElement('canvas');c.width=108;c.height=88;const g=c.getContext('2d');
  const scale=Math.min(98/s.w,78/s.h),w=s.w*scale,h=s.h*scale;
  g.drawImage(s.atlas==='air'?ART.airAtlas:ART.atlas,s.x,s.y,s.w,s.h,(108-w)/2,(88-h)/2,w,h);
  UNIT_PORTRAITS[type]=c.toDataURL('image/png');
 }
}
function unitIcon(type){
 const url=UNIT_PORTRAITS[type];return url?'<img class="unit-portrait" data-unit="'+type+'" src="'+url+'" alt="" width="54" height="44" draggable="false">':'<span class="unit-portrait" data-unit="'+type+'" aria-hidden="true"></span>';
}

function refreshArsenalArt(){
 document.querySelectorAll('.tower-card').forEach(el=>{
  const type=el.dataset.type,c=document.createElement('canvas');c.width=96;c.height=96;const g=c.getContext('2d');
  sprite(g,'base_'+type,45,51,66,0,1,66);sprite(g,'gun_'+type,45,49,type==='rail'?74:68,-.15);
  const image=document.createElement('img');image.alt='';image.src=c.toDataURL('image/png');image.width=48;image.height=48;el.querySelector('.tower-glyph').replaceChildren(image);
 });
}
function drawPortrait(type,level=1){
 if(!ART.ready)return;const c=$('towerPortrait');if(!c)return;const g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
 g.fillStyle='#09151b';g.fillRect(0,0,c.width,c.height);g.strokeStyle='#29414c';g.lineWidth=1;
 for(let x=10;x<c.width;x+=22){g.beginPath();g.moveTo(x,0);g.lineTo(x,c.height);g.stroke();}
 for(let y=10;y<c.height;y+=22){g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y);g.stroke();}
 const size=78+(level-1)*5;
 g.fillStyle='#0007';g.beginPath();g.ellipse(112,85,52,21,0,0,Math.PI*2);g.fill();
 sprite(g,'base_'+type,108,67,size,0,1,size);sprite(g,'gun_'+type,108,63,type==='rail'?111:97,-.25);
 g.fillStyle=TOWERS[type].color;for(let i=0;i<level;i++)g.fillRect(15+i*9,108,5,3);
 g.font='9px system-ui';g.fillStyle='#8ca1ae';g.textAlign='right';g.fillText('УРОВЕНЬ '+level,225,112);
}
function legacyLandscape(){
 const g=landscape.getContext('2d');g.clearRect(0,0,WIDTH,HEIGHT);
 if(ART.ready)g.drawImage(ART.terrain,0,0,WIDTH,HEIGHT);else{g.fillStyle='#a8794e';g.fillRect(0,0,WIDTH,HEIGHT);}
 if(state.mode==='campaign'){g.fillStyle=BIOMES[sectorInfo(state.sectorId).biome].tint;g.fillRect(0,0,WIDTH,HEIGHT);}
 g.fillStyle='#24394610';g.fillRect(0,0,WIDTH,HEIGHT);
 // Road geometry always uses the combat routes, so enemies and road art remain aligned.
 for(const route of ROUTES){
  const trace=()=>{g.beginPath();g.moveTo(route.points[0].x,route.points[0].y);for(const p of route.points.slice(1))g.lineTo(p.x,p.y);};
  g.lineJoin='round';g.lineCap='round';
  for(const [w,color]of[[48,'#241b1770'],[43,'#383534'],[40,'#8b8574'],[36,'#272f34'],[33,'#444b4d'],[27,'#454d50']]){g.lineWidth=w;g.strokeStyle=color;trace();g.stroke();}
  g.lineWidth=1;g.strokeStyle='#cfb47a77';g.setLineDash([8,12]);trace();g.stroke();g.setLineDash([]);
 }
 // Panel seams and bolts make the road read as a tangible plated surface.
 const visited=new Set();
 for(const route of ROUTES)for(let d=24;d<route.length-30;d+=CELL){
  const p=pointOnPath(d,ROUTES.indexOf(route)),key=Math.round(p.x)+','+Math.round(p.y);if(visited.has(key))continue;visited.add(key);
  g.save();g.translate(p.x,p.y);g.rotate(p.angle);g.lineWidth=1;g.strokeStyle='#121d2344';g.beginPath();g.moveTo(0,-16);g.lineTo(0,16);g.stroke();
  g.fillStyle='#d6bf8c88';for(const y of[-18,18]){g.fillRect(-4,y-1,8,2);g.fillStyle='#1c272c';g.fillRect(-1,y-1,2,2);g.fillStyle='#d6bf8c88';}g.restore();
 }
 // Subtle grid corners and empty pads remain visible on buildable terrain.
 for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++)if(!road.has(c+','+r)){
  const x=c*CELL,y=r*CELL;g.strokeStyle='#3c4b4d16';g.lineWidth=1;g.beginPath();g.moveTo(x+2,y+7);g.lineTo(x+2,y+2);g.lineTo(x+7,y+2);g.stroke();
 }

 if(ART.ready){sprite(g,'outpost',860,67,52);sprite(g,'outpost',70,552,43);sprite(g,'rocks',430,540,34);sprite(g,'rocks',633,70,22);}
 for(const route of ROUTES){const p=route.points[0];g.strokeStyle=route.color;g.lineWidth=3;g.beginPath();g.moveTo(4,p.y-7);g.lineTo(11,p.y);g.lineTo(4,p.y+7);g.stroke();}
 
}
function resetVisuals(){FX.smoke=[];FX.rings=[];FX.muzzles=[];FX.decals=[];FX.empWaves=[];FX.orbitalImpacts=[];FX.sabotageHits=[];repairHold=null;repairPointers.clear();FX.shake=0;FX.coreHit=0;}
function addSmoke(x,y,count=3,color='#46474b',size=6){
 if(!fullEffects)return;
 for(let i=0;i<count&&FX.smoke.length<90;i++)FX.smoke.push({x:x+(Math.random()-.5)*9,y:y+(Math.random()-.5)*6,vx:(Math.random()-.5)*12,vy:-9-Math.random()*10,size:size*(.7+Math.random()*.6),life:.65+Math.random()*.8,maxLife:1.5,color});
}
function ring(x,y,color,radius=30,duration=.4,kind='shock'){
 if(FX.rings.length>55)FX.rings.shift();FX.rings.push({x,y,color,radius,life:duration,duration,kind});
}
function hitVisual(x,y,type,big=false){
 if(type==='cannon'||big){
  ring(x,y,'#ffd491',big?56:43,.48);ring(x,y,'#fff6c5',big?28:20,.22,'flash');
  addSmoke(x,y,big?10:5,'#383943',big?11:7);burst(x,y,'#ffb95e',big?30:14);burst(x,y,'#ffeeaa',big?12:6);
  if(fullEffects&&!REDUCED_MOTION)FX.shake=Math.max(FX.shake,big?3.5:1.1);
 }else if(type==='frost'){ring(x,y,'#a4e5ff',18,.32,'ice');burst(x,y,'#b9edff',7);}
 else if(type==='rail'){ring(x,y,'#e4bbff',18,.23,'flash');burst(x,y,'#d0a4ff',8);}
 else{burst(x,y,'#ffdab3',4);ring(x,y,'#fff6cc',7,.12,'flash');}
}
function enemyDestroyed(e){
 hitVisual(e.x,e.y,'cannon',e.type==='boss');
 if(FX.decals.length>=38)FX.decals.shift();FX.decals.push({x:e.x,y:e.y,angle:e.angle,size:e.type==='boss'?27:e.type==='armor'?16:9,life:22,seed:e.id});
}
function coreImpact(damage){
 FX.coreHit=.65;ring(CORE.x,CORE.y,'#ff8f73',64,.65,'shield');burst(CORE.x-12,CORE.y,'#ffcf9b',18);
 if(fullEffects&&!REDUCED_MOTION)FX.shake=Math.max(FX.shake,Math.min(5,1.5+damage*.4));
}
function muzzleDistance(type,level=1){return({pulse:29,cannon:30,frost:27,rail:38}[type])*(1+(level-1)*.045);}
function gunFireVisual(t,target){
 const d=muzzleDistance(t.type,t.level),x=t.x+Math.cos(t.angle)*d,y=t.y+Math.sin(t.angle)*d;
 t.targetId=target.id;t.renderAngle=t.angle;
 FX.muzzles.push({x,y,angle:t.angle,type:t.type,color:TOWERS[t.type].color,life:t.type==='cannon'?.16:.09,maxLife:t.type==='cannon'?.16:.09});
 if(t.type==='cannon')addSmoke(x,y,3,'#8a8174',4);
 if(t.type==='rail')ring(t.x,t.y,TOWERS[t.type].color,27,.25,'charge');
 return {x,y};
}
function updateVisuals(dt){
 updateAbilityVisuals(dt);
 const fade=Math.exp(-dt*8);FX.shake*=fade;FX.coreHit=Math.max(0,FX.coreHit-dt);
 for(const p of FX.smoke){p.x+=p.vx*dt;p.y+=p.vy*dt;p.size+=dt*5;p.life-=dt;}FX.smoke=FX.smoke.filter(p=>p.life>0);
 for(const p of FX.muzzles)p.life-=dt;FX.muzzles=FX.muzzles.filter(p=>p.life>0);
 for(const p of FX.rings)p.life-=dt;FX.rings=FX.rings.filter(p=>p.life>0);
 for(const p of FX.decals)p.life-=dt;FX.decals=FX.decals.filter(p=>p.life>0);
 for(const t of state.towers){
  const target=state.enemies.find(e=>e.id===t.targetId&&e.hp>0);
  const aim=target?Math.atan2(target.y-t.y,target.x-t.x):t.angle;
  const current=t.renderAngle??t.angle,delta=Math.atan2(Math.sin(aim-current),Math.cos(aim-current));t.renderAngle=current+delta*Math.min(1,dt*13);
 }
 if(fullEffects){for(const e of state.enemies){e.dustTimer=(e.dustTimer??0)-dt;if(e.dustTimer<=0&&e.hp>0&&!isAirUnit(e)){e.dustTimer=e.type==='boss'?.18:.4;if(FX.smoke.length<70)addSmoke(e.x-Math.cos(e.angle)*9,e.y-Math.sin(e.angle)*9,1,'#b29875',e.type==='boss'?4:2);}}}
}
function drawTower(t,ghost=false,g=ctx){
 const color=TOWERS[t.type].color,level=t.level||1,scale=1+(level-1)*.045,size=43*scale;
 g.save();g.globalAlpha=ghost?.55:t.disabled?.4:1;
 g.fillStyle='#0e1a2160';g.beginPath();g.ellipse(t.x+2,t.y+9,23*scale,15*scale,0,0,Math.PI*2);g.fill();
 if(!ART.ready){g.fillStyle='#293e48';g.fillRect(t.x-18,t.y-18,36,36);g.strokeStyle=color;g.strokeRect(t.x-18,t.y-18,36,36);g.restore();if(!ghost)paintRepairAlert(t,g);return;}
 sprite(g,'base_'+t.type,t.x,t.y,size,0,1,size);
 if(level>=2){g.strokeStyle=color+'b0';g.lineWidth=level===3?2.2:1;g.beginPath();g.ellipse(t.x,t.y+1,21*scale,20*scale,0,.17,Math.PI-.17);g.stroke();}
 if(level===3){g.fillStyle='#e3d9ae';for(const offset of[-1,1]){g.fillRect(t.x+offset*23-2,t.y-6,4,12);g.fillStyle=color;g.fillRect(t.x+offset*23-1,t.y-2,2,4);g.fillStyle='#e3d9ae';}}
 const angle=t.renderAngle??t.angle??-Math.PI/2,recoil=(t.recoil||0)*(t.type==='cannon'?4.5:2.5);
 sprite(g,'gun_'+t.type,t.x-Math.cos(angle)*recoil,t.y-Math.sin(angle)*recoil,t.type==='rail'?53*scale:t.type==='frost'?41*scale:47*scale,angle);
 if(t.type==='frost'&&!ghost){g.strokeStyle='#8cdcff70';g.lineWidth=1;g.beginPath();g.ellipse(t.x,t.y,8+Math.sin(state.time*4)*1.5,6,0,0,Math.PI*2);g.stroke();}
 for(let i=0;i<level;i++){g.fillStyle=color;g.fillRect(t.x-6+i*5,t.y+17*scale,3,2);}
 if(t.branch)drawBranchBadge(g,t);
 g.restore();if(!ghost)paintRepairAlert(t,g);
}
function drawEnemySprite(g,type,width,angle){
 // These sprites have a fixed upper side. Reflect leftward headings instead
 // of turning the artwork upside down; retain the heading on bends/air routes.
 const horizontal=Math.cos(angle),tilt=Math.atan2(Math.sin(angle),Math.abs(horizontal));
 g.save();
 if(horizontal<-1e-6)g.scale(-1,1);
 sprite(g,'enemy_'+type,0,0,width,Math.abs(tilt)<1e-6?0:tilt);
 g.restore();
}
function drawEnemy(e){
 const def=ENEMIES[e.type],w={scout:25,runner:28,armor:37,swarm:18,drone:39,gunship:56,guardian:37,medic:30,boss:58}[e.type],s=ART.sprites['enemy_'+e.type],h=s?w*s.h/s.w:w*.7;
 const moving=paused?0:Math.sin(state.time*(e.type==='runner'?24:13)+e.id),bob=e.type==='armor'?moving*.2:moving*(e.type==='boss'?1.2:.6);
 ctx.save();ctx.translate(e.x,e.y+bob);if(isAirUnit(e)){ctx.fillStyle='#08172155';ctx.beginPath();ctx.ellipse(7,17,w*.4,h*.23,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b2f5ff99';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,w*.55,Math.PI*.15,Math.PI*.85);ctx.stroke();}ctx.fillStyle='#14202b50';ctx.beginPath();ctx.ellipse(2,6,w*.46,h*.36,0,0,Math.PI*2);ctx.fill();
 if(e.slowUntil>state.time){ctx.strokeStyle='#a5ebffba';ctx.lineWidth=1.4;ctx.beginPath();ctx.ellipse(0,2,w*.58,h*.58+2,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#c7f0ff';for(let i=0;i<4;i++){const a=state.time*.9+i*Math.PI/2;ctx.fillRect(Math.cos(a)*w*.6,Math.sin(a)*h*.6,2,2);}}
 if(ART.ready&&(!isAirUnit(e)||ART.airAtlas))drawEnemySprite(ctx,e.type,w,e.angle);else{ctx.fillStyle=def.color;ctx.fillRect(-w/2,-h/2,w,h);}
 if(e.stunUntil>state.time){ctx.strokeStyle='#b2eaff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-12,-10);ctx.lineTo(-3,-14);ctx.lineTo(-7,-3);ctx.lineTo(8,-10);ctx.lineTo(3,4);ctx.stroke();}
 if(e.hit>0){ctx.globalAlpha=e.hit*3;ctx.fillStyle='#fff4c1';ctx.beginPath();ctx.arc(0,0,w*.24,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
 // Health bars remain upright when the world is rotated for portrait screens.
 if(VIEW.rotated)ctx.rotate(-Math.PI/2);
 if(e.hp<e.maxHp||e.type==='boss'){const bw=e.type==='boss'?54:28,y=-h/2-7;ctx.fillStyle='#0a1522ee';ctx.fillRect(-bw/2,y,bw,5);ctx.fillStyle=e.type==='boss'?'#ff8074':e.slowUntil>state.time?'#9ee6ff':'#d4fa7a';ctx.fillRect(-bw/2+1,y+1,(bw-2)*Math.max(0,e.hp/e.maxHp),3);}
 if(e.elite){ctx.strokeStyle='#ffce77';ctx.lineWidth=1.7;ctx.setLineDash([4,3]);ctx.beginPath();ctx.ellipse(0,1,w*.64,h*.65,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffd378';ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.fillText('ЭЛИТА',0,-h/2-12);}
 if(e.type==='boss'&&state.mode!=='campaign'){ctx.font='700 8px system-ui';ctx.textAlign='center';ctx.fillStyle='#ffe5b6';ctx.strokeStyle='#351e22';ctx.lineWidth=3;ctx.strokeText('БОСС',0,-h/2-13);ctx.fillText('БОСС',0,-h/2-13);}
 ctx.restore();drawCampaignUnitMarks(e);
}
function drawCore(){
 const x=CORE.x-5,y=CORE.y,charge=.5+Math.sin(state.time*2.2)*.5;
 ctx.save();ctx.globalCompositeOperation='lighter';ctx.fillStyle=FX.coreHit>0?'#ff735238':'#77f8cb16';ctx.beginPath();ctx.ellipse(x,y,34+charge*3,31+charge*2,0,0,Math.PI*2);ctx.fill();ctx.restore();
 if(ART.ready)sprite(ctx,'core',x,y,59);else{ctx.fillStyle='#a4f3bc';ctx.fillRect(x-18,y-20,36,40);}
 ctx.save();ctx.strokeStyle=FX.coreHit>0?'#ff9a79':'#98ffe180';ctx.lineWidth=FX.coreHit>0?2:1;ctx.beginPath();ctx.ellipse(x,y,29+charge*2,28+charge*2,0,state.time*.6,state.time*.6+Math.PI*1.6);ctx.stroke();
 if(fullEffects)for(let i=0;i<5;i++){const phase=(state.time*.35+i*.2)%1;ctx.fillStyle='#c0ffe4';ctx.globalAlpha=(1-phase)*.8;ctx.fillRect(x+Math.sin(i*2.4+state.time)*8,y-8-phase*28,1.7,2.3);}
 ctx.restore();
}
function drawGroundEffects(){
 for(const d of FX.decals){ctx.save();ctx.globalAlpha=Math.min(.4,d.life*.04);ctx.fillStyle='#1e1c23';ctx.beginPath();ctx.ellipse(d.x,d.y,d.size,d.size*.66,d.angle,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#27232a';ctx.lineWidth=2;for(let i=0;i<4;i++){const a=d.seed+i*1.6;ctx.beginPath();ctx.moveTo(d.x+Math.cos(a)*d.size*.4,d.y+Math.sin(a)*d.size*.4);ctx.lineTo(d.x+Math.cos(a)*d.size*1.1,d.y+Math.sin(a)*d.size*.9);ctx.stroke();}ctx.restore();}
}
function drawProjectile(b){
 const dx=b.tx-b.x,dy=b.ty-b.y,a=Math.atan2(dy,dx),dist=Math.hypot(dx,dy);
 const phase=clamp((b.age||0)/(Math.max(40,b.startDist||dist)/b.speed),0,1),arc=b.type==='cannon'?Math.sin(phase*Math.PI)*24:0;
 ctx.save();
 if(b.type==='cannon'){ctx.fillStyle='#111a2140';ctx.beginPath();ctx.ellipse(b.x,b.y+3,4,2,0,0,Math.PI*2);ctx.fill();}
 ctx.translate(b.x,b.y-arc);ctx.rotate(a);
 if(b.type==='frost'){ctx.strokeStyle='#a5e9ff77';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(2,0);ctx.stroke();ctx.fillStyle='#e6fbff';ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-1,-3);ctx.lineTo(-4,0);ctx.lineTo(-1,3);ctx.closePath();ctx.fill();}
 else if(b.type==='cannon'){ctx.fillStyle='#ffdd96';ctx.beginPath();ctx.arc(0,0,3.6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#674833';ctx.fillRect(-2,-2,3,3);ctx.strokeStyle='#ffbc6e88';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(-4,0);ctx.stroke();}
 else{ctx.strokeStyle='#72e5ff70';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-13,0);ctx.lineTo(3,0);ctx.stroke();ctx.strokeStyle='#e3ffff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-8,0);ctx.lineTo(4,0);ctx.stroke();}
 ctx.restore();
}
function drawEffects(){
 for(const b of beams){
  if(b.explosion)continue;const alpha=b.life/b.maxLife;ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=alpha;
  for(const[w,c]of[[9,b.color+'22'],[4,b.color+'aa'],[1.4,'#fff5ff']]){ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.tx,b.ty);ctx.stroke();}
  if(fullEffects){ctx.strokeStyle='#c4c9ff';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(b.x,b.y);for(let i=1;i<=8;i++){const f=i/8;ctx.lineTo(b.x+(b.tx-b.x)*f+Math.sin(i*5+state.time*65)*2,b.y+(b.ty-b.y)*f+Math.cos(i*6+state.time*55)*2);}ctx.stroke();}ctx.restore();
 }
 for(const m of FX.muzzles){const f=m.life/m.maxLife;ctx.save();ctx.translate(m.x,m.y);ctx.rotate(m.angle);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=f;ctx.fillStyle=m.type==='frost'?'#c6f3ff':m.type==='rail'?'#f3d4ff':'#fff1bd';ctx.beginPath();ctx.moveTo(-2,-2);ctx.lineTo(12*f,-5*f);ctx.lineTo(8*f,0);ctx.lineTo(12*f,5*f);ctx.lineTo(-2,2);ctx.closePath();ctx.fill();ctx.restore();}
 for(const r of FX.rings){const f=r.life/r.duration,p=1-f;ctx.save();ctx.globalAlpha=Math.min(1,f*2);ctx.lineWidth=r.kind==='shield'?2:1.6;ctx.strokeStyle=r.color;
  if(r.kind==='flash'){ctx.globalCompositeOperation='lighter';ctx.fillStyle=r.color;ctx.globalAlpha=f*.6;ctx.beginPath();ctx.arc(r.x,r.y,Math.max(1,r.radius*(.2+p*.8)),0,Math.PI*2);ctx.fill();}
  else{ctx.beginPath();ctx.ellipse(r.x,r.y,r.radius*(.2+p*.8),r.radius*(r.kind==='ice'?.65:.8)*(.2+p*.8),0,0,Math.PI*2);ctx.stroke();}ctx.restore();}
 for(const p of particles){ctx.save();ctx.globalAlpha=clamp(p.life*2,0,1);ctx.strokeStyle=p.color;ctx.lineWidth=p.size*.65;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.027,p.y-p.vy*.027);ctx.stroke();ctx.restore();}
 for(const s of FX.smoke){ctx.save();ctx.globalAlpha=Math.min(.24,s.life*.22);ctx.fillStyle=s.color;ctx.beginPath();ctx.ellipse(s.x,s.y,s.size,s.size*.8,0,0,Math.PI*2);ctx.fill();ctx.restore();}
}
function render(){
 clearView();ctx.save();
 if(fullEffects&&!REDUCED_MOTION&&FX.shake>.05)ctx.translate(Math.sin(state.time*83)*FX.shake,Math.cos(state.time*67)*FX.shake*.65);
 ctx.beginPath();ctx.rect(0,0,WIDTH,HEIGHT);ctx.clip();
 ctx.drawImage(landscape,0,0);drawOrbitalCraters();drawScorchFields();drawAirCorridors(ctx);if(state.mode==='campaign')for(const p of sectorPads(state.sectorId))drawBuildPad(ctx,p,!!towerAt(p.c,p.r));drawGroundEffects();paintCommanderGround();
 const selected=selectedTower(),preview=selectedType&&hover?{type:selectedType,level:1,x:(hover.c+.5)*CELL,y:(hover.r+.5)*CELL}:null;
 if(selected||preview){const t=selected||preview,s=towerStats(t);ctx.fillStyle='#152d4630';ctx.strokeStyle=s.color+'bb';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(t.x,t.y,s.range,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);}
 if(hover&&!abilityAim&&!paused&&state.phase!=='lose'){
  const valid=validCell(hover.c,hover.r),color=valid?'#d4fa7a':'#ff8f79';ctx.fillStyle=color+'24';ctx.strokeStyle='#142331';ctx.lineWidth=1.5;ctx.fillRect(hover.c*CELL+1,hover.r*CELL+1,CELL-2,CELL-2);ctx.strokeRect(hover.c*CELL+2,hover.r*CELL+2,CELL-4,CELL-4);
  if(preview&&valid)drawTower({...preview,angle:-Math.PI/2},true);
 }
 if(selected){ctx.strokeStyle='#e7ff9f';ctx.lineWidth=1.5;roundRect(selected.x-24,selected.y-24,48,48,4);ctx.stroke();
  const target=chooseTarget(selected);if(target&&fullEffects){ctx.strokeStyle='#e8ffb660';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(selected.x,selected.y);ctx.lineTo(target.x,target.y);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#e9ffab';ctx.beginPath();ctx.arc(target.x,target.y,16,0,Math.PI*2);ctx.stroke();}
 }
 drawSupportCoverage(selected);
 for(const t of state.towers)drawTower(t);
 drawCore();drawProgressionEffects();for(const e of state.enemies)if(e.hp>0&&!isAirUnit(e))drawEnemy(e);for(const e of state.enemies)if(e.hp>0&&isAirUnit(e))drawEnemy(e);
 for(const b of state.shots)drawProjectile(b);drawEffects();drawAbilityEffects();paintCommanderEffects();
 ctx.font='700 10px system-ui';ctx.textAlign='center';ctx.lineWidth=2.5;ctx.strokeStyle='#15222be0';
 for(const f of floaters){ctx.save();ctx.globalAlpha=Math.min(1,f.life*2);ctx.fillStyle=f.color;ctx.translate(f.x,f.y);if(VIEW.rotated)ctx.rotate(-Math.PI/2);ctx.strokeText(f.text,0,0);ctx.fillText(f.text,0,0);ctx.restore();}ctx.globalAlpha=1;
 if(FX.coreHit>0){ctx.fillStyle='#ff49320e';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.strokeStyle='#ff795a'+Math.floor(FX.coreHit*100).toString(16).padStart(2,'0');ctx.lineWidth=5;ctx.strokeRect(2,2,WIDTH-4,HEIGHT-4);}
 ctx.restore();paintAttackForecast();
}

// Viewport camera: game-space geometry is unchanged when the browser resizes.
// Camera uses the entire viewport; HUD is an overlay, never a reserved strip.
// Fixed automatic scale fills the viewport. Gestures only move the camera.
function viewRect(w,h,forceRotated=null){
 w=Math.max(1,Number(w)||WIDTH);h=Math.max(1,Number(h)||HEIGHT);
 const rotated=forceRotated??(h>w*1.15),dw=rotated?HEIGHT:WIDTH,dh=rotated?WIDTH:HEIGHT;
 const scale=Math.max(w/dw,h/dh);
 return {w,h,scale,x:(w-dw*scale)/2,y:(h-dh*scale)/2,rotated,ratio:1};
}
let VIEW=viewRect(WIDTH,HEIGHT),sessionStarted=false;
const CAMERA={center:{x:WIDTH/2,y:HEIGHT/2},ready:false};
const CAMERA_INPUT={points:new Map(),gesture:null,blocked:false,until:0};

const UI={context:null,cell:null,anchor:null,modalBasePaused:true};
const MODALS=['menuDialog','helpDialog','resetDialog','intelDialog','researchDialog','missionDetailsDialog','sectorMapDialog','entryForecastDialog'];
function worldToScreen(x,y){return VIEW.rotated?{x:VIEW.x+(HEIGHT-y)*VIEW.scale,y:VIEW.y+x*VIEW.scale}:{x:VIEW.x+x*VIEW.scale,y:VIEW.y+y*VIEW.scale};}
function screenToWorld(x,y){
 const wx=VIEW.rotated?(y-VIEW.y)/VIEW.scale:(x-VIEW.x)/VIEW.scale,wy=VIEW.rotated?HEIGHT-(x-VIEW.x)/VIEW.scale:(y-VIEW.y)/VIEW.scale;
 return {x:wx,y:wy,inside:wx>=0&&wx<=WIDTH&&wy>=0&&wy<=HEIGHT};
}
function screenArrowDelta(key){
 const normal={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
 const rotated={ArrowLeft:[0,1],ArrowRight:[0,-1],ArrowUp:[-1,0],ArrowDown:[1,0]};
 return (VIEW.rotated?rotated:normal)[key]||null;
}
function applyView(){
 const r=VIEW.ratio,s=VIEW.scale;
 if(VIEW.rotated)ctx.setTransform(0,r*s,-r*s,0,r*(VIEW.x+HEIGHT*s),r*VIEW.y);
 else ctx.setTransform(r*s,0,0,r*s,r*VIEW.x,r*VIEW.y);
}
function clearView(){
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
 if(ART.battleBackdrop){
  const image=ART.battleBackdrop,scale=Math.max(canvas.width/image.width,canvas.height/image.height),w=image.width*scale,h=image.height*scale;
  ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
 }
 else{ctx.fillStyle='#192932';ctx.fillRect(0,0,canvas.width,canvas.height);}
 ctx.restore();applyView();
}
function cameraMetrics(){
 const dw=VIEW.rotated?HEIGHT:WIDTH,dh=VIEW.rotated?WIDTH:HEIGHT,scale=Math.max(VIEW.w/dw,VIEW.h/dh);
 // A small screen-space margin uncovers edge cells behind even the phone HUD.
 return {dw,dh,scale,padX:Math.min(160,VIEW.w*.28),padY:Math.min(160,VIEW.h*.28)};
}
function syncCamera(){
 const m=cameraMetrics();VIEW.scale=m.scale;
 const center=VIEW.rotated?{x:HEIGHT-CAMERA.center.y,y:CAMERA.center.x}:CAMERA.center;
 VIEW.x=clamp(VIEW.w/2-center.x*VIEW.scale,VIEW.w-m.dw*VIEW.scale-m.padX,m.padX);
 VIEW.y=clamp(VIEW.h/2-center.y*VIEW.scale,VIEW.h-m.dh*VIEW.scale-m.padY,m.padY);
 const cx=(VIEW.w/2-VIEW.x)/VIEW.scale,cy=(VIEW.h/2-VIEW.y)/VIEW.scale;
 CAMERA.center=VIEW.rotated?{x:cy,y:HEIGHT-cx}:{x:cx,y:cy};
 applyView();positionContextPanel();refreshCameraUI();
}
function setCameraOffset(x,y){
 const cx=(VIEW.w/2-x)/VIEW.scale,cy=(VIEW.h/2-y)/VIEW.scale;
 CAMERA.center=VIEW.rotated?{x:cy,y:HEIGHT-cx}:{x:cx,y:cy};syncCamera();
}
function panCamera(dx,dy){setCameraOffset(VIEW.x+dx,VIEW.y+dy);}
function centerMap(){CAMERA.center={x:WIDTH/2,y:HEIGHT/2};syncCamera();}
function revealCell(c,r){
 const p=worldToScreen((c+.5)*CELL,(r+.5)*CELL),top=Math.min(VIEW.w<=820?160:120,VIEW.h*.3),bottom=Math.min(VIEW.w<=820?155:100,VIEW.h*.3);
 panCamera(clamp(p.x,32,Math.max(32,VIEW.w-32))-p.x,clamp(p.y,top,Math.max(top,VIEW.h-bottom))-p.y);
}
function refreshCameraUI(){
 const centered=Math.abs(CAMERA.center.x-WIDTH/2)<.01&&Math.abs(CAMERA.center.y-HEIGHT/2)<.01;
 $('cameraReset').disabled=centered;
}
function fitCanvas(){
 const stage=$('gameStage'),w=stage?.clientWidth||window.innerWidth||WIDTH,h=stage?.clientHeight||window.innerHeight||HEIGHT;
 const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(8000000/(w*h)));
 VIEW={...viewRect(w,h),ratio};CAMERA.ready=true;syncCamera();
 const cw=Math.round(w*ratio),ch=Math.round(h*ratio);if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
 applyView();
}
function cameraPoint(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function cameraCentroid(){
 let x=0,y=0;for(const p of CAMERA_INPUT.points.values()){x+=p.x;y+=p.y;}
 const n=CAMERA_INPUT.points.size;return{x:x/n,y:y/n};
}
function beginCameraDrag(){
 if(CAMERA_INPUT.gesture?.moved)return;
 if(CAMERA_INPUT.gesture)CAMERA_INPUT.gesture.moved=true;
 CAMERA_INPUT.blocked=true;CAMERA_INPUT.until=performance.now()+800;
 closeContextPanel(false);closePerkTooltip();hover=null;abilityPointer=null;canvas.classList.add('is-dragging');
}
function blockCameraClick(){CAMERA_INPUT.blocked=true;CAMERA_INPUT.until=performance.now()+800;}
function cameraClickBlocked(){
 const blocked=CAMERA_INPUT.blocked&&performance.now()<=CAMERA_INPUT.until;
 CAMERA_INPUT.blocked=false;return blocked;
}
function endCameraGesture(){
 CAMERA_INPUT.points.clear();CAMERA_INPUT.gesture=null;canvas.classList.remove('is-dragging');
}
function initCameraInput(){
 const input=CAMERA_INPUT;
 canvas.addEventListener('pointerdown',e=>{
  if(!sessionStarted||anyDialogOpen()||(e.button!==0&&e.button!==1))return;
  const id=e.pointerId??1,p=cameraPoint(e);
  if(input.points.has(id))endCameraGesture();
  if(!input.points.size){input.blocked=false;input.gesture={start:p,last:p,moved:false,multi:false};}
  input.points.set(id,p);
  try{canvas.setPointerCapture?.(id);}catch(_e){}
  if(input.points.size>=2){beginCameraDrag();input.gesture={moved:true,multi:true,last:cameraCentroid()};}
 });
 canvas.addEventListener('pointermove',e=>{
  const id=e.pointerId??1,p=cameraPoint(e),g=input.gesture;
  if(input.points.has(id)&&g){
   input.points.set(id,p);
   if(g.multi&&input.points.size>=2){
    const mid=cameraCentroid();panCamera(mid.x-g.last.x,mid.y-g.last.y);g.last=mid;blockCameraClick();return;
   }
   if(!g.moved&&Math.hypot(p.x-g.start.x,p.y-g.start.y)>7)beginCameraDrag();
   if(g.moved){panCamera(p.x-g.last.x,p.y-g.last.y);g.last=p;blockCameraClick();return;}
  }
  hover=cellFromEvent(e);if(abilityAim){const q=screenToWorld(p.x,p.y);abilityPointer=q.inside?q:null;}
  if(hover)keyboardCell={...hover};
 });
 const release=(e,cancel=false)=>{
  const id=e.pointerId??1;if(!input.points.has(id))return;
  const moved=input.gesture?.moved||cancel;if(moved)blockCameraClick();input.points.delete(id);
  if(input.points.size){const p=cameraCentroid();input.gesture={start:p,last:p,moved:!!moved,multi:input.points.size>=2};}
  else endCameraGesture();
 };
 canvas.addEventListener('pointerup',e=>release(e));
 canvas.addEventListener('pointercancel',e=>release(e,true));
 canvas.addEventListener('lostpointercapture',e=>release(e,true));
 canvas.addEventListener('pointerleave',()=>{if(!UI.context)hover=null;});
 canvas.addEventListener('wheel',e=>{if(sessionStarted&&!anyDialogOpen())e.preventDefault();},{passive:false});
 window.addEventListener('blur',()=>{if(input.points.size)blockCameraClick();endCameraGesture();});
 $('cameraReset').addEventListener('click',centerMap);
}

function cellFromEvent(e){
 const r=canvas.getBoundingClientRect(),p=screenToWorld(e.clientX-r.left,e.clientY-r.top);
 if(!p.inside||p.x>=WIDTH||p.y>=HEIGHT)return null;
 return {c:Math.floor(p.x/CELL),r:Math.floor(p.y/CELL)};
}
function anyDialogOpen(){return MODALS.some(id=>$(id)?.open);}
function closeContextPanel(clearSelection=true){
 UI.context=null;UI.cell=null;UI.anchor=null;$('contextPanel').hidden=true;
 if(clearSelection){abilityAim=null;abilityPointer=null;selectedType=null;selectedId=null;hover=null;}uiDirty=true;
}
function positionContextPanel(){
 const el=$('contextPanel');if(!UI.context||!el||el.hidden||typeof el.getBoundingClientRect!=='function')return;
 const a=UI.cell?worldToScreen((UI.cell.c+.5)*CELL,(UI.cell.r+.5)*CELL):(UI.anchor||{x:VIEW.w*.5,y:VIEW.h-65});
 const rect=el.getBoundingClientRect(),w=rect.width,h=rect.height;
 let x=a.x+18;if(x+w>VIEW.w-10)x=a.x-w-18;x=clamp(x,10,Math.max(10,VIEW.w-w-10));
 const y=clamp(a.y-h*.5,54,Math.max(54,VIEW.h-h-10));el.style.left=Math.round(x)+'px';el.style.top=Math.round(y)+'px';
}
function showContext(mode,cell=null,anchor=null){
 UI.context=mode;UI.cell=cell?{...cell}:null;UI.anchor=anchor;
 $('contextPanel').hidden=false;$('buildOptions').hidden=mode!=='build';$('selectionPanel').hidden=mode!=='tower';
 $('contextTitle').textContent=mode==='tower'?'Управление башней':cell&&state.mode==='campaign'?'Площадка строительства':cell?'Построить здесь':'Арсенал';
 refreshUI();positionContextPanel();
}
function interactCell(c,r){
 if(!sessionStarted||paused||ART.loading||!['build','wave'].includes(state.phase)||anyDialogOpen())return;
 if(selectedId!==null||UI.context==='tower'){closeContextPanel();selectedType=null;}
 const tower=towerAt(c,r);
 if(tower){placeAt(c,r);showContext('tower',{c,r});return;}
 if(!validCell(c,r)){closeContextPanel();notify(state.mode==='campaign'?'Выбери свободную строительную площадку.':'На дороге строить нельзя.',true);return;}
 if(selectedType){placeAt(c,r);return;}
 selectedId=null;hover={c,r};showContext('build',{c,r});
}
function handleBoardTap(e){
 if(e.button!==0)return;if(cameraClickBlocked()){e.preventDefault?.();e.stopPropagation?.();return;}e.stopPropagation?.();closePerkTooltip();if(abilityAim){const rect=canvas.getBoundingClientRect(),p=screenToWorld(e.clientX-rect.left,e.clientY-rect.top);if(p.inside)castAbility('orbital',p);else closeContextPanel();return;}const p=cellFromEvent(e);if(!p){closeContextPanel();return;}
 keyboardCell={...p};hover={...p};interactCell(p.c,p.r);
}
function buyFromContext(type){
 if(paused||!sessionStarted||!towerAllowed(type)||!['build','wave'].includes(state.phase))return;
 const cell=UI.cell?{...UI.cell}:null;chooseType(type);
 if(cell){
  placeAt(cell.c,cell.r);
  if(towerAt(cell.c,cell.r)){closeContextPanel();canvas.focus({preventScroll:true});}
 }else{
  closeContextPanel(false);selectedType=type;selectedId=null;notify(TOWERS[type].name+' выбрана. Нажми свободную клетку.');canvas.focus({preventScroll:true});
 }
 uiDirty=true;
}
function openArsenal(){
 if(paused||!sessionStarted||!['build','wave'].includes(state.phase))return;
 abilityAim=null;selectedId=null;selectedType=null;const r=$('arsenalBtn').getBoundingClientRect();showContext('build',null,{x:r.x+r.width/2,y:r.top});
}
function showDialog(id){
 if(battleResultPending())return;
 closePerkTooltip();if($(id).open)return;if(!anyDialogOpen())UI.modalBasePaused=paused;
 closeContextPanel();setPause(true);$(id).showModal();uiDirty=true;
}
function closeDialog(id){
 if(id==='rewardDialog'&&state.rewardQueue.length)return;
 $(id).close();
 if(!anyDialogOpen()){if(sessionStarted)setPause(UI.modalBasePaused);else paused=true;}
 uiDirty=true;
}
function closeAllDialogs(){for(const id of MODALS)if($(id).open)$(id).close();}
function openMenu(){showDialog('menuDialog');}
function startSession(){
 if(ART.loading)return;
 if(state.phase==='lose'){retryBattle();return;}
 closeAllDialogs();closeContextPanel();sessionStarted=true;$('startScreen').hidden=true;$('gameHud').hidden=false;
 selectedType=null;selectedId=null;paused=state.phase==='win';endCameraGesture();fitCanvas();uiDirty=true;
 canvas.focus({preventScroll:true});appScreen='battle';$('campaignScreen').hidden=true;refreshLabUI();notify(state.mode==='campaign'?'Строй на строительных площадках · Крио удерживает цели под огнём':'Клик — построить · Перетаскивание — сдвинуть карту');
}
function resumeMenu(){
 if(!sessionStarted){closeDialog('menuDialog');return;}
 if(state.phase==='lose'){closeAllDialogs();retryBattle();return;}if(state.phase==='win'){finishBattleToMap();return;}
 UI.modalBasePaused=false;closeDialog('menuDialog');
}
function refreshShellUI(){
 $('buildModeBadge').hidden=!sessionStarted||!selectedType||paused;
 if(selectedType)$('buildModeText').textContent=TOWERS[selectedType].name+' · '+TOWERS[selectedType].cost+' · выбери клетку';
 $('soundState').textContent=sound?'Вкл.':'Выкл.';$('fxBtn').textContent=fullEffects?'Полные':'Лёгкие';
 $('menuResumeBtn').textContent=!sessionStarted?'К заставке':state.phase==='lose'?'Новая попытка':state.phase==='win'?'К карте кампании':'Продолжить';
 $('fullscreenBtn').textContent=document.fullscreenElement?'Выйти':'На весь экран';
 if(UI.context==='tower'&&!selectedTower())closeContextPanel();
 if(UI.context)positionContextPanel();
}
function initShell(restored){
 paused=true;sessionStarted=false;selectedType=null;selectedId=null;$('gameHud').hidden=true;$('startScreen').hidden=false;$('contextPanel').hidden=true;
 const resumable=restored&&state.phase!=='lose'&&(state.wave>0||state.towers.length>0||state.time>0);
 $('startGameBtn').textContent='Кампания';$('startGameBtn').disabled=true;
 $('fullscreenBtn').hidden=!document.documentElement?.requestFullscreen;
 assetsReady.then(()=>{
  if(ART.logo){$('titleArt').src=ART.logo.src;$('pauseLogo').src=ART.logo.src;}
  $('startGameBtn').disabled=false;$('splashStatus').textContent=ART.ready?'29 секторов · 3 сложности · Одно ядро · Постоянные технологии':'Графика недоступна. Можно запустить резервный режим.';
  uiDirty=true;
 });
 $('startGameBtn').addEventListener('click',()=>openCommandCenter());$('splashMenuBtn').addEventListener('click',openMenu);$('menuBtn').addEventListener('click',openMenu);
 $('menuResumeBtn').addEventListener('click',resumeMenu);$('closeMenuBtn').addEventListener('click',()=>closeDialog('menuDialog'));
 $('intelBtn').addEventListener('click',()=>showDialog('intelDialog'));$('closeIntelBtn').addEventListener('click',()=>closeDialog('intelDialog'));
 $('closeEntryForecast').addEventListener('click',()=>closeDialog('entryForecastDialog'));
 $('arsenalBtn').addEventListener('click',openArsenal);$('closeContextBtn').addEventListener('click',()=>closeContextPanel());$('cancelBuildBtn').addEventListener('click',()=>closeContextPanel());
 $('fullscreenBtn').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();$('menuMessage').textContent='';fitCanvas();}
  catch(e){$('menuMessage').textContent='Полноэкранный режим недоступен в этом окне. Карта уже подстроена под размер браузера.';}
  uiDirty=true;
 });
 for(const id of ['menuDialog','intelDialog','entryForecastDialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();closeDialog(id);});
 document.addEventListener('pointerdown',e=>{
  if(!UI.context||e.target===canvas||$('contextPanel').contains(e.target)||e.target.closest?.('#arsenalBtn'))return;
  closeContextPanel();
 });
 document.addEventListener('fullscreenchange',()=>{fitCanvas();uiDirty=true;});window.visualViewport?.addEventListener('resize',fitCanvas);
 refreshUI();
}

// Run progression, mutually exclusive tower specializations and commander abilities.
const BRANCHES={
 pulse:{rapid:{name:'Шквал',mark:'Ⅱ',desc:'Интервал между выстрелами −48%; урон попадания −15%. Сильнее против лёгких целей, броню не игнорирует.',color:'#6bdfef'},piercer:{name:'Пробойник',mark:'◆',desc:'На 45% больше урона, игнорирует броню; стреляет на 11% реже.',color:'#f4d493'}},
 cannon:{blast:{name:'Ковровый огонь',mark:'◎',desc:'Радиус взрыва +55%; урон каждого попадания ниже на 15%.',color:'#ffb56b'},scorch:{name:'Выжженная земля',mark:'♨',desc:'Горящий участок на 3 с. Урон разрыва −35%, радиус −15%, интервал +10%. Только наземные цели.',color:'#ff914b'}},
 frost:{permafrost:{name:'Вечная мерзлота',mark:'❄',desc:'Замедляет на 76% на 3 секунды; урон ниже на 15%.',color:'#a1e7ff'},blizzard:{name:'Метель',mark:'✣',desc:'Замедляет группу в радиусе 1.25 клетки на 38% на 1.6 секунды.',color:'#b6bdff'}},
 rail:{sniper:{name:'Дальний приговор',mark:'◇',desc:'Урон +75%, дальность +1 клетка; стреляет на 17% реже.',color:'#e3c6ff'},chain:{name:'Цепная молния',mark:'ϟ',desc:'Два скачка в пределах 2.7 клетки: 55% и 30% урона. Игнорирует броню.',color:'#abafff'}}
};
const PERKS={
 reactor:{name:'Фокусировка',icon:'◈',max:5,desc:'Все орудия: +12% урона за каждый ранг.'},
 optics:{name:'Дальнее обнаружение',icon:'⌖',max:4,desc:'Все орудия: +8% дальности за каждый ранг.'},
 loader:{name:'Автозарядка',icon:'Ⅱ',max:5,desc:'Все орудия: +10% скорострельности за каждый ранг.'},
 blast:{name:'Объёмный заряд',icon:'◎',max:4,desc:'Все атаки по площади: +15% радиуса за каждый ранг.'},
 cryo:{name:'Криокатализатор',icon:'❄',max:4,desc:'Длительность замедления Крио и оглушения ЭМИ: +25% за ранг.'},
 tactics:{name:'Резервные контуры',icon:'ϟ',max:3,desc:'Перезарядка всех активных способностей: −10% за каждый ранг.'},
 coreShield:{name:'Щит ядра',icon:'⬡',max:3,desc:'Ёмкость щита +2 и заряд +2 за ранг. Через 10 с без попаданий: +1 заряда каждые 6 с.'},
 repair:{name:'Полевой ремонт',icon:'+',max:100000,instant:true,desc:'Сразу восстановить до 5 единиц прочности ядра.'}
};
const ABILITIES={
 emp:{name:'ЭМИ',key:'Q',icon:'ϟ',cooldown:55,color:'#83deff',desc:'Оглушает всех врагов на 4 с, боссов — на 1.6 с.'},
 orbital:{name:'Орбитальный удар',key:'E',icon:'⌖',cooldown:70,color:'#ffb56b',desc:'Укажи точку: удар через 1.05 с, радиус 2.25 клетки. Игнорирует броню.'},
 shield:{name:'Аварийный щит',key:'R',icon:'⬡',cooldown:90,color:'#8dffd6',desc:'Поглощает до 8 урона по ядру. Работает 12 с.'}
};
const UI_ICON_CELLS={reactor:0,optics:1,loader:2,blast:3,cryo:4,tactics:5,coreShield:6,repair:7,emp:8,orbital:9,shield:10,intel:11};
function techIcon(id){
 if(!Object.hasOwn(UI_ICON_CELLS,id))return '';
 const i=UI_ICON_CELLS[id],x=(i%4)*100/3,y=Math.floor(i/4)*50;
 return '<span class="ui-sprite" data-icon="'+id+'" style="background-position:'+x+'% '+y+'%" aria-hidden="true"></span>';
}
let abilityAim=null,abilityPointer=null,progressSaveNeeded=false;
function freshProgression(){return {encounterBalance:1,techPoints:0,techEarned:0,mode:'endless',campaignWon:false,campaignStars:0,campaignLives:0,campaignTime:0,enemiesLeaked:0,perfectRunEligible:true,repairReady:false,research:{},rewardQueue:[],rewardedWaves:[],abilities:{emp:0,orbital:0,shield:0},coreShield:0,shieldUntil:0,passiveShield:0,shieldRegenAt:0,orbitalStrikes:[],orbitalCraters:[],scorchFields:[],bossShots:[],waveClock:null};}
function perkRank(id){return state.research?.[id]||0;}
function passiveShieldCapacity(){return 2*perkRank('coreShield');}
function abilityCooldown(id){return ABILITIES[id].cooldown*Math.pow(.9,perkRank('tactics'))*(state.mode==='campaign'&&state.difficulty===2&&state.sectorId%4===1&&id==='orbital'?1.25:1);}

function chooseBranch(id){
 const t=selectedTower();if(!t||t.disabled||t.level<2||t.branch||paused||state.rewardQueue.length||!sessionStarted||state.phase==='lose'||!Object.hasOwn(BRANCHES[t.type],id)||towerLevelCap()<3)return false;
 const cost=t.level===3?0:upgradeCost(t);if(state.money<cost){notify('Для специализации нужно '+cost+' кредитов.',true);return false;}
 state.money-=cost;t.invested+=cost;t.level=3;t.branch=id;t.cooldown=Math.min(t.cooldown,towerStats(t).rate);
 burst(t.x,t.y,BRANCHES[t.type][id].color,24);ring(t.x,t.y,BRANCHES[t.type][id].color,42,.65);floatText(t.x,t.y-24,BRANCHES[t.type][id].name,'#d4fa7a');
 saveProgress();uiDirty=true;beep(820,.14,.05,'triangle');notify(BRANCHES[t.type][id].name+' · специализация установлена');return true;
}
function applySlow(e,factor,duration){
 if(e.hp<=0)return;
 refreshEnemySlow(e);
 const existing=e.slowEffects.find(s=>Math.abs(s.factor-factor)<1e-8);
 if(existing)existing.until=Math.max(existing.until,state.time+duration);
 else e.slowEffects.push({factor,until:state.time+duration});
 refreshEnemySlow(e);
}
function canUseAbility(id){return Object.hasOwn(ABILITIES,id)&&sessionStarted&&!paused&&!state.rewardQueue.length&&state.phase!=='lose'&&state.phase!=='win'&&!ART.loading&&state.abilities[id]<=0;}
function startAbility(id){
 if(!canUseAbility(id))return false;
 if(id==='orbital'){
  if(!state.enemies.some(e=>e.hp>0)){notify('Орбитальная поддержка ждёт появления противников.',true);return false;}
  closeContextPanel();abilityAim='orbital';abilityPointer=null;uiDirty=true;notify('Укажи точку орбитального удара. Esc — отмена.');canvas.focus({preventScroll:true});return true;
 }
 return castAbility(id);
}
function castAbility(id,point=null){
 if(!canUseAbility(id))return false;
 if(id!=='shield'&&!state.enemies.some(e=>e.hp>0))return false;
 if(id==='orbital'&&(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>WIDTH||point.y<0||point.y>HEIGHT))return false;
 closeContextPanel();state.abilities[id]=abilityCooldown(id);
 if(id==='emp'){
  const duration=1+.25*perkRank('cryo');for(const e of state.enemies)if(e.hp>0)e.stunUntil=Math.max(e.stunUntil||0,state.time+(e.type==='boss'?1.6:4)*duration);
  empVisual();beep(140,.25,.05,'sawtooth');notify('ЭМИ: движение противников остановлено');
 }else if(id==='orbital'){
  state.orbitalStrikes.push({x:point.x,y:point.y,remaining:1.05,radius:108*(1+.15*perkRank('blast')),damage:Math.round((240+state.wave*38)*(1+.12*perkRank('reactor')))});
  beep(820,.16,.04,'sine');notify('Орбитальный удар: цель подтверждена');
 }else{
  state.coreShield=8;state.shieldUntil=state.time+12;ring(CORE.x,CORE.y,'#8dffd6',62,.7,'shield');beep(620,.17,.05,'triangle');notify('Щит активен на 12 с · защита от 8 урона');
 }
 saveProgress();uiDirty=true;return true;
}
function applyCoreDamage(damage){
 if(!Number.isFinite(damage)||damage<=0)return 0;
 const active=state.shieldUntil>state.time?Math.min(state.coreShield,damage):0;
 state.coreShield=Math.max(0,state.coreShield-active);const passive=Math.min(state.passiveShield,damage-active),absorbed=active+passive,dealt=damage-absorbed;
 state.passiveShield-=passive;if(passiveShieldCapacity()>0)state.shieldRegenAt=state.time+16;
 if(absorbed){ring(CORE.x,CORE.y,active?'#8dffd6':'#87d7ff',54,.4,'shield');floatText(CORE.x-15,CORE.y-28,'ЩИТ −'+absorbed,active?'#8dffd6':'#87d7ff');}
 if(dealt){state.lives=Math.max(0,state.lives-dealt);coreImpact(dealt);floatText(CORE.x-20,CORE.y-28,'−'+dealt,'#ff8e88');}
 uiDirty=true;return dealt;
}
function progressTick(dt){
 for(const id of Object.keys(ABILITIES))state.abilities[id]=Math.max(0,state.abilities[id]-dt);
 if(state.shieldUntil<=state.time)state.coreShield=0;
 const capacity=passiveShieldCapacity();
 if(capacity>0&&state.passiveShield<capacity){
  if(state.shieldRegenAt===0)state.shieldRegenAt=state.time+6;
  if(state.time+1e-8>=state.shieldRegenAt){const count=1+Math.floor(Math.max(0,state.time-state.shieldRegenAt+1e-8)/6);state.passiveShield=Math.min(capacity,state.passiveShield+count);state.shieldRegenAt=state.passiveShield<capacity?state.shieldRegenAt+count*6:0;uiDirty=true;}
 }else state.shieldRegenAt=0;
 const impacts=[];for(const p of state.orbitalStrikes){p.remaining-=dt;if(p.remaining<=0)impacts.push(p);}
 state.orbitalStrikes=state.orbitalStrikes.filter(p=>p.remaining>0);
 for(const p of impacts){
  for(const e of state.enemies)if(e.hp>0&&Math.hypot(e.x-p.x,e.y-p.y)<=p.radius)damageEnemy(e,p.damage,true);
  orbitalImpactVisual(p);beep(70,.28,.08,'triangle');
 }
}
function drawProgressionEffects(){
 for(const p of state.orbitalStrikes){
  ctx.save();ctx.strokeStyle='#ffc88d';ctx.fillStyle='#ffae6820';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(p.x,p.y,p.radius*(1-p.remaining/1.05),0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x-14,p.y);ctx.lineTo(p.x+14,p.y);ctx.moveTo(p.x,p.y-14);ctx.lineTo(p.x,p.y+14);ctx.stroke();ctx.restore();
 }
 if(state.coreShield>0&&state.shieldUntil>state.time){
  ctx.save();ctx.strokeStyle='#8dffd6';ctx.fillStyle='#8dffd61a';ctx.lineWidth=2.5;hex(CORE.x-5,CORE.y,43,state.time*.12);ctx.fill();ctx.stroke();ctx.restore();
 }
 if(state.passiveShield>0){ctx.save();ctx.strokeStyle='#87d7ff';ctx.fillStyle='#87d7ff0d';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(CORE.x-5,CORE.y,35,0,Math.PI*2*state.passiveShield/passiveShieldCapacity());ctx.fill();ctx.stroke();ctx.restore();}
 if(abilityAim==='orbital'&&hover&&!paused){
  const x=abilityPointer?.x??(hover.c+.5)*CELL,y=abilityPointer?.y??(hover.r+.5)*CELL;ctx.save();ctx.strokeStyle='#ffce95';ctx.fillStyle='#ffb56b22';ctx.setLineDash([6,4]);ctx.beginPath();ctx.arc(x,y,108*(1+.15*perkRank('blast')),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x-12,y);ctx.lineTo(x+12,y);ctx.moveTo(x,y-12);ctx.lineTo(x,y+12);ctx.stroke();ctx.restore();
 }
}
function drawBranchBadge(g,t){
 g.save();g.translate(t.x+17,t.y+17);if(VIEW.rotated)g.rotate(-Math.PI/2);g.fillStyle='#112837';g.fillRect(-7,-7,14,14);g.strokeStyle=BRANCHES[t.type][t.branch].color;g.lineWidth=1.3;g.beginPath();
 const id=t.branch;
 if(id==='rapid'){g.moveTo(-2,-4);g.lineTo(-2,4);g.moveTo(2,-4);g.lineTo(2,4);}
 else if(id==='blast'){g.arc(0,0,5,0,Math.PI*2);g.moveTo(2,0);g.arc(0,0,2,0,Math.PI*2);}
 else if(id==='scorch'){g.moveTo(-4,4);g.lineTo(-3,-1);g.lineTo(0,1);g.lineTo(2,-5);g.lineTo(5,4);g.closePath();}
 else if(id==='permafrost'){for(let i=0;i<3;i++){const a=i*Math.PI/3;g.moveTo(-Math.cos(a)*5,-Math.sin(a)*5);g.lineTo(Math.cos(a)*5,Math.sin(a)*5);}}
 else if(id==='blizzard'){for(const [x,y]of[[-3,-2],[3,-2],[0,3]]){g.moveTo(x+1,y);g.arc(x,y,1,0,Math.PI*2);}}
 else if(id==='chain'){g.moveTo(2,-5);g.lineTo(-3,1);g.lineTo(2,1);g.lineTo(-2,5);}
 else{g.moveTo(0,-5);g.lineTo(4,0);g.lineTo(0,5);g.lineTo(-4,0);g.closePath();if(id==='sniper'){g.moveTo(-6,0);g.lineTo(6,0);}}
 g.stroke();g.restore();
}
function refreshProgressionUI(){
 const t=selectedTower(),options=t&&t.level>=2&&!t.branch?Object.entries(BRANCHES[t.type]):[];
 $('branchOptions').hidden=!options.length;
 if(options.length){
  $('branchNote').textContent=t.level===3?'Для прежней башни выбор бесплатный. Специализацию можно выбрать один раз.':'Выбери специализацию для 3-го уровня. Обе ветки включают усиление уровня.';
  options.forEach(([id,def],i)=>{const el=$(i===0?'branchA':'branchB');el.dataset.branch=id;el.querySelector('strong').textContent=def.name;el.querySelector('small').textContent=specializationDescription(t,id);el.querySelector('b').textContent=t.level===3?'Бесплатно':upgradeCost(t)+' кр.';el.disabled=paused||state.phase==='lose'||state.money<(t.level===3?0:upgradeCost(t));});
  $('upgradeBtn').textContent='Выбери специализацию ниже';$('upgradeBtn').disabled=true;
 }
 if(t){const s=towerStats(t);$('selectionName').textContent=t.branch?BRANCHES[t.type][t.branch].name:TOWERS[t.type].name;$('selectionDesc').textContent=t.branch?specializationDescription(t):TOWERS[t.type].desc;
  $('specialStat').textContent=t.type==='frost'?'−'+Math.round((1-s.slow)*100)+'% · '+s.slowDuration.toFixed(1)+' с'+(s.splash?' · по площади':''):t.branch==='scorch'?'Ожог '+s.scorchDps+'/с · 3 с · земля':t.branch==='chain'?'3 цели · без брони':s.pierce?'Игнорирует броню':s.splash?'Радиус '+(s.splash/CELL).toFixed(1)+' кл.':TOWERS[t.type].special;}
 for(const [id,def]of Object.entries(ABILITIES)){
  const el=$('ability_'+id),cd=state.abilities[id],active=id==='shield'&&state.coreShield>0&&state.shieldUntil>state.time;
  el.querySelector('b').textContent=active?state.coreShield+' · '+Math.ceil(state.shieldUntil-state.time)+' с':cd>0?Math.ceil(cd)+' с':abilityAim===id?'Прицел':'Готово';
  el.disabled=!canUseAbility(id)||(id!=='shield'&&!state.enemies.some(e=>e.hp>0));el.classList.toggle('aiming',abilityAim===id);el.setAttribute('aria-pressed',String(abilityAim===id));
  el.title=def.name+' ('+def.key+'). '+def.desc+' Перезарядка: '+Math.round(abilityCooldown(id))+' с.';el.querySelector('.ability-meter').style.width=(100*clamp(1-cd/abilityCooldown(id),0,1)).toFixed(1)+'%';
 }
 $('shieldStatus').hidden=!(sessionStarted&&state.coreShield>0&&state.shieldUntil>state.time);$('shieldStatus').textContent='Щит '+state.coreShield+' · '+Math.max(0,Math.ceil(state.shieldUntil-state.time))+' с';
 if(abilityAim){$('buildModeBadge').hidden=false;$('buildModeText').textContent='Орбитальный удар · укажи точку · Esc — отмена';}
 refreshBattleHUD();
 if(progressSaveNeeded){progressSaveNeeded=false;saveProgress();}
}
function refreshBattleHUD(){
 for(const [id,def]of Object.entries(PERKS))if(!def.instant){
  const el=$('perk_'+id),rank=perkRank(id);el.dataset.rank=String(rank);el.classList.toggle('learned',rank>0);el.classList.toggle('mastered',rank===def.max);el.setAttribute('aria-label',def.name+': '+rank+' из '+def.max+'. '+def.desc);el.title=def.name+' · '+rank+'/'+def.max+'\n'+def.desc;
  el.querySelectorAll('i').forEach((cube,i)=>cube.classList.toggle('filled',i<rank));
 }
 const capacity=passiveShieldCapacity();$('passiveHud').hidden=capacity===0;$('passiveShieldValue').textContent=state.passiveShield+'/'+capacity;
 $('passiveHud').title='Щит ядра: '+state.passiveShield+' из '+capacity+(state.passiveShield<capacity?' · +1 через '+Math.max(0,Math.ceil(state.shieldRegenAt-state.time))+' с':' · полный заряд');
 const next=nextPreviewWave(),forecast=state.mode==='campaign'&&state.difficulty>0?nextAttackForecast():null,plan=forecast?(state.wave?forecast.items:forecast.items.filter(q=>q.group===forecast.items[0]?.group)):wavePlan(next),types=[...new Set(plan.map(e=>e.type))],bosses=plan.filter(e=>e.type==='boss').length;
 $('intelNext').textContent='ДАЛЕЕ '+String(next).padStart(2,'0');$('intelCount').textContent=plan.length+' врагов'+(plan.some(isAirUnit)?' · ✦ '+plan.filter(isAirUnit).length+' в воздухе':'')+(bosses?' · босс ×'+bosses:'');$('intelBtn').classList.toggle('boss-warning',bosses>0);
 $('intelTypes').innerHTML=types.map(type=>'<span title="'+ENEMIES[type].name+(state.mode==='campaign'?' · '+campaignRewardText(type)+' монет, элита ×2':'')+'" style="color:'+ENEMIES[type].color+'">'+unitIcon(type)+'<small>'+plan.filter(e=>e.type===type).length+'</small></span>').join('');
 $('intelBtn').title='Разведка волны '+next+': '+types.map(type=>ENEMIES[type].name+' ×'+plan.filter(e=>e.type===type).length).join(', ')+'. Нажми для подробностей.';
}
function closePerkTooltip(){$('perkTooltip').hidden=true;delete $('perkTooltip').dataset.perk;}
function showPerkTooltip(id){
 const el=$('perkTooltip');if(!el.hidden&&el.dataset.perk===id){closePerkTooltip();return;}
 el.dataset.perk=id;$('perkTooltipName').textContent=PERKS[id].name;$('perkTooltipDesc').textContent=PERKS[id].desc;$('perkTooltipRank').textContent='Ранг '+perkRank(id)+' из '+PERKS[id].max;el.hidden=false;
 const a=$('perk_'+id).getBoundingClientRect(),r=el.getBoundingClientRect();el.style.left=Math.round(clamp(a.left+a.width/2-r.width/2,8,Math.max(8,VIEW.w-r.width-8)))+'px';el.style.top=Math.round(clamp(a.bottom+8,8,Math.max(8,VIEW.h-r.height-8)))+'px';
}

// Command technologies and the fifty-wave campaign.
const TECH_TOTAL_COST=72,FIELD_REPAIR_COST=150;
function techSpentPoints(research=state.research){
 return Object.entries(PERKS).reduce((sum,[id,def])=>{const rank=research[id]||0;return sum+(def.instant?0:rank*(rank+1)/2);},0);
}
function buyTechRank(id,expectedRank){
 const def=PERKS[id],current=appData.profile.research[id]||0,next=current+1;
 if(appScreen!=='campaign'||sessionStarted||!def||def.instant||next>def.max||expectedRank!==next||profilePoints()<next)return false;
 appData.profile.research[id]=next;state.research={...appData.profile.research};state.techPoints=profilePoints();state.techEarned=profileEarned();
 persistApp();uiDirty=true;refreshTechTree();renderSectorDetails();refreshCommandStats();beep(820,.1,.035,'triangle');return true;
}
function awardBossPoints(enemy){
 // Campaign points are awarded once per sector difficulty at victory, never per kill.
}
function onBossWaveComplete(wave){
 if(wave.id%5===0&&wave.bossKills>0){state.repairReady=true;uiDirty=true;}
}
function buyFieldRepair(){
 if(!sessionStarted||state.phase==='lose'||state.phase==='win'||!state.repairReady||state.lives>=(state.maxLives||20)||state.money<FIELD_REPAIR_COST)return false;
 const healed=Math.min(5,(state.maxLives||20)-state.lives);state.money-=FIELD_REPAIR_COST;state.lives+=healed;state.repairReady=false;
 saveProgress();uiDirty=true;notify('Полевой ремонт · прочность +'+healed);return true;
}
function campaignAtFinal(){return state.mode==='campaign'&&state.wave>=state.goalWaves;}

function nextPreviewWave(){return state.mode==='campaign'?Math.min(state.goalWaves,state.wave+1):state.wave+1;}
function onEnemyLeak(){state.enemiesLeaked++;uiDirty=true;}
function checkCampaignVictory(){
 if(state.mode!=='campaign'||state.campaignWon||state.phase==='lose'||state.lives<=0||state.wave!==state.goalWaves||state.completed!==state.goalWaves||state.waves.length||state.queue.length||state.enemies.some(e=>e.hp>0)||!state.finalBossKilled)return false;
 stopTowerRepair(false);state.bossShots=[];state.campaignWon=true;state.phase='win';paused=true;abilityAim=null;state.shots=[];state.orbitalStrikes=[];state.enemies=[];
 beginBattleResult();
 state.campaignLives=state.lives;state.campaignTime=state.time;state.campaignStars=state.enemiesLeaked===0?3:state.lives>=Math.ceil((state.maxLives||20)/2)?2:1;
 const mask=1<<state.difficulty,old=appData.profile.cleared[state.sectorId]||0;
 state.pointAwarded=!(old&mask);appData.profile.cleared[state.sectorId]=old|mask;
 normaliseStars(appData.profile).stars[state.sectorId][state.difficulty]=Math.max(sectorStars(state.sectorId,state.difficulty),state.campaignStars);
 state.score+=1000+state.lives*100;updateBest();saveProgress();uiDirty=true;
 announce('Сектор защищён! '+(state.pointAwarded?'+1 очко технологий.':'Повторное прохождение.'));beep(880,.35,.06,'triangle');return true;
}

function campaignStarsArt(count){
 return Array.from({length:3},(_,i)=>'<svg class="'+(i<count?'star-filled':'star-empty')+'" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>').join('');
}


function initProgression(){
 initTechTree();
 for(const id of Object.keys(ABILITIES)){
  $('ability_'+id).querySelector('.ability-icon').innerHTML=techIcon(id);
  $('ability_'+id).addEventListener('click',()=>{if(abilityAim===id){closeContextPanel();return;}startAbility(id);});
 }
 for(const id of ['branchA','branchB'])$(id).addEventListener('click',()=>chooseBranch($(id).dataset.branch));
 $('researchBtn').addEventListener('click',()=>openTechTree());$('techTreeBtn').addEventListener('click',()=>openTechTree());
 $('closeResearch').addEventListener('click',()=>closeDialog('researchDialog'));
 $('closeResearchBottom').addEventListener('click',()=>closeDialog('researchDialog'));
 $('researchDialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog('researchDialog');});
 for(const[id,def]of Object.entries(PERKS))if(!def.instant){$('perk_'+id).querySelector('.perk-icon').innerHTML=techIcon(id);$('perk_'+id).addEventListener('click',()=>appScreen==='battle'&&state.mode==='campaign'?showPerkTooltip(id):openTechTree(id));}
 $('closePerkTooltip').addEventListener('click',closePerkTooltip);
 $('overlaySecondary').addEventListener('click',()=>state.phase==='win'?retryBattle():finishBattleToMap());
 document.addEventListener('keydown',e=>{
  if(!sessionStarted||anyDialogOpen()||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,textarea,select'))return;
  const id={q:'emp',e:'orbital',r:'shield'}[e.key.toLowerCase()];if(id){e.preventDefault();startAbility(id);}
  if(e.key.toLowerCase()==='t'){e.preventDefault();openTechTree();}
 });
 checkCampaignVictory();refreshUI();
}

// The research screen only: gameplay, points and save migration live in progression.
// Every rank has a visible cumulative effect; clicks are reserved for purchases.
const TECH_UI_GROUPS = [
 {id:'weapons',name:'Вооружение',index:'01',desc:'Урон, темп огня и площадь поражения',ids:['reactor','loader','blast']},
 {id:'control',name:'Контроль поля',index:'02',desc:'Дальность обнаружения и удержание врага',ids:['optics','cryo']},
 {id:'support',name:'Поддержка',index:'03',desc:'Активные способности и защита ядра',ids:['tactics','coreShield']}
];
const TECH_UI_COPY = {
 reactor:{scope:'Все орудия',effect:r=>'Урон +'+r*12+'%',gain:()=>'+12% урона'},
 loader:{scope:'Все орудия',effect:r=>'Скорострельность +'+r*10+'%',gain:()=>'+10% скорострельности'},
 blast:{scope:'Мортира, Метель и орбитальный удар',effect:r=>'Радиус атак +'+r*15+'%',gain:()=>'+15% радиуса'},
 optics:{scope:'Все орудия',effect:r=>'Дальность +'+r*8+'%',gain:()=>'+8% дальности'},
 cryo:{scope:'Замедление Крио и оглушение ЭМИ',effect:r=>'Длительность +'+r*25+'%',gain:()=>'+25% длительности'},
 tactics:{scope:'ЭМИ · Орбитальный удар · Аварийный щит',effect:r=>'Перезарядка −'+String(Math.round((1-Math.pow(.9,r))*1000)/10).replace('.',',')+'%',gain:()=> '−10% от текущей перезарядки'},
 coreShield:{scope:'Через 10 с без ударов: +1 защиты каждые 6 с',effect:r=>'Ёмкость щита: '+r*2,gain:()=>'+2 ёмкости и +2 заряда'}
};
let techTreeUI = null;

function initTechTree(){
 const root=document.getElementById('techTree');
 if(!root)return false;
 if(techTreeUI?.root===root&&root.childElementCount)return true;
 const ui={root,signature:null,branches:new Map(),groups:new Map()};
 const fragment=document.createDocumentFragment();
 for(const group of TECH_UI_GROUPS){
  const section=document.createElement('section');
  section.className='tech-group tech-group--'+group.id;
  section.setAttribute('aria-labelledby','tech-group-title-'+group.id);
  const header=document.createElement('header');header.className='tech-group-header';
  const kicker=document.createElement('div');kicker.className='tech-group-kicker';
  const index=document.createElement('span');index.textContent='СИСТЕМА '+group.index;
  const counter=document.createElement('b');counter.className='tech-group-count';
  kicker.append(index,counter);
  const title=document.createElement('h3');title.id='tech-group-title-'+group.id;title.textContent=group.name;
  const description=document.createElement('p');description.textContent=group.desc;
  header.append(kicker,title,description);
  const columns=document.createElement('div');columns.className='tech-group-columns';
  columns.style.setProperty('--tech-column-count',String(group.ids.length));
  ui.groups.set(group.id,{counter,ids:group.ids});
  for(const id of group.ids){
   const def=PERKS[id],copy=TECH_UI_COPY[id];
   const card=document.createElement('article');card.className='tech-branch';card.id='tech-branch-'+id;
   card.setAttribute('aria-labelledby','tech-branch-title-'+id);
   const top=document.createElement('header');top.className='tech-branch-header';
   const icon=document.createElement('span');icon.className='tech-branch-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=techIcon(id);
   const rank=document.createElement('span');rank.className='tech-branch-rank';
   const name=document.createElement('h4');name.id='tech-branch-title-'+id;name.textContent=def.name;
   const scope=document.createElement('p');scope.textContent=copy.scope;
   top.append(icon,rank,name,scope);
   const list=document.createElement('ol');list.className='tech-ranks';list.setAttribute('aria-label',def.name+': ранги сверху вниз');
   const nodes=[];
   for(let r=1;r<=def.max;r++){
    const li=document.createElement('li');li.className='tech-rank-item';
    const button=document.createElement('button');button.type='button';button.className='tech-rank-node';
    button.dataset.tech=id;button.dataset.rank=String(r);
    const cap=document.createElement('span');cap.className='tech-node-topline';
    const number=document.createElement('span');number.className='tech-node-number';number.textContent='РАНГ '+r;
    const price=document.createElement('span');price.className='tech-node-price';price.textContent=r+' очк.';
    cap.append(number,price);
    const effect=document.createElement('strong');effect.className='tech-node-effect';effect.textContent=copy.effect(r);
    const gain=document.createElement('span');gain.className='tech-node-gain';gain.textContent='Этот ранг: '+copy.gain(r);
    const status=document.createElement('span');status.className='tech-node-status';
    button.append(cap,effect,gain,status);
    button.addEventListener('click',()=>{buyTechRank(id,r);refreshTechTree();});
    li.append(button);list.append(li);nodes.push({li,button,status,price,rank:r});
   }
   card.append(top,list);columns.append(card);ui.branches.set(id,{card,rank,nodes});
  }
  section.append(header,columns);fragment.append(section);
 }
 root.replaceChildren(fragment);techTreeUI=ui;refreshTechTree();return true;
}

function refreshTechTree(){
 if(!techTreeUI&&!initTechTree())return;
 const ui=techTreeUI,points=profilePoints();
 const spent=techSpentPoints(),total=TECH_TOTAL_COST;
 const ids=TECH_UI_GROUPS.flatMap(g=>g.ids);
 const signature=[points,spent,state.phase,appScreen,...ids.map(perkRank)].join('|');
 if(ui.signature===signature)return;
 ui.signature=signature;
 const balance=document.getElementById('techPointsValue');if(balance)balance.textContent=String(points);
 const progress=document.getElementById('techProgressValue');if(progress)progress.textContent=spent+' / '+total;
 const bar=document.getElementById('techProgressBar');
 if(bar){bar.style.width=(Math.min(1,spent/total)*100)+'%';bar.setAttribute('aria-valuenow',String(spent));bar.setAttribute('aria-valuemax',String(total));}
 const empty=document.getElementById('techTreeEmpty');
 if(empty){empty.hidden=points>0||spent===total;empty.textContent='За первое прохождение каждой сложности сектора: +1 очко. Технологии покупаются только на карте кампании.';}
 for(const group of TECH_UI_GROUPS){
  const refs=ui.groups.get(group.id),ranks=group.ids.reduce((n,id)=>n+perkRank(id),0),max=group.ids.reduce((n,id)=>n+PERKS[id].max,0);
  refs.counter.textContent=ranks+' / '+max;refs.counter.setAttribute('aria-label','Изучено рангов: '+ranks+' из '+max);
 }
 for(const id of ids){
  const refs=ui.branches.get(id),current=perkRank(id),def=PERKS[id];
  refs.rank.textContent=current+' / '+def.max;refs.card.classList.toggle('tech-branch--complete',current===def.max);
  for(const node of refs.nodes){
   const bought=node.rank<=current,next=node.rank===current+1,affordable=points>=node.rank;
   const ended=appScreen!=='campaign'||sessionStarted;
   node.li.classList.toggle('is-learned',bought);node.li.classList.toggle('is-next',!bought&&next);node.li.classList.toggle('is-affordable',!bought&&next&&affordable&&!ended);
   node.button.disabled=bought||!next||!affordable||ended;
   node.price.textContent=bought?'Изучено':node.rank+' очк.';
   node.status.textContent=bought?'Технология установлена':!next?'Сначала ранг '+(node.rank-1):ended?'Изучается между боями':affordable?'Изучить за '+node.rank+' очк.':'Не хватает '+(node.rank-points)+' очк.';
   node.button.setAttribute('aria-label',def.name+', ранг '+node.rank+'. '+TECH_UI_COPY[id].effect(node.rank)+'. Этот ранг: '+TECH_UI_COPY[id].gain(node.rank)+'. '+node.status.textContent);
  }
 }
}

function openTechTree(id=null){
 if(appScreen==='battle'&&state.mode==='campaign')return;if(!initTechTree())return;
 refreshTechTree();showDialog('researchDialog');
 if(typeof id==='string'&&techTreeUI.branches.has(id)){
  const card=techTreeUI.branches.get(id).card;
  requestAnimationFrame(()=>{card.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});});
 }
}

function refreshUI(){
 uiDirty=false;$('moneyValue').textContent=state.money;$('livesValue').innerHTML=state.lives+' <small>/ '+(state.maxLives||20)+'</small>';$('livesValue').classList.toggle('low-health',state.lives<=Math.max(1,Math.floor((state.maxLives||20)/4)));$('waveValue').innerHTML=String(state.wave).padStart(2,'0')+' <small>отбито '+state.completed+'</small>';$('bestScore').textContent=best.toLocaleString('ru-RU');
 $('mapStatus').textContent=paused?'ПАУЗА':state.phase==='lose'?'СИГНАЛ ПОТЕРЯН':state.waves.length?'В БОЮ ВОЛН: '+state.waves.length:'ПОДГОТОВКА';
 $('enemyCount').textContent='ПРОТИВНИКОВ: '+state.enemies.filter(e=>e.hp>0).length+(state.queue.length?' / ЕЩЁ '+state.queue.length:'');
 const atLimit=state.waves.length>=MAX_ACTIVE_WAVES,bonus=earlyBonus(),next=nextPreviewWave(),firstWave=state.wave===0;
 $('startWave').disabled=paused||state.phase==='lose'||state.launchCooldown>0||atLimit;
 $('startLabel').textContent=state.phase==='lose'?'Оборона завершена':atLimit?'В бою 2 волны':firstWave?'Начать первую волну':'Вызвать '+String(next).padStart(2,'0')+(bonus?' · +'+bonus:'');
 $('startWave').title=firstWave?'Первая волна запускается вручную, без таймера и бонуса. Подготовь оборону и нажми, когда будешь готов.':'Ранний вызов волны '+next+'. Бонус: '+bonus+' монет. Активных волн: '+state.waves.length+' / '+MAX_ACTIVE_WAVES;
 $('nextWaveNumber').textContent=String(next).padStart(2,'0');$('nextWaveTimer').textContent=state.phase==='lose'?'—':firstWave?'БЕЗ ТАЙМЕРА':atLimit&&state.nextWaveIn===0?'ОЖИДАНИЕ':timeLabel(state.nextWaveIn);
 $('nextWaveTimer').parentElement.classList.toggle('urgent',!firstWave&&state.nextWaveIn<=8);
 const full=waveInterval(state.wave+1);$('waveClockBar').style.width=firstWave||full===0?'0%':(100*clamp(state.nextWaveIn/full,0,1)).toFixed(2)+'%';
 $('pauseBtn').innerHTML=paused?PLAY_ICON:PAUSE_ICON;$('pauseBtn').setAttribute('aria-pressed',String(paused));$('pauseBtn').setAttribute('aria-label',paused?'Продолжить':'Пауза');$('pauseBtn').disabled=state.phase==='lose';$('speedBtn').textContent=speed+'×';
 document.querySelectorAll('.tower-card').forEach(el=>{const active=el.dataset.type===selectedType;el.classList.toggle('selected',active);el.classList.toggle('unaffordable',TOWERS[el.dataset.type].cost>state.money);el.setAttribute('aria-pressed',String(active));});
 const t=selectedTower(),type=t?t.type:(selectedType||'pulse'),s=towerStats(t||{type,level:1});
 $('selectionName').textContent=s.name;$('selectionLevel').textContent=t?'УРОВЕНЬ '+t.level+' / 3':'ЧЕРТЁЖ';$('selectionDesc').textContent=s.desc;$('damageStat').textContent=s.damage;$('rateStat').textContent=(1/s.rate).toFixed(1);$('rangeStat').textContent=(s.range/CELL).toFixed(1)+' клетки';$('specialStat').textContent=type==='frost'?'Замедление '+Math.round((1-s.slow)*100)+'%':s.special;
 drawPortrait(type,t?t.level:1);
 $('selectionActions').hidden=!t;
 if(t){$('upgradeBtn').textContent=t.level===3?'Максимальный уровень':'Улучшить · '+upgradeCost(t);$('upgradeBtn').disabled=t.level===3||state.money<upgradeCost(t)||paused||state.phase==='lose';$('sellBtn').textContent='Продать · +'+sellValue(t);$('sellBtn').disabled=paused||state.phase==='lose';}
 let hint='Подготовь оборону. Первая волна — по кнопке или Space, без таймера и бонуса.',key='↵';
 if(state.wave>0)hint='Вызови волну '+next+' раньше: +'+bonus+' монет. Новая атака начнётся поверх текущей.';
 if(t){hint=s.name+' · цель ближе всех к ядру в радиусе. U — улучшить, X — продать.';key='U';}
 if(atLimit)hint='В бою две волны. Следующий вызов станет доступен, когда одна из них будет отбита.';
 if(paused)hint='Игра и таймер на паузе. Нажми P или «Продолжить».';
 if(state.phase==='lose')hint='Контур пал. Попробуй усилить общий участок и не вызывать слишком много волн сразу.';
 $('hint').textContent=hint;$('hintKey').textContent=key;
 const plan=wavePlan(next),types=[...new Set(plan.map(e=>e.type))],bosses=plan.filter(e=>e.type==='boss').length;
 $('previewLabel').textContent='СЛЕДУЮЩАЯ ВОЛНА / '+String(next).padStart(2,'0')+' · ТРИ НАПРАВЛЕНИЯ';
 $('previewText').textContent=plan.length+' врагов'+(bosses?' · боссов: '+bosses:'')+' · за отражение +'+waveBonus(next);
 $('wavePreview').replaceChildren();for(const type of types){const el=document.createElement('span');el.className='enemy-chip';el.style.color=ENEMIES[type].color;el.title=ENEMIES[type].name+(isAirUnit(type)?' · Воздух: Импульс, Крио, Рельса':' · Наземная цель');el.setAttribute('aria-label',ENEMIES[type].name);el.innerHTML=unitIcon(type)+'<strong>'+ENEMIES[type].name+(isAirUnit(type)?' · ВОЗДУХ':'')+'</strong><small>×'+plan.filter(e=>e.type===type).length+(state.mode==='campaign'?' · '+campaignRewardText(type)+' мон./шт.':'')+'</small>';$('wavePreview').append(el);}
 $('tipTitle').textContent=bosses?'ВНИМАНИЕ: ТЯЖЁЛЫЙ КОНТАКТ':'МОНЕТЫ ЗА РИСК';$('tipText').textContent=bosses?'Босс идёт по одному из трёх маршрутов. Усиль Рельсой общий участок у ядра; Крио даст больше времени на огонь.':'Бонус снижается по времени до автозапуска и не восстанавливается после зачистки. Таймер начинается после выхода последнего юнита предыдущей волны. Одновременно — до двух волн.';
 $('saveStatus').textContent=storageAvailable?'· автосохранение':'· сохранение недоступно';
 const ended=state.phase==='lose';$('boardOverlay').dataset.ended=String(ended);$('pauseShortcut').hidden=ended;$('boardOverlay').hidden=!sessionStarted||anyDialogOpen()||(!paused&&!ended);
 if(ended){$('overlaySymbol').innerHTML=LOSE_ICON;$('overlayTitle').textContent='Ядро потеряно.';$('overlayText').textContent='Отбито волн: '+state.completed+' · Уничтожено: '+state.kills+' · Очки: '+state.score.toLocaleString('ru-RU');$('overlayAction').textContent='Новая оборона';}
 else if(paused){$('overlaySymbol').innerHTML=PAUSE_ICON;$('overlayTitle').textContent='Пауза';$('overlayText').textContent='Таймер и бой остановлены. Продолжай, когда будешь готов.';$('overlayAction').textContent='Продолжить';}
 refreshShellUI();refreshProgressionUI();refreshCampaignUI();paintAttackForecast();
}
function setPause(value){if(state.phase==='lose'||state.phase==='win')return;if(!value&&state.rewardQueue.length){uiDirty=true;return;}paused=value;if(value)saveProgress();uiDirty=true;}

document.querySelectorAll('.tower-card').forEach(el=>el.addEventListener('click',()=>buyFromContext(el.dataset.type)));
initCameraInput();
canvas.addEventListener('click',handleBoardTap);
canvas.addEventListener('contextmenu',e=>{e.preventDefault();closeContextPanel();});
canvas.addEventListener('keydown',e=>{if(!sessionStarted||paused||anyDialogOpen())return;const delta=screenArrowDelta(e.key);if(delta){e.preventDefault();keyboardCell={c:clamp(keyboardCell.c+delta[0],0,COLS-1),r:clamp(keyboardCell.r+delta[1],0,ROWS-1)};hover={...keyboardCell};revealCell(keyboardCell.c,keyboardCell.r);if(abilityAim)abilityPointer={x:(keyboardCell.c+.5)*CELL,y:(keyboardCell.r+.5)*CELL};}if(e.key==='Enter'){e.preventDefault();if(abilityAim)castAbility('orbital',{x:(keyboardCell.c+.5)*CELL,y:(keyboardCell.r+.5)*CELL});else interactCell(keyboardCell.c,keyboardCell.r);}});
document.addEventListener('keydown',e=>{
 if(!sessionStarted||anyDialogOpen()||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
 if(e.target.matches('input,textarea,select'))return;
 const key=e.key.toLowerCase();if('1234'.includes(key)&&key.length===1){closeContextPanel(false);chooseType(['pulse','cannon','frost','rail'][Number(key)-1]);}
 if(e.code==='Space'&&e.target!==$('startWave')&&!e.target.matches('button')){e.preventDefault();startWave(true);}
 if(key==='p'){e.preventDefault();setPause(!paused);}if(key==='m')toggleSound();if(key==='u')upgradeSelected();if(key==='x')sellSelected();if(e.key==='Escape'){if(UI.context||selectedType||selectedId||abilityAim)closeContextPanel();else openMenu();uiDirty=true;}
});
$('startWave').addEventListener('click',()=>startWave(true));$('pauseBtn').addEventListener('click',()=>setPause(!paused));$('speedBtn').addEventListener('click',()=>{speed=speed===1?2:speed===2?3:1;uiDirty=true;});$('upgradeBtn').addEventListener('click',upgradeSelected);$('sellBtn').addEventListener('click',sellSelected);$('soundBtn').addEventListener('click',toggleSound);$('fxBtn').addEventListener('click',()=>{fullEffects=!fullEffects;$('fxBtn').setAttribute('aria-pressed',String(fullEffects));$('fxBtn').setAttribute('aria-label',fullEffects?'Полные эффекты':'Лёгкие эффекты');if(!fullEffects){FX.smoke=[];FX.shake=0;}notify(fullEffects?'Полные визуальные эффекты':'Лёгкий режим эффектов');});
$('overlayAction').addEventListener('click',()=>{if(state.phase==='lose')retryBattle();else if(state.phase==='win')finishBattleToMap();else setPause(false);});$('helpBtn').addEventListener('click',()=>showDialog('helpDialog'));$('closeHelp').addEventListener('click',()=>closeDialog('helpDialog'));$('menuLeaveBtn').addEventListener('click',()=>requestBattleAction('leave'));$('menuRestartBtn').addEventListener('click',()=>requestBattleAction('restart'));$('cancelReset').addEventListener('click',()=>closeDialog('resetDialog'));$('confirmReset').addEventListener('click',confirmBattleAction);
for(const id of ['helpDialog','resetDialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();closeDialog(id);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){setPause(true);saveProgress();}});
window.addEventListener('resize',fitCanvas);
window.addEventListener('pagehide',saveProgress);
function frame(timestamp){
 if(!lastFrame)lastFrame=timestamp;const elapsed=Math.min((timestamp-lastFrame)/1000,.1);lastFrame=timestamp;now=timestamp/1000;
 // Ограниченный шаг сохраняет точность снарядов при ускорении и просадке FPS.
 const total=elapsed*speed,steps=Math.max(1,Math.ceil(total/(1/60))),dt=total/steps;
 for(let i=0;i<steps;i++)update(dt);tickBattleResult(elapsed);if(sessionStarted&&state.time-lastSave>=3)saveProgress();render();
 if(uiDirty||timestamp-lastUI>200){refreshUI();lastUI=timestamp;}
 requestAnimationFrame(frame);
}
// Ability graphics use the combat clock: pause freezes them and speed scales them.
// Transient effects stay outside saves; only the bounded ground craters persist.
const EMP_FX_DURATION=1.65, MAX_ORBITAL_CRATERS=16;
const EMP_REFRACTION=document.createElement('canvas');
function fxNoise(seed){const n=Math.sin(seed*127.1+311.7)*43758.5453;return n-Math.floor(n);}
function empVisual(){
 const radius=Math.max(...[[0,0],[WIDTH,0],[0,HEIGHT],[WIDTH,HEIGHT]].map(([x,y])=>Math.hypot(x-CORE.x,y-CORE.y)))+60;
 FX.empWaves.push({x:CORE.x,y:CORE.y,radius,age:0,duration:EMP_FX_DURATION,seed:state.nextId+state.time});
 if(FX.empWaves.length>3)FX.empWaves.shift();
 burst(CORE.x,CORE.y,'#c0faff',36);
}
function orbitalImpactVisual(p){
 const seed=state.nextId+state.time*7;
 const crater={x:p.x,y:p.y,radius:Math.min(76,p.radius*.4),seed,createdAt:state.time};
 (state.orbitalCraters??=[]).push(crater);
 if(state.orbitalCraters.length>MAX_ORBITAL_CRATERS)state.orbitalCraters.shift();
 FX.orbitalImpacts.push({x:p.x,y:p.y,radius:p.radius,seed,age:0,duration:3.6});
 if(FX.orbitalImpacts.length>6)FX.orbitalImpacts.shift();
 if(fullEffects&&!REDUCED_MOTION)FX.shake=Math.max(FX.shake,6);
 burst(p.x,p.y,'#ffeab0',fullEffects?65:20);
 progressSaveNeeded=true;
}
function updateAbilityVisuals(dt){
 for(const p of FX.empWaves)p.age+=dt;
 FX.empWaves=FX.empWaves.filter(p=>p.age<p.duration);
 for(const p of FX.orbitalImpacts)p.age+=dt;
 FX.orbitalImpacts=FX.orbitalImpacts.filter(p=>p.age<p.duration);
}
function craterContour(d,scale=1){
 ctx.beginPath();
 for(let i=0;i<=40;i++){
  const index=i%40,a=index*Math.PI/20,r=d.radius*scale*(.96+.045*Math.sin(a*3+d.seed)+.035*Math.sin(a*7-d.seed)+.02*Math.sin(a*13+d.seed*.5));
  const x=d.x+Math.cos(a)*r,y=d.y+Math.sin(a)*r*.78;
  if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
 }
 ctx.closePath();
}
function drawOrbitalCraters(){
 for(const d of state.orbitalCraters||[]){
  ctx.save();
  ctx.save();ctx.translate(d.x,d.y);ctx.scale(1,.78);
  const soot=ctx.createRadialGradient(0,0,d.radius*.5,0,0,d.radius*1.65);
  soot.addColorStop(0,'#18120fb0');soot.addColorStop(.6,'#211d1880');soot.addColorStop(1,'#18120f00');
  ctx.fillStyle=soot;ctx.beginPath();ctx.arc(0,0,d.radius*1.65,0,Math.PI*2);ctx.fill();ctx.restore();
  craterContour(d,1.07);ctx.fillStyle='#302b24';ctx.fill();
  ctx.strokeStyle='#b6a17f55';ctx.lineWidth=2;ctx.stroke();
  const bowl=ctx.createRadialGradient(d.x-d.radius*.2,d.y-d.radius*.3,1,d.x,d.y,d.radius);
  bowl.addColorStop(0,'#080d10');bowl.addColorStop(.55,'#171b1d');bowl.addColorStop(.83,'#49453b');bowl.addColorStop(1,'#716653');
  craterContour(d);ctx.fillStyle=bowl;ctx.fill();ctx.strokeStyle='#151a19dd';ctx.lineWidth=2;ctx.stroke();
  for(let i=0;i<18;i++){
   const a=i*2.39996+fxNoise(d.seed),r=d.radius*(.68+.21*fxNoise(d.seed+i+40));
   const x=d.x+Math.cos(a)*r,y=d.y+Math.sin(a)*r*.78;
   ctx.strokeStyle=i%2?'#c5a47b50':'#070f12aa';ctx.lineWidth=1+fxNoise(i+d.seed)*2;
   ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(d.x+Math.cos(a+.06)*r*1.35,d.y+Math.sin(a+.06)*r*1.05);ctx.stroke();
   ctx.fillStyle=i%3?'#363c36':'#8b7d62';ctx.fillRect(x,y,2+fxNoise(i+6)*4,2+fxNoise(i+9)*3);
  }
  const heat=clamp(1-(state.time-d.createdAt)/14,0,1);
  if(heat>0){
   ctx.globalCompositeOperation='lighter';ctx.globalAlpha=heat*.8;
   for(let i=0;i<10;i++){
    const a=i*2.4+d.seed,r=d.radius*(.3+.5*fxNoise(i+d.seed));
    ctx.strokeStyle=i%2?'#ff823c':'#ffc46d';ctx.lineWidth=1.3;ctx.beginPath();
    ctx.moveTo(d.x+Math.cos(a)*r*.5,d.y+Math.sin(a)*r*.4);
    ctx.lineTo(d.x+Math.cos(a+.1)*r,d.y+Math.sin(a+.1)*r*.78);ctx.stroke();
   }
  }
  ctx.restore();
 }
}
function distortionBand(p,radius,width,strength,inverse){
 if(radius<=width)return;
 ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,radius+width,0,Math.PI*2);
 ctx.arc(p.x,p.y,Math.max(1,radius-width),0,Math.PI*2,true);ctx.clip('evenodd');
 ctx.translate(p.x,p.y);ctx.scale(strength,strength);ctx.translate(-p.x,-p.y);
 ctx.transform(inverse.a,inverse.b,inverse.c,inverse.d,inverse.e,inverse.f);
 ctx.globalAlpha=.85;ctx.drawImage(EMP_REFRACTION,0,0);ctx.restore();
}
function drawEMPWaves(){
 if(!FX.empWaves.length)return;
 // Snapshot once per frame. Annular clips refract the already rendered terrain,
 // towers and units. The inverse matrix also handles panning and portrait rotation.
 const refract=fullEffects&&!REDUCED_MOTION;
 let inverse=null;
 if(refract){
  if(EMP_REFRACTION.width!==canvas.width||EMP_REFRACTION.height!==canvas.height){EMP_REFRACTION.width=canvas.width;EMP_REFRACTION.height=canvas.height;}
  const g=EMP_REFRACTION.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);g.drawImage(canvas,0,0);
  inverse=ctx.getTransform().inverse();
 }
 for(const p of FX.empWaves){
  const t=clamp(p.age/p.duration,0,1),radius=12+p.radius*Math.pow(t,.88),fade=Math.min(1,(1-t)*5),width=22;
  if(refract){distortionBand(p,radius,width,1+.019*fade,inverse);distortionBand(p,radius-30,8,1-.012*fade,inverse);}
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=fade;
  const glow=ctx.createRadialGradient(p.x,p.y,Math.max(0,radius-width*2),p.x,p.y,radius+width);
  glow.addColorStop(0,'#1ba8e900');glow.addColorStop(.45,'#24b8ed08');glow.addColorStop(.74,'#4be1ff55');glow.addColorStop(.84,'#b5fcffb0');glow.addColorStop(1,'#36c8ff00');
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,radius+width,0,Math.PI*2);ctx.fill();
  const segments=fullEffects?180:80;
  ctx.globalCompositeOperation='source-over';
  for(const [offset,lineWidth,color] of [[-8,7,'#28baff80'],[0,2.3,'#a9fbff'],[7,1,'#e8ffff']]){
   ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.beginPath();
   for(let i=0;i<=segments;i++){
    const a=i*Math.PI*2/segments,jitter=Math.sin(a*37+p.age*18)*2.5+Math.sin(a*71-p.age*13)*1.7;
    const r=Math.max(1,radius+offset+jitter),x=p.x+Math.cos(a)*r,y=p.y+Math.sin(a)*r;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }
   ctx.closePath();ctx.stroke();
  }
  for(let i=0;i<(fullEffects?64:22);i++){
   const a=i*2.39996+fxNoise(p.seed)*6,spread=fxNoise(i+p.seed),r=radius+(spread-.5)*32;
   const x=p.x+Math.cos(a)*r,y=p.y+Math.sin(a)*r;
   if(x<-30||x>WIDTH+30||y<-30||y>HEIGHT+30)continue;
   ctx.strokeStyle=i%3?'#b9fcff':'#4ebcff';ctx.lineWidth=i%3?1:2;ctx.beginPath();
   ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a+.6)*8,y+Math.sin(a+.6)*8);
   ctx.lineTo(x+Math.cos(a-.5)*17,y+Math.sin(a-.5)*17);ctx.stroke();
   ctx.fillStyle='#e7ffff';ctx.fillRect(x-1,y-1,2,2);
  }
  ctx.restore();
 }
}
function orbitalFallVector(){return VIEW.rotated?{x:-680,y:100}:{x:-100,y:-680};}
function drawOrbitalDescent(){
 for(const p of state.orbitalStrikes){
  const f=clamp(1-p.remaining/.48,0,1);if(f<=0)continue;
  const v=orbitalFallVector(),x=p.x+v.x*(1-f),y=p.y+v.y*(1-f),trail=fullEffects?.38:.21;
  ctx.save();ctx.globalCompositeOperation='lighter';
  const glow=ctx.createRadialGradient(x,y,1,x,y,28);
  glow.addColorStop(0,'#ffffee');glow.addColorStop(.25,'#fff3b8');glow.addColorStop(.55,'#ffb04c99');glow.addColorStop(1,'#ff762000');
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,28,0,Math.PI*2);ctx.fill();
  const tail=ctx.createLinearGradient(x,y,x+v.x*trail,y+v.y*trail);
  tail.addColorStop(0,'#fff2cfff');tail.addColorStop(.2,'#ffb34ba0');tail.addColorStop(1,'#ff783000');
  ctx.strokeStyle=tail;ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+v.x*trail,y+v.y*trail);ctx.stroke();
  ctx.strokeStyle='#ffffea';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+v.x*.085,y+v.y*.085);ctx.stroke();ctx.restore();
 }
}
function drawOrbitalImpacts(){
 for(const p of FX.orbitalImpacts){
  const age=p.age,shock=clamp(age/1.05,0,1),shockRadius=p.radius*(.15+1.35*Math.sin(shock*Math.PI/2));
  ctx.save();
  if(shock<1){
   ctx.globalCompositeOperation='lighter';ctx.globalAlpha=(1-shock)*.9;
   const wave=ctx.createRadialGradient(p.x,p.y,Math.max(0,shockRadius-21),p.x,p.y,shockRadius+12);
   wave.addColorStop(0,'#ffc38b00');wave.addColorStop(.53,'#ffad5160');wave.addColorStop(.7,'#fff0c7dd');wave.addColorStop(1,'#e6984b00');
   ctx.fillStyle=wave;ctx.beginPath();ctx.arc(p.x,p.y,shockRadius+12,0,Math.PI*2);ctx.fill();
   ctx.strokeStyle='#ffdc9da0';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(p.x,p.y,shockRadius*.8,shockRadius*.8,0,0,Math.PI*2);ctx.stroke();
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  // Dust expands across the surface; smoke rises toward screen-up in both views.
  if(fullEffects){
   for(let i=0;i<9;i++){
    const a=i*2.39996+p.seed,spread=p.radius*(.1+Math.min(age,1.3)*(.22+.15*fxNoise(i+p.seed)));
    const lift=age*15,x=p.x+Math.cos(a)*spread-(VIEW.rotated?lift:0),y=p.y+Math.sin(a)*spread-(VIEW.rotated?0:lift);
    const size=12+age*16+fxNoise(i+p.seed)*14;
    const smoke=ctx.createRadialGradient(x,y,0,x,y,size);
    const alpha=Math.round(82*clamp(age/.25,0,1)*clamp(1-age/3.5,0,1)).toString(16).padStart(2,'0');
    smoke.addColorStop(0,'#3c3834'+alpha);smoke.addColorStop(.55,'#62584c'+alpha);smoke.addColorStop(1,'#6d605100');
    ctx.fillStyle=smoke;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();
   }
  }
  if(age<.75){
   ctx.globalCompositeOperation='lighter';ctx.globalAlpha=clamp(1-age/.75,0,1);
   const size=22+Math.sin(clamp(age/.65,0,1)*Math.PI)*p.radius*.52;
   const fire=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,size*1.6);
   fire.addColorStop(0,'#ffffec');fire.addColorStop(.23,'#fff4c5');fire.addColorStop(.48,'#ffbd50e0');fire.addColorStop(.75,'#ff5f2370');fire.addColorStop(1,'#ff5c1600');
   ctx.fillStyle=fire;ctx.beginPath();ctx.arc(p.x,p.y,size*1.6,0,Math.PI*2);ctx.fill();
   if(age<.22){
    const v=orbitalFallVector();ctx.globalAlpha=(1-age/.22)*.8;
    for(const[w,color]of[[36,'#ffb24b40'],[14,'#ffe9b9a0'],[4,'#ffffef']]){
     ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+v.x,p.y+v.y);ctx.stroke();
    }
   }
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  for(let i=0;i<(fullEffects?40:14);i++){
   const a=i*2.39996+fxNoise(p.seed)*6,velocity=75+fxNoise(i+p.seed)*140,vz=130+fxNoise(i+p.seed+91)*150,flight=2*vz/550;
   const t=Math.min(age,flight),z=Math.max(0,vz*t-275*t*t),x=p.x+Math.cos(a)*velocity*t,y=p.y+Math.sin(a)*velocity*t;
   if(fullEffects){ctx.fillStyle='#15141355';ctx.beginPath();ctx.ellipse(x,y,3,1.7,0,0,Math.PI*2);ctx.fill();}
   ctx.save();ctx.translate(x-(VIEW.rotated?z:0),y-(VIEW.rotated?0:z));ctx.rotate(a+Math.min(age,flight)*5);
   ctx.globalAlpha=clamp((p.duration-age)/.6,0,1);ctx.fillStyle=age<flight?(i%3?'#ffce77':'#fff2ba'):'#4f4538';
   const size=2+fxNoise(i+p.seed+3)*3;ctx.fillRect(-size/2,-size/2,size,size*.7);ctx.restore();
  }
  ctx.restore();
 }
}
function drawAbilityEffects(){drawOrbitalDescent();drawOrbitalImpacts();drawEMPWaves();}

// A launch opens one offer for the next wave. Its clock never depends on kills.
const MAX_SCORCH_FIELDS=192;
function pauseBeforeWave(wave){
 let index=Math.max(0,Math.floor(wave)-2);
 for(let peak=5;peak>=1;peak--){if(index<=peak)return peak-index;index-=peak+1;}
 return 0;
}
function makeWaveClock(wave,openedAt,lastPlannedSpawn,cap){
 const delay=pauseBeforeWave(wave+1);
 return {version:24,fromWave:wave,openedAt,releaseAt:null,dueAt:null,delay,
  bonusDeadline:Math.max(openedAt+.001,lastPlannedSpawn+delay),bonusCap:cap,bonusLast:cap};
}
function scheduledBonus(clock=state.waveClock,time=state.time){
 if(!clock)return 0;
 const span=Math.max(.001,clock.bonusDeadline-clock.openedAt);
 return Math.max(0,Math.min(clock.bonusLast,Math.floor(clock.bonusCap*clamp((clock.bonusDeadline-time)/span,0,1)+1e-8)));
}
function updateWaveClock(allowLaunch=true){
 const c=state.waveClock;
 if(!c||state.wave===0){state.nextWaveIn=0;return;}
 c.bonusLast=scheduledBonus(c);
 state.nextWaveIn=c.dueAt===null?c.delay:Math.max(0,c.dueAt-state.time);
 if(allowLaunch&&c.dueAt!==null&&state.time+1e-8>=c.dueAt&&state.waves.length<MAX_ACTIVE_WAVES&&!campaignAtFinal())startWave(false);
}
function markLastRelease(item){
 const c=state.waveClock;
 if(!c||c.fromWave!==item.wave||c.releaseAt!==null||state.queue.some(q=>q.wave===item.wave))return;
 // Freeze the already offered reward before correcting the planned deadline to
 // the actual emission time. Frame rounding can never raise the offer.
 c.bonusLast=scheduledBonus(c);
 c.releaseAt=state.time;c.dueAt=state.time+c.delay;c.bonusDeadline=c.dueAt;
 uiDirty=true;
}
function refreshWaveClockUI(){
 if(state.wave===0||campaignAtFinal()||['lose','win'].includes(state.phase))return;
 const c=state.waveClock;if(!c)return;
 const emitting=c.releaseAt===null,waiting=c.dueAt!==null&&state.time+1e-8>=c.dueAt;
 $('nextWaveTimer').textContent=emitting?'ВЫХОД ОТРЯДА':waiting?'ЖДЁТ МЕСТО':timeLabel(state.nextWaveIn);
 $('nextWaveTimer').parentElement.classList.toggle('urgent',!emitting&&!waiting&&state.nextWaveIn<=2);
 $('waveClockBar').style.width=emitting||waiting?'0%':(100*clamp(state.nextWaveIn/Math.max(.001,c.delay),0,1)).toFixed(2)+'%';
 $('startWave').title='Следующая волна '+nextPreviewWave()+'. Бонус сейчас: '+earlyBonus()+' монет. '+
  (emitting?'Автотаймер начнётся после выхода последнего юнита: '+c.delay+' с.':waiting?'Автозапуск ждёт свободное место среди двух активных волн.':'До автозапуска: '+Math.ceil(state.nextWaveIn)+' с.')+
  ' Ранний вызов доступен сразу, если в бою меньше двух волн.';
}
// Keep each slowdown strength on its own expiry. A weak hit cannot refresh a
// stronger effect; when that expires, the still-active weaker effect resumes.
function refreshEnemySlow(e){
 if(!Array.isArray(e.slowEffects))e.slowEffects=e.slowUntil>state.time?[{factor:e.slowFactor,until:e.slowUntil}]:[];
 e.slowEffects=e.slowEffects.filter(s=>s.until>state.time+1e-8);
 if(!e.slowEffects.length){e.slowFactor=1;e.slowUntil=0;return 1;}
 e.slowFactor=Math.min(...e.slowEffects.map(s=>s.factor));
 e.slowUntil=Math.max(...e.slowEffects.filter(s=>s.factor===e.slowFactor).map(s=>s.until));
 return e.slowFactor;
}
function addScorchField(shot){
 const field={x:shot.tx,y:shot.ty,radius:shot.splash,dps:shot.scorchDps,remaining:shot.scorchDuration||3,createdAt:state.time};
 // Identical repeated impacts refresh one field. Overlapping different fields
 // still apply only the strongest thermal damage to each ground unit.
 const old=state.scorchFields.find(f=>Math.hypot(f.x-field.x,f.y-field.y)<1&&Math.abs(f.radius-field.radius)<.01&&f.dps===field.dps);
 if(old){old.remaining=field.remaining;old.createdAt=state.time;}
 else{state.scorchFields.push(field);if(state.scorchFields.length>MAX_SCORCH_FIELDS)state.scorchFields.shift();}
 progressSaveNeeded=true;
}
function tickScorchFields(dt){
 if(!state.scorchFields.length)return;
 for(const e of state.enemies){
  if(e.hp<=0||isAirUnit(e))continue;
  let damage=0;
  for(const f of state.scorchFields)if(f.remaining>0&&Math.hypot(e.x-f.x,e.y-f.y)<=f.radius)damage=Math.max(damage,f.dps*Math.min(dt,f.remaining));
  if(!damage)continue;
  const total=(e.thermalCarry||0)+damage,whole=Math.floor(total+1e-8);
  e.thermalCarry=Math.max(0,total-whole);if(whole>0)damageEnemy(e,whole,true);
 }
 state.enemies=state.enemies.filter(e=>e.hp>0);
 for(const f of state.scorchFields)f.remaining=Math.max(0,f.remaining-dt);
 state.scorchFields=state.scorchFields.filter(f=>f.remaining>1e-8);
}
function drawScorchFields(){
 for(const f of state.scorchFields){
  const fade=Math.min(1,f.remaining/.65),age=state.time-f.createdAt,seed=f.x*.07+f.y*.11;
  ctx.save();ctx.globalAlpha=fade;
  const ash=ctx.createRadialGradient(f.x,f.y,f.radius*.25,f.x,f.y,f.radius);
  ash.addColorStop(0,'#1d100be0');ash.addColorStop(.65,'#4d2215a0');ash.addColorStop(1,'#81351600');
  ctx.fillStyle=ash;ctx.beginPath();ctx.arc(f.x,f.y,f.radius,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation='lighter';
  for(let i=0;i<(fullEffects?18:7);i++){
   const a=i*2.39996+seed,r=f.radius*Math.sqrt(fxNoise(i+seed))*.9;
   const x=f.x+Math.cos(a)*r,y=f.y+Math.sin(a)*r;
   const heat=.65+.25*Math.sin(age*8+i*1.7),size=4+fxNoise(seed+i+19)*8;
   const glow=ctx.createRadialGradient(x,y,0,x,y,size);
   glow.addColorStop(0,'#ffd875dd');glow.addColorStop(.3,'#ff752a99');glow.addColorStop(1,'#fa4c1800');
   ctx.globalAlpha=fade*heat;ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();
   ctx.strokeStyle=i%3?'#ffb05b':'#ffe49b';ctx.lineWidth=1.5;
   const lift=3+Math.sin(age*5+i)*2;
   ctx.beginPath();ctx.moveTo(x-2,y+2);ctx.lineTo(x+(VIEW.rotated?-lift:1),y-(VIEW.rotated?1:lift));ctx.lineTo(x+3,y);ctx.stroke();
  }
  ctx.restore();
 }
}
function specializationDescription(t,branch=t.branch){
 const text=BRANCHES[t.type][branch].desc;
 return branch==='scorch'?text+' Ожог: '+towerStats({...t,level:3,branch}).scorchDps+' урона/с, игнорирует броню. Перекрытия не складываются.':text;
}
function migrateV24Run(run){
 for(const t of run.towers||[])if(t.type==='cannon'&&['siege','cluster'].includes(t.branch))t.branch='scorch';
 for(const b of run.shots||[])if(b.cluster){
  const base=Math.round(b.damage/.9);b.damage=Math.round(base*.65);b.splash=b.splash/.78*.85;
  b.scorch=true;b.scorchDps=Math.round(b.damage/.65*.4);b.scorchDuration=3;delete b.cluster;
 }
 for(const e of run.enemies||[]){
  e.slowEffects??=e.slowUntil>run.time?[{factor:e.slowFactor,until:e.slowUntil}]:[];
  e.thermalCarry??=0;
 }
 run.scorchFields??=[];
 if(run.wave===0){run.waveClock=null;run.nextWaveIn=0;return run;}
 if(!run.waveClock){
  // Old saves cannot supply the historical release time. Preserve the battle,
  // start its remaining countdown once, and never reinitialise it on later loads.
  const previous=state;state=run;
  try{
   const cap=earlyRewardCap(run.wave+1),pending=run.queue.filter(q=>q.wave===run.wave),delay=pauseBeforeWave(run.wave+1);
   const oldBonus=run.waves.length?Math.floor(cap*(.2+.8*activeThreatRatio())):Math.floor(cap*clamp(run.nextWaveIn/Math.max(1,delay),0,1));
   run.waveClock=makeWaveClock(run.wave,run.time,pending.length?Math.max(...pending.map(q=>q.spawnAt)):run.time,oldBonus);
   if(!pending.length){run.waveClock.releaseAt=run.time;run.waveClock.dueAt=run.time+Math.min(delay,run.nextWaveIn);run.waveClock.bonusDeadline=Math.max(run.time+.001,run.waveClock.dueAt);}
   updateWaveClock(false);
  }finally{state=previous;}
 }
 return run;
}

// Campaign missions describe a tactical task, independently of the planet art.
const CAMPAIGN_ROAD_COUNTS=[1,1,1,2,2,2,2,1,2,3,2,3,2,2,2,3,2,3,2,3,3,2,3,3,2,3,3,2,3];
const SECTOR_THEMES=['swarm','swarm','rush','crossfire','armor','air','bastion','rush','air','armor','shield','crossfire','swarm','citadel','medic','air','armor','crossfire','rush','shield','carrier','crossfire','air','medic','swarm','armor','shield','mixed','command'];
const THEME_NAMES={swarm:'Плотные отряды',rush:'Быстрый обход',crossfire:'Встречные атаки',armor:'Бронированная колонна',air:'Воздушный коридор',shield:'Щитовой эскорт',medic:'Ремонтная группа',mixed:'Смешанный прорыв',bastion:'Осадный таран',citadel:'Цитадель щитов',carrier:'Носитель авиации',command:'Командный узел'};
const BOSS_KINDS=[{name:'Осадный таран',hp:1800,armor:8,speed:28},{name:'Хранитель щитов',hp:4200,armor:10,speed:30},{name:'Носитель авиации',hp:7600,armor:12,speed:30},{name:'Командный узел',hp:9000,armor:16,speed:28}];
function standardProgress(profile=appData.profile){let n=0;while(n<SECTOR_COUNT&&(profile.cleared[n]&1))n++;return n;}
function sectorUnlocked(id){return testModeActive||id===0||!!(appData.profile.cleared[id-1]&1);}
function difficultyUnlocked(id,difficulty){
 if(!Number.isInteger(id)||id<0||id>=SECTOR_COUNT||!Number.isInteger(difficulty)||difficulty<0||difficulty>=DIFFICULTIES.length||!sectorUnlocked(id))return false;
 const required=(1<<difficulty)-1;
 return testModeActive||(appData.profile.cleared[id]&required)===required;
}
function commanderKind(id){return [6,13,20,28].includes(id)?Math.min(3,Math.floor(id/7)):-1;}
function bossHealthForSector(id){const kind=commanderKind(id);return kind<0?620+id*105:BOSS_KINDS[kind].hp;}
function missionInfo(id,difficulty=0){
 const base=sectorInfo(id),assault=difficulty>0;
 return {...base,difficulty,assault,maxCore:difficulty===0?20:difficulty===1?8:5,waves:assault?1:base.waves,phases:assault?4:base.waves,
  budget:campaignOpeningBudget(id,difficulty),theme:SECTOR_THEMES[id],bossKind:commanderKind(id),
  recommendation:difficulty===0?Math.max(0,id-1):difficulty===1?3+id*2:8+id*2,
  modifier:difficulty===2?['Плотный строй','Радиопомехи','Быстрый фланг','Элитный эскорт'][id%4]:''};
}
function captureArsenal(){
 const progress=standardProgress(),types={pulse:true,cannon:progress>=1,frost:progress>=2,rail:progress>=4};
 const unlock3={pulse:7,cannon:9,frost:11,rail:13},caps={};
 for(const type of Object.keys(TOWERS)){
  if(testModeActive){types[type]=true;caps[type]=3;}
  else caps[type]=types[type]?(progress>=unlock3[type]?3:progress>=3?2:1):0;
 }
 return {progress,types,caps};
}
function arsenalDescription(a=captureArsenal()){return Object.keys(TOWERS).filter(t=>a.types[t]).map(t=>TOWERS[t].name+' '+['','I','II','III'][a.caps[t]]).join(' · ');}
function sectorBlueprint(id){
 const blueprint=baseSectorBlueprint(id),raw=blueprint.raw.map(r=>({...r,cells:r.cells.map(p=>[...p])}));
 // Convert the outermost horizontal approaches into north/south entrances.
 const order=raw.map((r,i)=>({i,y:r.cells[0][1]})).sort((a,b)=>a.y-b.y);
 const candidates=[];
 if(!blueprint.fork&&id%4!==0)candidates.push({index:order[0].i,side:-1});
 if(!blueprint.fork&&raw.length>1&&id%3!==0)candidates.push({index:order.at(-1).i,side:ROWS});
 for(const {index,side}of candidates){
  const original=raw[index].cells;
  for(const c of [2,4,6,8]){
   if(c>=original[1][0]-1)continue;
   raw[index].cells=[[c,side],[c,original[0][1]],...original.slice(1)];
   try{validateRoadClearance(raw);break;}catch(_e){raw[index].cells=original;}
  }
 }
 const reflect=id%3===1;
 return {...blueprint,raw:raw.map(r=>({...r,cells:r.cells.map(([x,y])=>[reflect?COLS-1-x:x,y])})),
  anchors:blueprint.anchors.map(a=>({...a,c:reflect?COLS-1-a.c:a.c})),name:THEME_NAMES[SECTOR_THEMES[id]]};
}
function drawEntryPort(g,route){
 const a=route.points[0],b=route.points[1],angle=Math.atan2(b.y-a.y,b.x-a.x);
 const x=clamp(a.x+Math.cos(angle)*CELL*.7,8,WIDTH-8),y=clamp(a.y+Math.sin(angle)*CELL*.7,8,HEIGHT-8);
 g.save();g.translate(x,y);g.rotate(angle);g.fillStyle=route.color;g.beginPath();g.moveTo(8,0);g.lineTo(-5,-7);g.lineTo(-2,0);g.lineTo(-5,7);g.closePath();g.fill();g.restore();
}
function missionPool(id,phase,difficulty){
 const stage=id+(difficulty?difficulty===1?2:5:0),theme=SECTOR_THEMES[id];
 const weights={swarm:7,scout:stage>=1?1:0,runner:stage>=2&&phase>=1?1:0,armor:stage>=4&&phase>=1?1:0,drone:stage>=5&&phase>=1?1:0,gunship:stage>=8&&phase>=2?1:0,guardian:stage>=10&&phase>=1?1:0,medic:stage>=14&&phase>=2?1:0};
 const boost={swarm:{swarm:4},rush:{runner:3},armor:{armor:3},air:{drone:4,gunship:2},shield:{guardian:3,armor:2},medic:{medic:2,scout:2},crossfire:{runner:1,armor:1,drone:1},bastion:{armor:2},citadel:{guardian:2},carrier:{drone:3,gunship:1},command:{medic:1,guardian:2,armor:1},mixed:{scout:1,armor:1}}[theme]||{};
 for(const[type,amount]of Object.entries(boost))if(weights[type])weights[type]+=amount;
 if(difficulty){weights.swarm=Math.max(2,weights.swarm-3);if(weights.scout)weights.scout+=2;if(weights.runner)weights.runner++;}
 if(difficulty&&phase===0){weights.swarm=12;weights.scout=stage>=1?1:0;for(const type of ['runner','armor','drone','gunship','guardian','medic'])weights[type]=0;}
 if(phase===0&&difficulty===0)for(const type of ['armor','drone','gunship','guardian','medic'])weights[type]=0;
 return Object.entries(weights).flatMap(([type,weight])=>Array(weight).fill(type));
}
function sectorWavePlan(wave){return planCampaignAttack(wave);}
function activeAssaultPhase(){
 return Math.min(4,Math.max(1,state.assaultPhase||1));
}
function spawnEnemy(item){baseSpawnEnemy(item);initialiseCombatEnemy(state.enemies.at(-1),item);}
function spawnReinforcement(owner,type){
 const wave=state.waves.find(w=>w.id===owner.wave);if(!wave)return;
 wave.total++;wave.remaining++;spawnEnemy({type,route:owner.route,wave:owner.wave,phase:owner.assaultPhase,elite:false});
 const e=state.enemies.at(-1);e.distance=Math.max(0,owner.distance/enemyRoute(owner).length*enemyRoute(e).length-35);Object.assign(e,pointOnPath(e.distance,e.route,isAirUnit(e)));e.bounty=campaignBounty(type);
}
function supportTick(dt){tickCombatSupport(dt);}
function shieldDamageFactor(e){return combatShieldFactor(e);}
function drawCampaignUnitMarks(e){
 if(state.mode!=='campaign')return;
 ctx.save();ctx.translate(e.x,e.y);if(VIEW.rotated)ctx.rotate(-Math.PI/2);
 if(e.type==='guardian'||e.type==='boss'&&e.bossKind===1){ctx.strokeStyle='#9ec8ffb0';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.arc(0,0,e.type==='boss'?38:26,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#9fcaff';ctx.fillRect(-4,-22,8,5);}
 if(e.type==='medic'){ctx.fillStyle='#b2ffbf';ctx.fillRect(-2,-24,4,12);ctx.fillRect(-6,-20,12,4);}
 if(e.bossArmor>0){ctx.strokeStyle='#99c8ff';ctx.lineWidth=2;ctx.strokeRect(-15,-17,30,27);ctx.fillStyle='#b4daff';ctx.font='bold 8px system-ui';ctx.textAlign='center';ctx.fillText('+'+e.bossArmor,0,22);}
 if(e.repairedUntil>state.time){ctx.strokeStyle='#b2ffbf';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,19,0,Math.PI*2);ctx.stroke();}
 if(e.type==='boss'){ctx.fillStyle='#ffe6bb';ctx.font='bold 8px system-ui';ctx.textAlign='center';ctx.fillText(e.bossKind>=0?BOSS_KINDS[e.bossKind].name:'КОМАНДИР',0,-43);}
 ctx.restore();
}
function refreshCampaignUI(){
 const campaign=state.mode==='campaign',m=campaign?missionInfo(state.sectorId,state.difficulty):null,assault=!!m?.assault,won=state.phase==='win',ended=won||state.phase==='lose';
 $('menuLeaveBtn').hidden=!sessionStarted;$('menuRestartBtn').hidden=!sessionStarted;
 $('techTreeBtn').hidden=campaign;$('researchBtn').hidden=campaign&&sessionStarted;$('hudTechPoints').textContent=profilePoints();
 $('techTreeBtn').classList.remove('has-points');$('techTreeBtn').title='Технологии · покупки между боями';
 $('waveValue').textContent=assault?(state.wave?'Фаза '+activeAssaultPhase()+' / 4':'Штурм'):campaign?state.wave+' из '+state.goalWaves:state.wave+' / ∞';
 $('waveValue').setAttribute('aria-label',assault?'Фаза штурма '+activeAssaultPhase()+' из 4':'Волна '+state.wave);
 $('battleSector').textContent=campaign?String(m.id+1).padStart(2,'0')+' / '+m.name+' · '+DIFFICULTIES[state.difficulty].name+' · '+THEME_NAMES[m.theme]:'БЕСКОНЕЧНАЯ ОБОРОНА';
 const t=selectedTower();$('selectionLevel').textContent=t?'УРОВЕНЬ '+t.level+' / '+towerLevelCap(t):'ЧЕРТЁЖ';
 document.querySelectorAll('.tower-card').forEach(el=>{const allowed=towerAllowed(el.dataset.type);el.disabled=!allowed;el.title=allowed?TOWERS[el.dataset.type].desc:'Открывается по ходу Стандарта';el.classList.toggle('tower-banned',!allowed);});
 if(t?.disabled){$('selectionName').textContent=TOWERS[t.type].name+' · отключена';$('selectionDesc').textContent='Удерживай башню на карте или клавишу F 2 секунды. Ремонт бесплатный; готовая часть сохраняется.';$('upgradeBtn').disabled=true;$('sellBtn').disabled=true;$('branchOptions').hidden=true;}
 if(t&&t.level>=towerLevelCap(t)){$('upgradeBtn').textContent='Доступный уровень: '+towerLevelCap(t);$('upgradeBtn').disabled=true;$('branchOptions').hidden=true;}
 if(!assault){$('nextWaveNumber').textContent=campaign?nextPreviewWave()+' / '+state.goalWaves:String(nextPreviewWave()).padStart(2,'0');refreshWaveClockUI();}
 else{
  $('nextWaveNumber').textContent='ШТУРМ';$('nextWaveTimer').textContent=state.wave?'ФАЗА '+activeAssaultPhase()+' / 4':'ПО КОМАНДЕ';
  $('waveClockBar').style.width=state.wave?((state.kills/Math.max(1,state.waves[0]?.total||state.kills))*100)+'%':'0%';
  $('startLabel').textContent=state.wave?'Штурм идёт':'Начать штурм';$('startWave').disabled=paused||!!state.wave;
  $('startWave').title='Один штурм из четырёх фаз. Отряды выходят по расписанию; бонусов вызова нет.';
  const forecast=nextAttackForecast();$('intelNext').textContent='ФАЗА '+activeAssaultPhase()+' / 4';$('intelCount').textContent=state.wave?(forecast.items.length+' в следующем отряде'):'Первый отряд показан на входе';
 }
 $('previewLabel').textContent=assault?'СОСТАВ ШТУРМА':'ВОЛНА '+nextPreviewWave()+(campaign?' / '+state.goalWaves:'');
 if(campaign){const plan=wavePlan(nextPreviewWave()),elites=plan.filter(e=>e.elite).length;$('previewText').textContent=plan.length+' врагов'+(elites?' · элита: '+elites:'')+' · '+(assault?'4 фазы':'отряды с промежутками');$('tipTitle').textContent=THEME_NAMES[m.theme];$('tipText').textContent=(m.modifier?m.modifier+'. ':'')+'Финал: '+(m.bossKind>=0?BOSS_KINDS[m.bossKind].name:'командир отряда')+' · '+bossHealthForSector(m.id)+' HP. Авиацию поражают Импульс и Рельса, Крио замедляет. Элита: ×2.6 HP, +7 брони, двойная награда. Щитоносец защищает соседей, ремонтник восстанавливает их.';}
 if(campaignAtFinal()&&!assault){$('startWave').disabled=true;$('startLabel').textContent=won?'Сектор защищён':'Финальный отряд';$('nextWaveTimer').textContent=won?'ПОБЕДА':'ФИНАЛ';$('waveClockBar').style.width='0%';}
 $('overlaySecondary').hidden=!ended;$('overlaySecondary').textContent=won?'Повторить сектор':campaign?'К карте кампании':'В главное меню';$('overlayStars').hidden=!won;
 if(won){$('boardOverlay').hidden=!sessionStarted||anyDialogOpen();$('boardOverlay').dataset.ended='false';$('pauseShortcut').hidden=true;$('overlayStars').innerHTML=campaignStarsArt(state.campaignStars);$('overlayTitle').textContent=m.id===28&&state.difficulty===0?'Кампания пройдена!':'Сектор защищён';$('overlayText').textContent=m.name+' · '+DIFFICULTIES[state.difficulty].name+' · '+state.lives+'/'+state.maxLives+' · '+timeLabel(state.time)+(state.pointAwarded?' · +1 очко технологий':' · очко уже получено');$('overlayAction').textContent='К карте кампании';}
 if(state.phase==='lose'){$('overlayAction').textContent='Повторить бой';if(state.defeatReason)$('overlayText').textContent=state.defeatReason;}
 if(ended)$('pauseBtn').disabled=true;$('campaignBadge').hidden=true;
 const settling=battleResultPending();if(settling)$('boardOverlay').hidden=true;$('gameStage').classList.toggle('battle-settling',settling);
 $('researchBtn').innerHTML='Технологии<span>Просмотр · покупки между боями</span>';
 if($('researchDialog').open)refreshTechTree();refreshLabUI();
}
function renderSectorDetails(){
 if(!difficultyUnlocked(selectedSector,selectedDifficulty))selectedDifficulty=0;
 const m=missionInfo(selectedSector,selectedDifficulty),biome=BIOMES[m.biome],mask=appData.profile.cleared[m.id],a=captureArsenal();
 $('missionCard').style.setProperty('--sector-color',biome.color);$('sectorKicker').textContent=biome.name+' / СЕКТОР '+String(m.id+1).padStart(2,'0');$('sectorName').textContent=m.name;
 $('sectorPreview').innerHTML=sectorMiniMap(m.id);drawSectorPreview(m.id);
 $('sectorFacts').innerHTML='<span><b>'+ (m.assault?'1':' '+m.waves)+'</b> '+(m.assault?'штурм · 4 фазы':'волн')+'</span><span><b>'+m.budget+'</b> монет</span><span><b>'+sectorPads(m.id).length+'</b> мест</span>'+sectorStarsSummary(m.id);
 $('difficultyOptions').innerHTML=DIFFICULTIES.map((d,i)=>{
  const unlocked=difficultyUnlocked(m.id,i),previous=DIFFICULTIES.find((_,j)=>j<i&&!(mask&(1<<j)))?.name;
  const hint=unlocked?(mask&(1<<i)?'✓ Пройдено':'+1 очко'):'Пройди '+(previous||'предыдущую сложность');
  return '<button class="difficulty-option '+(i===selectedDifficulty?'active':'')+'" data-difficulty="'+i+'" aria-pressed="'+(i===selectedDifficulty)+'" aria-disabled="'+!unlocked+'" '+(unlocked?'':'disabled')+' title="'+hint+'"><strong>'+d.name+'</strong><small>'+hint+'</small></button>';
 }).join('');
 $('missionReward').textContent=(mask&(1<<selectedDifficulty)?'Очко уже получено':'+1 очко за первую победу')+' · Ядро: '+m.maxCore+(m.assault?' · Ориентир: '+m.recommendation+' очков прокачки':'');
 $('missionDetailsTitle').textContent=m.name+' · '+DIFFICULTIES[selectedDifficulty].name;$('sectorDescription').textContent=THEME_NAMES[m.theme]+'. '+biome.desc+' Ядро: '+m.maxCore+' прочности.';
 const boss=m.bossKind>=0?BOSS_KINDS[m.bossKind].name:'Командир отряда';
 $('missionRules').innerHTML='<li>Доступный арсенал: <b>'+arsenalDescription(a)+'</b>. Уровни открываются за прохождение Стандарта и не понижаются сложностью.</li><li>'+(m.assault?'Один штурм из четырёх фаз. Отряды и короткие промежутки идут по расписанию. Досрочного вызова нет.':'Первая волна по команде. Следующие — после выпуска отряда, с паузами 5→0, 4→0 и далее. Одновременно до двух волн; ранний вызов даёт монеты.')+'</li><li>Финал: <b>'+boss+' · '+bossHealthForSector(m.id)+' HP</b>, вместе с сопровождением. Прорыв командира означает поражение.</li><li>'+(m.modifier?'Условие Кошмара: <b>'+m.modifier+'</b>.':'Базовые HP обычных юнитов не растут по секторам. Сложность задают состав, темп и взаимодействие отрядов.')+'</li><li>Технологии учитываются. '+(m.assault?'Рекомендуемый бюджет прокачки: '+m.recommendation+' очков. Это ориентир, запуск доступен и без них.':'Новые типы башен: после секторов 1, 2 и 4. II уровень — после сектора 3. III уровни по очереди после 7, 9, 11 и 13.')+'</li><li>Монеты за юнитов зависят от типа; элита ×2. Звёзды: победа / не менее половины прочности / без прорывов.</li>';
 $('deployBtn').disabled=!difficultyUnlocked(m.id,selectedDifficulty);$('deployBtn').textContent=m.assault?'Начать штурм':'Защитить сектор';
}

const TEST_APP_KEY='kontur_test_lab_v1';
function cloneData(value){return JSON.parse(JSON.stringify(value));}
function testLabToggle(){
 if(appScreen!=='home'||sessionStarted)return false;
 if(testModeActive){
  persistApp();const restored=mainAppSnapshot;testModeActive=false;mainAppSnapshot=null;
  Object.assign(appData,restored);best=mainLabBest;selectedSector=Math.min(selectedSector,standardProgress());selectedDifficulty=0;returnHome();refreshLabUI();notify('Основная кампания восстановлена');return true;
 }
 mainAppSnapshot=cloneData(appData);mainLabBest=best;let sandbox=null;
 try{const candidate=JSON.parse(localStorage.getItem(TEST_APP_KEY)||'null');if(candidate?.version===12&&validateProfile(candidate.profile,true)&&candidate.runs)sandbox=candidate;}catch(_e){}
 testModeActive=true;
 try{best=Number(localStorage.getItem('kontur_best_test_v1'))||0;}catch(_e){best=0;}
 Object.assign(appData,sandbox||{version:12,profile:cloneData(mainAppSnapshot.profile),runs:{campaign:null,endless:null},lastMode:'campaign'});
 persistApp();returnHome();refreshLabUI();notify('Тестовый режим: все сектора и 72 очка прокачки. Основной прогресс сохранён.');return true;
}
function resetLabResearch(maximise=false){
 if(!testModeActive||sessionStarted||appScreen==='battle')return false;
 appData.profile.research=maximise?Object.fromEntries(Object.entries(PERKS).filter(([id,p])=>!p.instant).map(([id,p])=>[id,p.max])):{};
 state.research={...appData.profile.research};state.techPoints=profilePoints();state.techEarned=profileEarned();
 persistApp();if($('researchDialog').open)refreshTechTree();if(appScreen==='campaign'){renderSectorDetails();refreshCommandStats();}
 refreshLabUI();notify(maximise?'Все технологии изучены':'Технологии сброшены. Доступно '+profilePoints()+' очков.');return true;
}
function refreshLabUI(){
 const dock=$('testLabDock');if(!dock)return;
 document.body.dataset.screen=appScreen;
 const host=appScreen==='campaign'?$('campaignScreen').querySelector('.command-heading'):document.body;
 if(dock.parentElement!==host)host.append(dock);
 dock.hidden=!testModeActive||appScreen==='battle';$('testLabBadge').hidden=!testModeActive;
 $('testLabPoints').textContent=profilePoints()+' очков';
 $('labResetResearch').disabled=sessionStarted;$('labMaxResearch').disabled=sessionStarted;
 $('gameVersion').textContent='v'+GAME_VERSION;
 document.body.classList.toggle('test-lab-active',testModeActive);
}
function initTestLab(){
 let taps=0,last=0;
 $('gameVersion').addEventListener('click',()=>{const time=performance.now();taps=time-last<900?taps+1:1;last=time;if(taps>=7){taps=0;testLabToggle();}});
 $('labResetResearch').addEventListener('click',()=>resetLabResearch(false));$('labMaxResearch').addEventListener('click',()=>resetLabResearch(true));
 $('labLeave').addEventListener('click',()=>{if(appScreen!=='home')returnHome();testLabToggle();});
 refreshLabUI();
}

// v12: deterministic campaign maps, persistent commander, isolated battle slots.
const SECTOR_COUNT=29,ELITE_HP_MULTIPLIER=2.6,ELITE_EXTRA_ARMOR=7;
const CAMPAIGN_ENEMY_HP={scout:620,runner:680,armor:1600,swarm:70,drone:90,gunship:680,guardian:1300,medic:850,boss:7000};
const APP_KEY='kontur_campaign_v12';
const ENDLESS_ROUTES=ROUTES.map(r=>({...r,cells:r.cells.map(p=>[...p])}));
const BIOMES=[
 {name:'Дюна',kind:'Пустынная',color:'#e6ab70',desc:'Песчаные равнины и каменистые каньоны колоний Дюны.'},
 {name:'Борея',kind:'Ледяная',color:'#a0ddeb',desc:'Ледники и снежные равнины Бореи.'},
 {name:'Пелагея',kind:'Архипелаг',color:'#83d8c6',desc:'Островные базы и соединяющие их морские эстакады Пелагеи.'},
 {name:'Терра',kind:'Земного типа',color:'#b5d484',desc:'Зелёные материки и последние колонии Терры.'}
];
const SECTOR_NAMES=['Форпост','Красная низина','Сухой каньон','Станция «Песок»','Плато связи','Карьер Гелиос','Пыльный бастион','Ледопад','Полярная дуга','Белая трещина','Криостанция','Нулевая широта','Осколки льда','Северный заслон','Ионный разлом','Тихая орбита','Плазменный берег','Грозовой узел','Пик Обсерватории','Долина Эхо','Станция Вега','Пепельные ворота','Рубеж Титан','Кольцо защиты','Медный горизонт','Сектор Аврора','Последний маяк','Цитадель','Сердце контура'];
const DIFFICULTIES=[
 {name:'Стандарт',cap:3,count:1,desc:'Отдельные волны, сюжет и открытие арсенала.'},
 {name:'Ветеран',cap:3,count:1.3,desc:'Один штурм из четырёх фаз. Технологии дают преимущество.'},
 {name:'Кошмар',cap:3,count:1.65,desc:'Один усиленный штурм с особым условием сектора.'}
];
let appScreen='home',selectedSector=0,selectedDifficulty=0;
function sectorInfo(id){const biome=Math.min(3,Math.floor(id/7)),routes=CAMPAIGN_ROAD_COUNTS[id];return{id,name:SECTOR_NAMES[id],biome,routes,waves:10+Math.floor(id*10/28),budget:campaignOpeningBudget(id)};}

function installRoutes(raw){
 validateRoadClearance(raw);
 ROUTES=raw.map(r=>{const points=r.cells.map(([c,y])=>({x:(c+.5)*CELL,y:(y+.5)*CELL})),segments=[];let length=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(len){segments.push({a,b,length:len,start:length});length+=len;}}
  return{...r,points,segments,length};});
 AIR_ROUTES=makeAirRoutes(ROUTES);CORE=ROUTES[0].points.at(-1);road.clear();
 for(const route of ROUTES)for(const seg of route.segments)for(let d=0;d<=seg.length;d+=CELL){const c=Math.floor((seg.a.x+(seg.b.x-seg.a.x)*d/seg.length)/CELL),r=Math.floor((seg.a.y+(seg.b.y-seg.a.y)*d/seg.length)/CELL);if(c>=0&&c<COLS&&r>=0&&r<ROWS)road.add(c+','+r);}
 makeLandscape();
}
function battleRules(s=state){return s.mode==='campaign'?{...DIFFICULTIES[s.difficulty],cap:s.arsenal?Math.max(...Object.values(s.arsenal.caps)):3}:{cap:3,count:1};}
function bannedTowers(){return [];}
function towerAllowed(type){return !type||state.mode!=='campaign'||!!state.arsenal?.types[type];}
function towerLevelCap(t=selectedTower()){return state.mode==='campaign'&&state.arsenal?(state.arsenal.caps[t?.type||selectedType]||Math.max(...Object.values(state.arsenal.caps))):3;}
function sectorSpawnGap(wave){return Math.max(.16,.48-.018*wave-.002*state.sectorId)/DIFFICULTIES[state.difficulty].count;}

// The boss marches inside the last ground detachment, with guards on both sides.
function addFinalBoss(out,wave){
 let start=out.findIndex(e=>e.group===out.at(-1).group);
 if(out.length-start<3&&start>0){const previous=out[start-1].group;start=out.findIndex(e=>e.group===previous);}
 const group=out[start].group,route=out[start].route;
 for(let i=start;i<out.length;i++)Object.assign(out[i],{group,route,convoy:true,gapAfter:.65});
 out.splice(start+Math.floor((out.length-start)/2),0,{type:'boss',elite:false,route,wave,group,convoy:true,gapAfter:.65});
 return start;
}
function migrateFinalBoss(run){
 if(run.mode!=='campaign'||run.encounterVersion===20||!Array.isArray(run.queue)||run.queue.some(e=>!e||typeof e!=='object'))return;
 const boss=run.queue.find(e=>e.type==='boss'&&e.wave===run.goalWaves);
 const guards=run.queue.filter(e=>e.wave===run.goalWaves&&e.type!=='boss');
 // Only change units still in the spawn queue; never move already visible enemies.
 if(boss&&!boss.convoy&&guards.length>=3){
  const start=addFinalBoss(guards,run.goalWaves);
  let next=guards[start].spawnAt;
  for(let i=start;i<guards.length;i++){guards[i].spawnAt=next;next+=spawnGap(guards[i],'campaign');}
  const newBoss=guards.find(e=>e.type==='boss');newBoss.bounty=boss.bounty;
  run.queue=run.queue.filter(e=>e.wave!==run.goalWaves).concat(guards);
  run.queue.sort((a,b)=>a.spawnAt-b.spawnAt||a.wave-b.wave);
  run.spawnTimer=run.queue.length?Math.max(0,run.queue[0].spawnAt-run.time):0;
 }
 run.encounterVersion=20;
}



function blankProfile(){return{cleared:Array(SECTOR_COUNT).fill(0),research:{},stars:Array.from({length:SECTOR_COUNT},()=>[0,0,0])};}
function validateProfile(p,allowTest=false){
 if(!p||!Array.isArray(p.cleared)||p.cleared.length!==SECTOR_COUNT||!p.research||typeof p.research!=='object'||Array.isArray(p.research))return false;
 for(let i=0;i<SECTOR_COUNT;i++)if(!Number.isInteger(p.cleared[i])||p.cleared[i]<0||p.cleared[i]>7||(!allowTest&&p.cleared[i]&&i>0&&!(p.cleared[i-1]&1)))return false;
 if(p.stars!==undefined&&(!Array.isArray(p.stars)||p.stars.length!==SECTOR_COUNT||p.stars.some((row,id)=>!Array.isArray(row)||row.length!==3||row.some((n,d)=>!Number.isInteger(n)||n<0||n>3||n>0&&!(p.cleared[id]&(1<<d))))))return false;
 for(const[id,rank]of Object.entries(p.research))if(!PERKS[id]||PERKS[id].instant||!Number.isInteger(rank)||rank<0||rank>PERKS[id].max)return false;
 return techSpentPoints(p.research)<=(allowTest?Math.max(TECH_TOTAL_COST,profileEarned(p)):profileEarned(p));
}
function profileEarned(p=appData.profile){const earned=p.cleared.reduce((a,m)=>a+((m&1)?1:0)+((m&2)?1:0)+((m&4)?1:0),0);return testModeActive&&p===appData.profile?Math.max(TECH_TOTAL_COST,earned):earned;}
function profilePoints(){return profileEarned()-techSpentPoints(appData.profile.research);}
function readApp(){
 const fresh={version:12,profile:blankProfile(),runs:{campaign:null,endless:null},lastMode:'campaign'};
 try{const a=JSON.parse(localStorage.getItem(APP_KEY)||'null');if(a&&a.version===12&&validateProfile(a.profile)&&a.runs){normaliseStars(a.profile);return{...fresh,...a,runs:{campaign:a.runs.campaign||null,endless:a.runs.endless||null}};}
  // The old game remains untouched. Its battle becomes an independent endless slot.
  const old=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
  if(old&&old.v===5&&old.state&&['build','wave','lose','win'].includes(old.state.phase)){
   const run=old.state;run.mode='endless';run.campaignWon=false;run.campaignStars=0;run.campaignLives=0;run.campaignTime=0;run.rewardQueue=[];run.rewardedWaves=[];
   if(run.phase==='win')run.phase='build';fresh.runs.endless=run;fresh.lastMode='endless';
  }
 }catch(e){storageAvailable=false;}return fresh;
}
const appData=readApp();
function persistApp(){try{localStorage.setItem(testModeActive?TEST_APP_KEY:APP_KEY,JSON.stringify(appData));storageAvailable=true;}catch(e){storageAvailable=false;}}
function restoreProgress(){return false;}
function resumable(mode){return appData.runs[mode]&&['build','wave'].includes(appData.runs[mode].phase);}
function validateRun(s){
 const finite=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isFinite(n)&&n>=min&&n<=max;
 const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 if(!s||!['campaign','endless'].includes(s.mode)||!['build','wave','win','lose'].includes(s.phase))return false;
 if(s.mode==='campaign'&&(!integer(s.sectorId,0,28)||!integer(s.difficulty,0,2)||s.encounterVersion!==undefined&&![30,31].includes(s.encounterVersion)||s.goalWaves!==(s.difficulty>0?1:s.encounterVersion>=31?sectorInfo(s.sectorId).waves:legacyCampaignWaves(s.sectorId))))return false;
 if(!integer(s.wave,0,s.mode==='campaign'?s.goalWaves:100000)||!integer(s.completed,0,s.wave)||!integer(s.lives,0,20)||!integer(s.money)||!integer(s.nextId,1)||!finite(s.time)||!finite(s.score)||!integer(s.kills)||!finite(s.nextWaveIn,0,60)||!finite(s.launchCooldown,0,2)||!finite(s.spawnTimer,-1,600))return false;
 for(const key of ['towers','enemies','queue','waves','shots','orbitalStrikes'])if(!Array.isArray(s[key]))return false;
 if(s.mode==='campaign'&&(s.rulesVersion!==30||s.maxLives!==missionInfo(s.sectorId,s.difficulty).maxCore||s.lives>s.maxLives||!s.arsenal||Object.keys(TOWERS).some(t=>typeof s.arsenal.types?.[t]!=='boolean'||!integer(s.arsenal.caps?.[t],0,3))))return false;
 if(s.towers.length>288||s.enemies.length+s.queue.length>2400||s.shots.length>2400||s.waves.length>(s.mode==='campaign'?2:4)||s.orbitalStrikes.length>4)return false;
 if(!s.research||Object.entries(s.research).some(([id,r])=>!PERKS[id]||PERKS[id].instant||!integer(r,0,PERKS[id].max)))return false;
 if(!s.abilities||Object.keys(ABILITIES).some(id=>!finite(s.abilities[id],0,ABILITIES[id].cooldown*(s.mode==='campaign'&&s.difficulty===2&&s.sectorId%4===1&&id==='orbital'?1.25:1))))return false;
 if(!finite(s.coreShield,0,8)||!finite(s.passiveShield,0,2*(s.research.coreShield||0))||!finite(s.shieldUntil)||!finite(s.shieldRegenAt))return false;
 const used=new Set(),ids=new Set(),active=new Map();let largest=0;
 const idValid=id=>{if(!integer(id,1)||ids.has(id))return false;ids.add(id);largest=Math.max(largest,id);return true;};
 for(const t of s.towers){const k=t.c+','+t.r;if(!TOWERS[t.type]||!integer(t.c,0,23)||!integer(t.r,0,11)||road.has(k)||used.has(k)||s.mode==='campaign'&&!sectorPads(s.sectorId).some(p=>p.c===t.c&&p.r===t.r)||!integer(t.level,1,s.mode==='campaign'?s.arsenal.caps[t.type]:3)||!finite(t.cooldown,-1,5)||!finite(t.angle,-100,100)||!idValid(t.id)||!finite(t.invested)||t.branch&&(!BRANCHES[t.type][t.branch]||t.level!==3)||s.mode==='campaign'&&bannedTowers(s.sectorId,s.difficulty).includes(t.type))return false;used.add(k);}
 for(const w of s.waves){if(!integer(w.id,1,s.wave)||active.has(w.id)||!integer(w.total,1,600)||!integer(w.remaining,1,w.total))return false;active.set(w.id,{count:0,remaining:w.remaining});}
 for(const e of s.enemies){if(e.bounty!==undefined&&!integer(e.bounty,0,200))return false;if(!ENEMIES[e.type]||!integer(e.route,0,ROUTES.length-1)||!active.has(e.wave)||!idValid(e.id)||!finite(e.hp,.001)||!finite(e.maxHp,e.hp)||!finite(e.distance,0,enemyRoute(e).length)||!finite(e.speed,1,300)||!finite(e.armor,0,10000)||!finite(e.stunUntil)||!finite(e.slowUntil)||!finite(e.slowFactor,.1,1))return false;active.get(e.wave).count++;}
 for(const q of s.queue){if(!finite(q.spawnAt))return false;if(q.gapAfter!==undefined&&!finite(q.gapAfter,0,16))return false;if(!ENEMIES[q.type]||!integer(q.route,0,ROUTES.length-1)||!active.has(q.wave))return false;active.get(q.wave).count++;}
 for(const w of active.values())if(w.count!==w.remaining)return false;
 for(const b of s.shots)if(!TOWERS[b.type]||b.scorch!==undefined&&typeof b.scorch!=='boolean'||b.scorch&&(!finite(b.scorchDps,1,1000000)||!finite(b.scorchDuration,.001,3))||!integer(b.targetId,1)||!finite(b.x,-100,WIDTH+100)||!finite(b.y,-100,HEIGHT+100)||!finite(b.tx,-100,WIDTH+100)||!finite(b.ty,-100,HEIGHT+100)||!finite(b.damage,1)||!finite(b.speed,1,2000)||!finite(b.ttl,0,4)||!finite(b.splash,0,200)||!finite(b.slow,0,1))return false;
 for(const p of s.orbitalStrikes)if(!finite(p.x,0,WIDTH)||!finite(p.y,0,HEIGHT)||!finite(p.remaining,0,1.06)||!finite(p.damage,1)||!finite(p.radius,1,200))return false;
 if(s.orbitalCraters!==undefined&&(!Array.isArray(s.orbitalCraters)||s.orbitalCraters.length>MAX_ORBITAL_CRATERS||s.orbitalCraters.some(p=>!finite(p.x,0,WIDTH)||!finite(p.y,0,HEIGHT)||!finite(p.radius,1,76)||!finite(p.createdAt,0,s.time)||!finite(p.seed))))return false;
 if(!Array.isArray(s.scorchFields)||s.scorchFields.length>MAX_SCORCH_FIELDS||s.scorchFields.some(f=>!finite(f.x,-100,WIDTH+100)||!finite(f.y,-100,HEIGHT+100)||!finite(f.radius,1,200)||!finite(f.dps,1,1000000)||!finite(f.remaining,0,3)||!finite(f.createdAt,0,s.time)))return false;
 if(s.enemies.some(e=>e.thermalCarry!==undefined&&!finite(e.thermalCarry,0,1)||e.slowEffects!==undefined&&(!Array.isArray(e.slowEffects)||e.slowEffects.length>8||e.slowEffects.some(v=>!finite(v.factor,.1,1)||!finite(v.until)))))return false;
 const clock=s.waveClock;
 if(s.wave===0?clock!==null:!clock||clock.version!==24||clock.fromWave!==s.wave||!finite(clock.openedAt,0,s.time)||!finite(clock.delay,0,5)||!finite(clock.bonusCap)||!finite(clock.bonusLast,0,clock.bonusCap)||!finite(clock.bonusDeadline)||clock.releaseAt!==null&&(!finite(clock.releaseAt,0,s.time)||!finite(clock.dueAt,clock.releaseAt,clock.releaseAt+5.001))||clock.releaseAt===null&&clock.dueAt!==null)return false;
 if(s.nextId<=largest||s.phase!=='lose'&&s.completed+s.waves.length!==s.wave||s.phase==='build'&&s.waves.length||s.phase==='wave'&&!s.waves.length||s.phase==='lose'&&s.lives!==0||s.phase!=='lose'&&s.lives===0)return false;
 return validateCombatState(s);
}
function resumeSavedRun(mode){
 if(!resumable(mode))return false;
 const saved=migrateV19Run(JSON.parse(JSON.stringify(appData.runs[mode])));saved.bossShots??=[];if(mode==='campaign'&&saved.rulesVersion!==30){startBattle('campaign',saved.sectorId,saved.difficulty);notify('Кампания переработана: бой начат заново. Пройденные сектора и технологии сохранены.');return true;}if(mode==='endless'&&saved.mapVersion!==19){startBattle('endless');notify('Дороги разнесены: бесконечный бой начат заново.');return true;}installRoutes(mode==='campaign'?sectorRoutes(saved.sectorId):ENDLESS_ROUTES);
 if(!validateRun(saved)){notify('Не удалось восстановить этот бой: сохранение повреждено. Остальной прогресс сохранён.',true);return false;}
 state=saved;state.bossShots??=[];for(const w of state.waves)w.totalThreat??=wavePlan(w.id).reduce((v,e)=>v+enemyThreat(e),0);state.rewardQueue=[];state.rewardedWaves=[];state.orbitalStrikes??=[];
 for(const e of state.enemies){Object.assign(e,pointOnPath(e.distance,e.route,isAirUnit(e)),{resolved:false,hit:0});if(e.commander)delete e.commander.bag;}
 for(const t of state.towers){Object.assign(t,{x:(t.c+.5)*CELL,y:(t.r+.5)*CELL,recoil:0});delete t.repairGraceUntil;}
 resetVisuals();particles=[];beams=[];floaters=[];startSession();makeLandscape();return true;
}
function deploySector(){
 const s=selectedSector,d=selectedDifficulty,mask=appData.profile.cleared[s];
 if(appScreen!=='campaign'||!difficultyUnlocked(s,d))return false;
 startBattle('campaign',s,d);return true;
}
function startBattle(mode,sectorId=0,difficulty=0){
 closeAllDialogs();closeContextPanel();endCameraGesture();abilityAim=null;state=freshState();state.mode=mode;
 state.research={...appData.profile.research};state.techPoints=0;state.techEarned=techSpentPoints(state.research);state.passiveShield=passiveShieldCapacity();
 if(mode==='campaign'){state.sectorId=sectorId;state.difficulty=difficulty;state.arsenal=captureArsenal();state.goalWaves=missionInfo(sectorId,difficulty).waves;state.maxLives=missionInfo(sectorId,difficulty).maxCore;state.lives=state.maxLives;state.rulesVersion=30;state.encounterVersion=31;state.nextWaveIn=0;state.finalBossKilled=false;state.money=missionInfo(sectorId,difficulty).budget;installRoutes(sectorRoutes(sectorId));}
 else{state.mapVersion=19;installRoutes(ENDLESS_ROUTES);}
 particles=[];beams=[];floaters=[];resetVisuals();progressSaveNeeded=false;speed=1;lastSave=0;centerMap();startSession();makeLandscape();saveProgress();
}
function retryBattle(){const mode=state.mode,id=state.sectorId,d=state.difficulty;startBattle(mode,id,d);}
function finishBattleToMap(){
 if(!['win','lose'].includes(state.phase))return;
 const mode=state.mode;if(mode==='campaign'){selectedSector=state.sectorId;selectedDifficulty=state.difficulty;}
 appData.runs[mode]=null;sessionStarted=false;appScreen='home';persistApp();if(mode==='campaign')openCommandCenter(true);else returnHome();
}
function abandonBattle(){
 const mode=state.mode;closeAllDialogs();appData.runs[mode]=null;sessionStarted=false;appScreen='home';persistApp();
 if(mode==='campaign')openCommandCenter(true);else returnHome();
}
function openCommandCenter(){
 closeAllDialogs();closeContextPanel();clearTimeout(toastTimer);$('toast').hidden=true;sessionStarted=false;appScreen='campaign';paused=true;abilityAim=null;endCameraGesture();
 state=freshState();state.research={...appData.profile.research};state.techPoints=profilePoints();state.techEarned=profileEarned();
 $('gameHud').hidden=true;$('boardOverlay').hidden=true;$('startScreen').hidden=true;$('campaignScreen').hidden=false;
 renderSectorMap();renderSectorDetails();refreshCommandStats();refreshUI();
}
function returnHome(){
 closeAllDialogs();closeContextPanel();clearTimeout(toastTimer);$('toast').hidden=true;endCameraGesture();abilityAim=null;
 sessionStarted=false;appScreen='home';paused=true;$('campaignScreen').hidden=true;$('gameHud').hidden=true;$('startScreen').hidden=false;$('boardOverlay').hidden=true;
 refreshResumeButton();refreshLabUI();uiDirty=true;
}
function refreshCommandStats(){
 const normals=appData.profile.cleared.filter(m=>m&1).length,earned=profileEarned(),points=profilePoints(),canSpend=points>0&&Object.entries(PERKS).some(([id,p])=>!p.instant&&(appData.profile.research[id]||0)<p.max&&(appData.profile.research[id]||0)+1<=points);
 $('commandProgress').textContent=normals+' / '+SECTOR_COUNT;$('commandPoints').textContent=points;$('commandResearch').textContent=techSpentPoints(appData.profile.research)+' / 72';
 $('commandTechBtn').classList.toggle('has-points',canSpend);$('commandTechBtn').title=canSpend?'Есть очки для изучения технологий':'Технологии командира';$('commandTechBtn').setAttribute('aria-label','Технологии: '+points+' свободных очков'+(canSpend?', доступно улучшение':''));
 $('campaignSummary').textContent=normals===SECTOR_COUNT?(earned===87?'Все сектора защищены на трёх сложностях.':'Все планеты защищены. Пройди остальные сложности.'):'';
}
function sectorMiniMap(id){return '<canvas id="sectorPreviewCanvas" class="sector-minimap" width="768" height="384" role="img" aria-label="Ландшафт сектора, дороги, ядро и строительные площадки"></canvas><span class="sector-preview-open" aria-hidden="true">＋ Увеличить</span>';}
function drawLargeSectorMap(){
 const id=selectedSector,m=missionInfo(id,selectedDifficulty),c=$('sectorLargeCanvas');
 const rotated=window.innerHeight>window.innerWidth&&window.innerWidth<700;
 const width=rotated?HEIGHT:WIDTH,height=rotated?WIDTH:HEIGHT;
 const scale=Math.min((window.innerWidth-72)/width,(window.innerHeight-180)/height,1.15),ratio=Math.min(window.devicePixelRatio||1,2);
 const w=Math.max(100,width*scale),h=Math.max(100,height*scale);
 c.style.width=w+'px';c.style.height=h+'px';c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);
 c.dataset.rotated=String(rotated);c.dataset.sector=String(id);
 $('sectorMapTitle').textContent='Сектор '+String(id+1).padStart(2,'0')+' · '+m.name;
 $('sectorMapSubtitle').textContent=BIOMES[m.biome].name+' · '+(m.assault?'Один штурм':m.waves+' волн')+' · '+sectorPads(id).length+' площадок';
 drawSectorPreview(id,'sectorLargeCanvas',rotated);
}
function openSectorMap(){if(appScreen!=='campaign'||sessionStarted)return;showDialog('sectorMapDialog');drawLargeSectorMap();}
function renderSectorMap(){
 $('sectorMap').innerHTML=BIOMES.map((b,act)=>'<section class="planet-row" style="--sector-color:'+b.color+'"><header class="planet-info">'+planetIcon(act)+'<div><small>ПЛАНЕТА 0'+(act+1)+'</small><h2>'+b.name+'</h2><span>'+b.kind+'</span></div></header><div class="planet-sectors" aria-label="Сектора планеты '+b.name+'"><div class="sector-chain">'+Array.from({length:act===3?8:7},(_,i)=>{
  const id=act*7+i,mask=appData.profile.cleared[id],locked=!sectorUnlocked(id);
  return '<button class="sector-node '+(locked?'locked ':'')+(mask?'cleared ':'')+(id===selectedSector?'selected':'')+'" data-sector="'+id+'" '+(locked?'disabled':'')+' aria-label="Сектор '+(id+1)+'. '+SECTOR_NAMES[id]+(locked?'. Закрыт':'')+'" aria-pressed="'+(id===selectedSector)+'"><span class="sector-orbit-node">'+String(id+1).padStart(2,'0')+'</span><strong>'+SECTOR_NAMES[id]+'</strong>'+sectorStarsSummary(id)+'</button>';
 }).join('')+'</div></div></section>').join('');
}

function refreshResumeButton(){const mode=resumable(appData.lastMode)?appData.lastMode:resumable('campaign')?'campaign':resumable('endless')?'endless':null;$('resumeRunBtn').hidden=!mode;$('resumeRunBtn').dataset.mode=mode||'';$('endlessModeBtn').textContent=resumable('endless')?'Бесконечная · продолжить':'Бесконечная оборона';}
function initCampaignUI(){
 $('sectorPreview').addEventListener('click',openSectorMap);
 $('closeSectorMap').addEventListener('click',()=>closeDialog('sectorMapDialog'));
 $('sectorMapDialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog('sectorMapDialog');});
 $('sectorMapDialog').addEventListener('click',event=>{if(event.target!==$('sectorMapDialog'))return;const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog('sectorMapDialog');});
 window.addEventListener('resize',()=>{if($('sectorMapDialog').open)drawLargeSectorMap();});
 $('sectorMap').addEventListener('click',e=>{const b=e.target.closest('[data-sector]');if(!b||b.disabled)return;selectedSector=Number(b.dataset.sector);selectedDifficulty=0;renderSectorMap();renderSectorDetails();});
 $('difficultyOptions').addEventListener('click',e=>{const b=e.target.closest('[data-difficulty]');if(!b||b.disabled||!difficultyUnlocked(selectedSector,Number(b.dataset.difficulty)))return;selectedDifficulty=Number(b.dataset.difficulty);renderSectorDetails();});
 $('missionDetailsBtn').addEventListener('click',()=>showDialog('missionDetailsDialog'));$('closeMissionDetails').addEventListener('click',()=>closeDialog('missionDetailsDialog'));$('missionDetailsDialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog('missionDetailsDialog');});$('deployBtn').addEventListener('click',deploySector);$('commandTechBtn').addEventListener('click',()=>openTechTree());$('commandHomeBtn').addEventListener('click',returnHome);
 $('endlessModeBtn').addEventListener('click',()=>{if(resumable('endless'))resumeSavedRun('endless');else startBattle('endless');});
 $('resumeRunBtn').addEventListener('click',()=>resumeSavedRun($('resumeRunBtn').dataset.mode));
 $('exportProfileBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({version:12,profile:appData.profile},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kontur_commander.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);});
 $('importProfileBtn').addEventListener('click',()=>$('importProfileFile').click());
 $('importProfileFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>50000)throw Error();const a=JSON.parse(await f.text());if(a.version!==12||!validateProfile(a.profile)||resumable('campaign'))throw Error();appData.profile=normaliseStars(a.profile);persistApp();state.research={...a.profile.research};state.techPoints=profilePoints();renderSectorMap();renderSectorDetails();refreshCommandStats();refreshUI();notify('Профиль командира восстановлен');}catch(err){notify('Не удалось загрузить профиль: нужен корректный файл КОНТУР v12 без активного боя кампании.',true);}e.target.value='';});
 refreshResumeButton();assetsReady.then(()=>{if(ART.logo)$('commandLogo').src=ART.logo.src;if(appScreen==='campaign'){renderSectorMap();drawSectorPreview(selectedSector);if($('sectorMapDialog').open)drawLargeSectorMap();}});
}

const PAD_CACHE=new Map();
function padGeometry(raw){return raw.map(r=>{const points=r.cells.map(([c,y])=>({x:(c+.5)*CELL,y:(y+.5)*CELL})),segments=[];let length=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(len){segments.push({a,b,length:len,start:length});length+=len;}}return{...r,points,segments,length};});}
function pointOnRoute(r,d){const s=r.segments.find(s=>d<=s.start+s.length)||r.segments.at(-1),f=clamp((d-s.start)/s.length,0,1);return{x:s.a.x+(s.b.x-s.a.x)*f,y:s.a.y+(s.b.y-s.a.y)*f};}
function roadCells(routes){const set=new Set();for(const r of routes)for(const s of r.segments)for(let d=0;d<=s.length;d+=CELL){const c=Math.floor((s.a.x+(s.b.x-s.a.x)*d/s.length)/CELL),y=Math.floor((s.a.y+(s.b.y-s.a.y)*d/s.length)/CELL);if(c>=0&&c<COLS&&y>=0&&y<ROWS)set.add(c+','+y);}return set;}

function buildPadAt(c,r){return state.mode==='campaign'?sectorPads(state.sectorId).find(p=>p.c===c&&p.r===r):null;}
// Nominal type rewards; extended standards share the original mission budget.
const CAMPAIGN_BOUNTIES={swarm:2,scout:8,runner:8,armor:18,drone:4,gunship:18,guardian:20,medic:16,boss:80};
function campaignBounty(type,elite=false){return CAMPAIGN_BOUNTIES[type]*(elite?2:1);}
function enemyReward(e){return state.mode==='campaign'?(e.bounty??campaignBounty(e.type,e.elite)):ENEMIES[e.type].reward;}
function drawBuildPad(g,p,occupied=false,preview=false){
 if(occupied)return;const x=p.x,y=p.y;
 g.save();g.fillStyle='#101c27bb';g.strokeStyle='#82d5dfaa';g.lineWidth=1.3;g.beginPath();g.moveTo(x-20,y-13);g.lineTo(x-13,y-20);g.lineTo(x+13,y-20);g.lineTo(x+20,y-13);g.lineTo(x+20,y+13);g.lineTo(x+13,y+20);g.lineTo(x-13,y+20);g.lineTo(x-20,y+13);g.closePath();g.fill();g.stroke();
 if(ART.ready)sprite(g,'base_pulse',x,y-1,31,0,.45,31);
 g.strokeStyle='#b4f1d5';g.lineWidth=2;for(const a of[-1,1]){g.beginPath();g.moveTo(x+a*18,y-9);g.lineTo(x+a*18,y-16);g.lineTo(x+a*11,y-16);g.stroke();}g.restore();
}
function paintSector(g,routes,pads,biome){
 if(ART.planetTerrainAtlas){const image=ART.planetTerrainAtlas,w=image.width/2,h=image.height/2;g.drawImage(image,(biome%2)*w,Math.floor(biome/2)*h,w,h,0,0,WIDTH,HEIGHT);}
 else if(ART.ready)g.drawImage(ART.terrain,0,0,WIDTH,HEIGHT);else{g.fillStyle=['#a57849','#bedce8','#347f8f','#607a3b'][biome];g.fillRect(0,0,WIDTH,HEIGHT);}
 for(const route of routes){const trace=()=>{g.beginPath();g.moveTo(route.points[0].x,route.points[0].y);for(const p of route.points.slice(1))g.lineTo(p.x,p.y);};g.lineJoin='round';g.lineCap='round';for(const[w,color]of[[48,'#12212c88'],[43,biome===1?'#879da7':'#6b736c'],[36,'#29363c'],[30,'#414d50']]){g.lineWidth=w;g.strokeStyle=color;trace();g.stroke();}g.lineWidth=1;g.setLineDash([9,13]);g.strokeStyle='#ddc99577';trace();g.stroke();g.setLineDash([]);drawEntryPort(g,route);}
}
function makeLandscape(){if(state.mode!=='campaign'){legacyLandscape();return;}paintSector(landscape.getContext('2d'),ROUTES,sectorPads(state.sectorId),sectorInfo(state.sectorId).biome);}
function drawSectorPreview(id,target='sectorPreviewCanvas',rotated=false){
 const c=$(target);if(!c)return;const g=c.getContext('2d');if(!g)return;const r=padGeometry(sectorRoutes(id)),pads=sectorPads(id);
 g.save();if(rotated)g.setTransform(0,c.height/WIDTH,-c.width/HEIGHT,0,c.width,0);else g.setTransform(c.width/WIDTH,0,0,c.height/HEIGHT,0,0);paintSector(g,r,pads,sectorInfo(id).biome);drawAirCorridors(g,makeAirRoutes(r),true);for(const p of pads)drawBuildPad(g,p,false,true);
 const core=r[0].points.at(-1);g.fillStyle='#99f5d822';g.beginPath();g.arc(core.x-8,core.y,44,0,Math.PI*2);g.fill();if(ART.ready)sprite(g,'core',core.x-8,core.y,62);else{g.fillStyle='#a8ffce';g.fillRect(core.x-16,core.y-18,28,36);}g.restore();
}

// All road bends lie on a grid with a two-cell step. Distinct lanes have land
// between them; routes only touch where they become one shared road.
const SECTOR_LAYOUTS=new Map();
function baseSectorBlueprint(id){
 const count=sectorInfo(id).routes,v=id%3,a=6+2*v,b=14+2*v,kind=id%4,ridge=16+2*(Math.floor(id/6)%2);
 const raw=[],anchors=[];let name='',note='Позиции на изгибах и вдоль дорог. Крио поддерживает соседние орудия.';
 const add=cells=>raw.push({cells});
 const anchor=(c,r,role='crossfire')=>anchors.push({c,r,role,route:0});
 const doublePass=[5,12,19,26].includes(id);
 const fork=[4,9,16,22].includes(id);
 if(fork){
  raw.push({fork:true,entryId:0,cells:[[-1,5],[4,5],[4,1],[14,1],[14,5],[23,5]]});
  raw.push({fork:true,entryId:0,cells:[[-1,5],[4,5],[4,9],[14,9],[14,5],[23,5]]});
  if(count===3)raw.push({fork:true,entryId:1,cells:[[-1,11],[20,11],[20,5],[23,5]]});
  anchor(12,3);anchor(12,7);if(count===3)anchor(18,8);
  name='Разветвлённый рубеж';note='Отряды расходятся по двум обходам и снова сходятся перед ядром.';
 }else if(doublePass){
  name='Дальний разворот';note='Одна особая позиция обстреливает прямой и обратный проходы. Дальний поворот вне радиуса Импульса.';
  const main=[[-1,1],[14,1],[14,5],[6,5],[6,7],[22,7],[22,5],[23,5]];
  add(main);anchor(10,3,'double_pass');anchor(8,3,'support');
  if(count===4)add([[-1,3],[2,3],[2,1],...main.slice(1)]);
  if(count>=2)add([[-1,9],[22,9],[22,5],[23,5]]);
  if(count>=3)add([[-1,11],[22,11],[22,5],[23,5]]);
 }else if(count===1){
  if(kind===0){name='Широкая дуга';add([[-1,3],[a,3],[a,7],[b,7],[b,5],[23,5]]);anchor(a+1,5);}
  if(kind===1){name='Ступенчатый рубеж';add([[-1,1],[a,1],[a,5],[b,5],[b,9],[20,9],[20,5],[23,5]]);anchor(a+1,3);}
  if(kind===2){name='Компактный бастион';const x=10+2*(Math.floor(id/4)%2);add([[-1,3],[x,3],[x,7],[x-4,7],[x-4,9],[20,9],[20,5],[23,5]]);anchor(x-2,5);}
  if(kind===3){name='Высокая гряда';add([[-1,9],[4,9],[4,5],[10,5],[10,1],[18,1],[18,5],[23,5]]);anchor(12,3);}
 }else if(count===2){
  if(kind===0){name='Два фланга';add([[-1,1],[a,1],[a,3],[16,3],[16,5],[22,5],[23,5]]);add([[-1,11],[4+2*v,11],[4+2*v,9],[18,9],[18,7],[22,7],[22,5],[23,5]]);anchor(a+2,2);anchor(16,8);}
  if(kind===1){name='Верхний обход';add([[-1,3],[a,3],[a,1],[16,1],[16,3],[20,3],[20,5],[23,5]]);add([[-1,9],[10+2*v,9],[10+2*v,7],[20,7],[20,5],[23,5]]);anchor(a+2,2);anchor(17,8);}
  if(kind===2){name='Встречные рубежи';add([[-1,1],[4+2*v,1],[4+2*v,5],[18,5],[23,5]]);add([[-1,11],[b,11],[b,7],[22,7],[22,5],[23,5]]);anchor(6+2*v,3);anchor(b+1,9);}
  if(kind===3){name='Дуга и долина';add([[-1,5],[a,5],[a,1],[18,1],[18,5],[23,5]]);add([[-1,11],[4,11],[4,9],[14,9],[14,7],[22,7],[22,5],[23,5]]);anchor(a+2,3);anchor(12,8);}
 }else{
  name=count===3?'Три рубежа':'Четыре направления';
  add([[-1,1],[a,1],[a,3],[ridge,3],[ridge,1],[22,1],[22,5],[23,5]]);
  if(count===3){
   add(kind%2?[[-1,7],[10+2*v,7],[10+2*v,5],[22,5],[23,5]]:[[-1,5],[22,5],[23,5]]);
   add([[-1,11],[8+2*v,11],[8+2*v,9],[18,9],[18,7],[22,7],[22,5],[23,5]]);
  }else{
   add([[-1,5],[23,5]]);
   add(kind%2?[[-1,7],[18,7],[18,5],[23,5]]:[[-1,7],[22,7],[22,5],[23,5]]);
   add([[-1,11],[a,11],[a,9],[18,9],[18,11],[22,11],[22,5],[23,5]]);
  }
  anchor(a+2,2);anchor(16,10);
 }
 return{raw,anchors,name,note,doublePass,fork};
}
function validateRoadClearance(raw){
 const graph=new Map(),directed=new Map(),key=(c,r)=>c+','+r;
 const ensure=k=>{if(!graph.has(k))graph.set(k,new Set());return graph.get(k);};
 let endpoint=null;const entries=new Map();
 for(const path of raw){
  const cells=path.cells;const end=key(...cells.at(-1));
  if(endpoint!==null&&endpoint!==end)throw Error('Roads must join the same core');endpoint=end;
  const entry=key(...cells[0]);if(entries.has(entry)&&!(path.fork&&entries.get(entry)===path.entryId))throw Error('Duplicate road entrance');entries.set(entry,path.entryId??null);
  const visited=new Set([entry]);ensure(entry);
  for(let i=1;i<cells.length;i++){
   const[a,b]=[cells[i-1],cells[i]],dx=Math.sign(b[0]-a[0]),dy=Math.sign(b[1]-a[1]);
   if(dx&&dy)throw Error('Diagonal road segment');
   const length=Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]);
   for(let n=1;n<=length;n++){
    const c=a[0]+dx*n,r=a[1]+dy*n;
    if(!Number.isInteger(c)||!Number.isInteger(r)||c<0||c>=COLS||r<0||r>=ROWS)throw Error('Road outside field');
    const from=key(c-dx,r-dy),to=key(c,r);
    if(visited.has(to))throw Error('Road crosses itself');visited.add(to);
    if(directed.get(to)?.has(from))throw Error('Opposing road traffic');if(!directed.has(from))directed.set(from,new Set());directed.get(from).add(to);ensure(from).add(to);ensure(to).add(from);
   }
  }
 }
 // Check the complete union, not just the two legs of a U-turn. Nearby cells
 // are allowed only when connected as one local corner or a real junction.
 for(const [k,neighbors]of graph){
  const[c,r]=k.split(',').map(Number);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   if(!dx&&!dy)continue;const other=key(c+dx,r+dy);if(!graph.has(other))continue;
   if(!dx||!dy){if(!neighbors.has(other))throw Error('Roads need one empty cell: '+k+' / '+other);}
   else if(![key(c+dx,r),key(c,r+dy)].some(mid=>neighbors.has(mid)&&graph.get(mid)?.has(other)))throw Error('Roads touch diagonally: '+k+' / '+other);
  }
 }
 const edges=[...graph.values()].reduce((n,a)=>n+a.size,0)/2;
 if(!raw.some(r=>r.fork)&&edges!==graph.size-1)throw Error('Roads cross and rejoin instead of merging');
 const indegree=new Map([...graph.keys()].map(k=>[k,0]));
 for(const targets of directed.values())for(const k of targets)indegree.set(k,indegree.get(k)+1);
 const ready=[...indegree].filter(([,n])=>n===0).map(([k])=>k);let seen=0;
 while(ready.length){const k=ready.pop();seen++;for(const next of directed.get(k)||[]){indegree.set(next,indegree.get(next)-1);if(indegree.get(next)===0)ready.push(next);}}
 if(seen!==graph.size)throw Error('Road network contains a directed loop');
 return{cells:graph.size,edges};
}
function sectorLayout(id){
 if(SECTOR_LAYOUTS.has(id))return SECTOR_LAYOUTS.get(id);
 const blueprint=sectorBlueprint(id),mirror=id%2===1,reflected=([x,y])=>[x,mirror?ROWS-1-y:y];
 const routes=blueprint.raw.map((r,i)=>({...r,name:'КОРИДОР '+String.fromCharCode(65+i),color:['#78d7e1','#d4fa7a','#ffb56b','#c0a4ff'][i],cells:r.cells.map(reflected)}));
 validateRoadClearance(routes);
 const geometry=padGeometry(routes),roads=roadCells(geometry),pads=[];
 function add(c,r,role='line'){
  if(c<0||c>=COLS||r<0||r>=ROWS||roads.has(c+','+r)||pads.some(p=>p.c===c&&p.r===r))return false;
  pads.push({c,r,x:(c+.5)*CELL,y:(r+.5)*CELL,label:String(pads.length+1).padStart(2,'0'),hub:'route',role});return true;
 }
 for(const a of blueprint.anchors){const[c,r]=reflected([a.c,a.r]);if(!add(c,r,a.role))throw Error('Invalid anchor in sector '+id);}
 const target=id<3?6:id<9?8:id<18?10:12,candidates=[];
 for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++){
  if(roads.has(c+','+r))continue;const x=(c+.5)*CELL,y=(r+.5)*CELL;let coverage=0;
  for(const route of geometry)for(let d=0;d<route.length;d+=CELL/2){const p=pointOnRoute(route,d);if(Math.hypot(x-p.x,y-p.y)<=130)coverage++;}
  if(coverage>=4)candidates.push({c,r,x,y,coverage});
 }
 const gap=p=>pads.length?Math.min(...pads.map(q=>Math.hypot(p.c-q.c,p.r-q.r))):99;
 for(const a of [...pads]){
  if(pads.length>=target)break;
  const options=candidates.filter(p=>gap(p)>=2&&Math.hypot(p.c-a.c,p.r-a.r)<=2.8);
  options.sort((a,b)=>b.coverage-a.coverage);if(options.length)add(options[0].c,options[0].r,'support');
 }
 for(const fraction of [.12,.85,.36,.66,.96])for(const path of geometry){
  if(pads.length>=target)break;const point=pointOnRoute(path,path.length*fraction);
  const options=candidates.filter(p=>gap(p)>=2&&Math.hypot(p.x-point.x,p.y-point.y)<=3*CELL);
  options.sort((a,b)=>(Math.hypot(a.x-point.x,a.y-point.y)-Math.min(a.coverage,16)*1.5)-(Math.hypot(b.x-point.x,b.y-point.y)-Math.min(b.coverage,16)*1.5));
  if(options.length)add(options[0].c,options[0].r);
 }
 while(pads.length<target){
  const options=candidates.filter(p=>gap(p)>=Math.SQRT2);
  options.sort((a,b)=>(gap(b)+Math.min(b.coverage,20)*.035)-(gap(a)+Math.min(a.coverage,20)*.035));
  if(!options.length)throw Error('Not enough platforms in sector '+id);add(options[0].c,options[0].r);
 }
 const result={routes,pads,hubs:[],mirror,name:blueprint.name,note:blueprint.note,doublePass:blueprint.doublePass};
 SECTOR_LAYOUTS.set(id,result);return result;
}
function sectorRoutes(id){return sectorLayout(id).routes;}
function sectorPads(id){return sectorLayout(id).pads;}



function supportPartners(tower){
 if(!tower)return[];const t=towerStats(tower);
 return state.towers.filter(other=>other.id!==tower.id&&(tower.type==='frost')!==(other.type==='frost')&&Math.hypot(other.x-tower.x,other.y-tower.y)<=3.35*CELL).filter(other=>{
  const r=towerStats(other).range;
  return ROUTES.some(path=>{for(let d=0;d<path.length;d+=18){const p=pointOnRoute(path,d);if(Math.hypot(p.x-tower.x,p.y-tower.y)<=t.range&&Math.hypot(p.x-other.x,p.y-other.y)<=r)return true;}return false;});
 });
}
function drawSupportCoverage(selected){
 if(!selected||state.mode!=='campaign')return;const partners=supportPartners(selected);
 for(const t of partners){const r=towerStats(t).range;ctx.save();ctx.strokeStyle='#8fddff55';ctx.fillStyle='#8fddff08';ctx.lineWidth=1;ctx.setLineDash([3,7]);ctx.beginPath();ctx.arc(t.x,t.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([4,4]);ctx.strokeStyle='#b1e9ffb0';ctx.beginPath();ctx.moveTo(selected.x,selected.y);ctx.lineTo(t.x,t.y);ctx.stroke();ctx.restore();}
}

// v18: aircraft use independent, visible corridors; all hit tests share one rule.
function isAirUnit(enemy){return !!ENEMIES[typeof enemy==='string'?enemy:enemy.type]?.flying;}
function canHitTarget(weapon,enemy){return !isAirUnit(enemy)||weapon.type!=='cannon';}
function enemyRoute(enemy){return (isAirUnit(enemy)?AIR_ROUTES:ROUTES)[enemy.route];}
function makeAirRoutes(ground){
 return ground.map((route,index)=>{
  const source=route.points,points=[{...source[0]}];
  for(let i=1;i<source.length-1;i++){
   const previous=source[i-1],p=source[i],next=source[i+1];
   const a=Math.hypot(p.x-previous.x,p.y-previous.y),b=Math.hypot(next.x-p.x,next.y-p.y);
   const cut=Math.min(CELL*1.35,a*.32,b*.32);
   points.push({x:p.x+(previous.x-p.x)*cut/a,y:p.y+(previous.y-p.y)*cut/a});
   points.push({x:p.x+(next.x-p.x)*cut/b,y:p.y+(next.y-p.y)*cut/b});
  }
  points.push({...source.at(-1)});
  const segments=[];let length=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b.x-a.x,b.y-a.y);if(distance){segments.push({a,b,length:distance,start:length});length+=distance;}}
  return {points,segments,length,color:'#a4efff',index};
 });
}
function drawAirCorridors(g,routes=AIR_ROUTES,preview=false){
 g.save();g.lineJoin='round';g.lineCap='round';g.lineWidth=preview?2.4:1.7;g.strokeStyle=preview?'#b1f6ffcc':'#9de9ff91';g.setLineDash([6,10]);
 for(const route of routes){
  g.beginPath();g.moveTo(route.points[0].x,route.points[0].y);for(const p of route.points.slice(1))g.lineTo(p.x,p.y);g.stroke();
  g.save();g.setLineDash([]);const p=pointOnRoute(route,Math.min(110,route.length*.12)),segment=route.segments.find(s=>110<=s.start+s.length)||route.segments[0];
  g.translate(p.x,p.y);g.rotate(Math.atan2(segment.b.y-segment.a.y,segment.b.x-segment.a.x));g.fillStyle='#c2f8ff';g.beginPath();g.moveTo(8,0);g.lineTo(-6,-5);g.lineTo(-2,0);g.lineTo(-6,5);g.closePath();g.fill();g.restore();
 }
 g.restore();
}
function campaignAirGroup(sector,wave){
 if(wave<4||((wave-4)%4!==0&&wave!==sector.waves))return [];
 const rule=DIFFICULTIES[state.difficulty],light=Math.ceil((2+sector.biome+Math.floor((wave-4)/8))*rule.count);
 const heavy=sector.id>=7&&wave>=10?Math.ceil((1+Math.floor(sector.id/14))*rule.count*.65):0;
 return [...Array(light).fill('drone'),...Array(heavy).fill('gunship')];
}
function addCampaignAircraft(out,sector,wave){
 const air=campaignAirGroup(sector,wave);if(!air.length)return;
 const first=Math.min(out.length-air.length,Math.floor(out.length*.42/6)*6);
 for(let j=0;j<air.length;j++){
  const item=out[first+j];item.type=air[j];item.elite=false;
 }
}

function migrateV19Run(saved){
 const old=saved.mode==='campaign'?saved.rulesVersion:saved.mapVersion;
 if(saved.mode==='campaign'&&[17,18].includes(old))saved.rulesVersion=19;
 if(saved.mode==='endless'&&[17,18].includes(old))saved.mapVersion=19;
 for(const t of Array.isArray(saved.towers)?saved.towers:[])if(t.type==='cannon'&&t.branch==='siege')t.branch='scorch';
 normaliseSpawnQueue(saved);if(saved.rulesVersion!==30)migrateFinalBoss(saved);
 if(saved.mode==='campaign'&&[17,18].includes(old)){saved.launchCooldown=0;saved.nextWaveIn=Math.min(saved.nextWaveIn,5-4*clamp(saved.wave/Math.max(1,saved.goalWaves-1),0,1));}
 if(saved.wave===0)saved.nextWaveIn=0;
 saved.orbitalCraters??=[];
 return migrateV24Run(saved);
}
function normaliseStars(profile){
 if(!profile.stars)profile.stars=Array.from({length:SECTOR_COUNT},()=>[0,0,0]);
 return profile;
}
function sectorStars(id,difficulty){return appData.profile.stars?.[id]?.[difficulty]||0;}
function sectorStarsSummary(id){
 const n=Math.max(0,...(appData.profile.stars?.[id]||[])),done=appData.profile.cleared[id];
 return '<span class="sector-star-summary" aria-label="'+(n?'Лучший результат: '+n+' из 3 звёзд':done?'Пройдено; прежняя оценка не сохранена':'Ещё не пройдено')+'">'+(n?'★'.repeat(n)+'☆'.repeat(3-n):done?'✓':'☆☆☆')+'</span>';
}

AIR_ROUTES=makeAirRoutes(ROUTES);

const EARLY_REWARD_CACHE=new Map(),PLANET_PORTRAITS=new Map();
let pendingBattleAction='leave';
function spawnGap(item,mode=state.mode){return mode==='campaign'?(item.gapAfter??.8):Math.max(.24,.68-item.wave*.016);}
function normaliseSpawnQueue(run){
 if(!Array.isArray(run.queue))return;
 let next=(run.time||0)+Math.max(0,run.spawnTimer||0);
 for(const item of run.queue){if(item.spawnAt===undefined)item.spawnAt=next;next=item.spawnAt+spawnGap(item,run.mode);}
 run.queue.sort((a,b)=>a.spawnAt-b.spawnAt||a.wave-b.wave);
}
function spawnQueuedEnemies(){
 while(state.queue.length&&state.queue[0].spawnAt<=state.time+1e-8){const item=state.queue.shift();spawnEnemy(item);markLastRelease(item);}
 state.spawnTimer=state.queue.length?Math.max(0,state.queue[0].spawnAt-state.time):0;
}
function enemyThreat(item,hp=null){return (hp??enemyHealth(item.type,item.wave)*(item.elite?ELITE_HP_MULTIPLIER:1))*(1+.035*(ENEMIES[item.type].armor+(item.elite?ELITE_EXTRA_ARMOR:0)));}
function activeThreatRatio(){
 const total=state.waves.reduce((v,w)=>v+(w.totalThreat||wavePlan(w.id).reduce((s,e)=>s+enemyThreat(e),0)),0);
 const alive=state.enemies.reduce((v,e)=>v+(e.hp>0?enemyThreat(e,e.hp):0),0),queued=state.queue.reduce((v,e)=>v+enemyThreat(e),0);
 return total?clamp((alive+queued)/total,0,1):0;
}
function earlyRewardCap(n){
 const key=[state.mode,state.sectorId,state.difficulty,state.encounterVersion,state.goalWaves,n].join('/');if(EARLY_REWARD_CACHE.has(key))return EARLY_REWARD_CACHE.get(key);
 if(extendedStandard()){const cap=standardEconomy().earlyCaps[n]||0;EARLY_REWARD_CACHE.set(key,cap);return cap;}
 let budget=0;
 const first=state.mode==='campaign'?1:n;
 for(let wave=first;wave<=n;wave++){const value=wavePlan(wave).reduce((v,e)=>v+(state.mode==='campaign'?campaignBounty(e.type,e.elite):ENEMIES[e.type].reward),0);budget=Math.max(budget,value);}
 const cap=20+n*2+Math.round(budget*.18);EARLY_REWARD_CACHE.set(key,cap);return cap;
}
function earlyRewardCapForMission(id,difficulty,n){
 const previous=state;state={...state,mode:'campaign',sectorId:id,difficulty,encounterVersion:31,goalWaves:difficulty?1:sectorInfo(id).waves};try{return earlyRewardCap(n);}finally{state=previous;}
}
function planetIcon(index){
 if(ART.planetAtlas&&!PLANET_PORTRAITS.has(index)){const c=document.createElement('canvas');c.width=c.height=144;const image=ART.planetAtlas,w=image.width/2,h=image.height/2;c.getContext('2d').drawImage(image,(index%2)*w,Math.floor(index/2)*h,w,h,0,0,144,144);PLANET_PORTRAITS.set(index,c.toDataURL('image/png'));}
 return PLANET_PORTRAITS.has(index)?'<img class="planet-portrait" src="'+PLANET_PORTRAITS.get(index)+'" alt="'+BIOMES[index].kind+'" width="144" height="144">':'<span class="planet planet-'+index+'"><i></i></span>';
}
function requestBattleAction(action){
 if(!sessionStarted)return;pendingBattleAction=action;closeDialog('menuDialog');
 $('resetDialog').querySelector('h2').textContent=action==='restart'?'Начать бой заново?':'Покинуть текущий бой?';
 $('resetDialog').querySelector('p').textContent=action==='restart'?'Расстановка, волны и монеты этого боя будут сброшены. Прогресс кампании и технологии сохранятся.':'Текущий бой будет завершён. Пройденные сектора и технологии сохранятся.';
 $('confirmReset').textContent=action==='restart'?'Заново':'Покинуть';showDialog('resetDialog');
}
function confirmBattleAction(){closeAllDialogs();if(pendingBattleAction==='restart')retryBattle();else abandonBattle();}

/* __BATTLE_SYSTEM__ */

makeLandscape();fitCanvas();const restored=restoreProgress();const assetsReady=loadArt();refreshUI();requestAnimationFrame(frame);
initShell(restored);initProgression();initCampaignUI();initTestLab();initCombatInput();

