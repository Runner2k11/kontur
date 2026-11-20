// Battle progression, commander skills and free field repairs (build 1.030).
const COMMANDER_RADIUS = 5 * CELL;
const REPAIR_SECONDS = 2;
const COMMANDER_SKILLS = ['landing', 'armor', 'repair', 'sabotage'];
const COMMANDER_NAMES = {landing:'ВЫСАДКА', armor:'БРОНЕКУПОЛ', repair:'РЕМОНТНЫЙ ИМПУЛЬС', sabotage:'ДИВЕРСИОННЫЙ ВЫСТРЕЛ'};
let repairHold = null;
const repairPointers = new Set();
const CAMPAIGN_ECONOMY = new Map();
const BATTLE_RESULT_DELAY = 2000;
const BATTLE_RESULT = {run:null,until:0};
const ENTRY_FORECAST = {run:null,key:null,stamp:''};

function beginBattleResult(){
 BATTLE_RESULT.run=state;BATTLE_RESULT.until=performance.now()+BATTLE_RESULT_DELAY;
 closeAllDialogs();closeContextPanel();uiDirty=true;
}
function battleResultPending(){
 return sessionStarted&&BATTLE_RESULT.run===state&&['win','lose'].includes(state.phase)&&performance.now()<BATTLE_RESULT.until;
}
function tickBattleResult(dt){
 if(BATTLE_RESULT.run!==state||!BATTLE_RESULT.until)return;
 // Only debris and graphics continue; the battle and its recorded time are over.
 advanceDebris(dt);updateVisuals(dt);
 if(performance.now()>=BATTLE_RESULT.until){BATTLE_RESULT.until=0;uiDirty=true;}
}

function legacyCampaignWaves(id){return 6+Math.floor(id/6);}
function extendedStandard(run=state){return run.mode==='campaign'&&run.difficulty===0&&run.encounterVersion>=31;}
function standardWaveSlot(id,wave,count){
 const original=legacyCampaignWaves(id);
 if(count<=original)return {progress:(wave-1)/Math.max(1,count-1),recipeWave:wave,interlude:false};
 const main=Array.from({length:original},(_,i)=>1+Math.round(i*(count-1)/(original-1)));
 const exact=main.indexOf(wave),index=exact>=0?exact:Math.max(0,main.findIndex(n=>n>wave)-1);
 return {progress:index/(original-1),recipeWave:exact>=0?index+1:wave*17+index+1,interlude:exact<0};
}
function standardEconomy(){
 const id=state.sectorId,count=state.goalWaves||missionInfo(id,0).waves,key=id+'/'+count;
 if(CAMPAIGN_ECONOMY.has(key))return CAMPAIGN_ECONOMY.get(key);
 const oldCount=legacyCampaignWaves(id),oldPlans=Array.from({length:oldCount},(_,i)=>rawCampaignAttack(i+1,oldCount));
 const plans=Array.from({length:count},(_,i)=>rawCampaignAttack(i+1,count));
 const nominal=plan=>plan.reduce((sum,e)=>sum+campaignBounty(e.type,e.elite),0);
 const nonBoss=plan=>plan.reduce((sum,e)=>sum+(e.type==='boss'?0:campaignBounty(e.type,e.elite)),0);
 const oldKills=oldPlans.reduce((sum,plan)=>sum+nonBoss(plan),0),newKills=plans.reduce((sum,plan)=>sum+nonBoss(plan),0);
 const prefix=[0];for(const plan of plans)prefix.push(prefix.at(-1)+nonBoss(plan));
 let max=0;const oldCaps=oldPlans.map((plan,i)=>{max=Math.max(max,nominal(plan));return 20+2*(i+1)+Math.round(max*.18);});
 max=0;const newCaps=plans.map((plan,i)=>{max=Math.max(max,nominal(plan));return 20+2*(1+i*(oldCount-1)/(count-1))+Math.round(max*.18);});
 const earlyBudget=oldCaps.slice(1).reduce((sum,n)=>sum+n,0),earlyRaw=newCaps.slice(1).reduce((sum,n)=>sum+n,0);
 const earlyCaps=[0,0,...newCaps.slice(1).map(cap=>Math.floor(cap*earlyBudget/earlyRaw+1e-8))];
 const remainder=earlyBudget-earlyCaps.reduce((sum,n)=>sum+n,0);
 for(let i=0;i<remainder;i++)earlyCaps[count-i]++;
 const result={oldCount,count,killScale:oldKills/newKills,prefix,earlyCaps,killBudget:oldKills,clearBudget:20*oldCount,earlyBudget};
 CAMPAIGN_ECONOMY.set(key,result);return result;
}
function campaignWaveBonus(wave){
 if(!extendedStandard())return 20;
 const e=standardEconomy();return Math.floor(wave*e.clearBudget/e.count+1e-8)-Math.floor((wave-1)*e.clearBudget/e.count+1e-8);
}
function campaignRewardText(type,elite=false){
 const nominal=campaignBounty(type,elite);
 if(!extendedStandard()||type==='boss')return String(nominal);
 const value=nominal*standardEconomy().killScale,low=Math.floor(value+1e-8),high=Math.ceil(value-1e-8);
 return low===high?String(low):low+'–'+high;
}

function campaignOpeningBudget(id, difficulty=0) {
 return 100 + Math.min(40, Math.floor(id / 2) * 5) + difficulty * 25;
}
function battleEntryGroups(routes=ROUTES) {
 const entries = new Map();
 routes.forEach((route,index) => {
  const key=route.cells[0].join(',');
  if(!entries.has(key))entries.set(key,[]);
  entries.get(key).push(index);
 });
 return [...entries.values()];
}
function plannedUnitSpeed(item) {
 const m=missionInfo(state.sectorId,state.difficulty);
 if(item.type==='boss')return m.bossKind<0?ENEMIES.boss.speed:BOSS_KINDS[m.bossKind].speed;
 return (item.groupSpeed || ENEMIES[item.type].speed*(item.elite?1.05:1)) * (m.modifier==='Быстрый фланг'&&item.type==='runner'?1.15:1);
}
function rawCampaignAttack(wave,waveCount=state.goalWaves||missionInfo(state.sectorId,state.difficulty).waves) {
 const m=missionInfo(state.sectorId,state.difficulty), out=[], entries=battleEntryGroups();
 const stage=m.id+(m.difficulty===1?2:m.difficulty===2?5:0);
 let group=0, offset=0;
 for(let local=0;local<(m.assault?4:1);local++) {
  const slot=m.assault?null:standardWaveSlot(m.id,wave,waveCount),progress=m.assault?local/3:slot.progress;
  const recipeWave=m.assault?wave:slot.recipeWave,interlude=!!slot?.interlude;
  const phase=m.assault?local+1:Math.min(4,1+Math.floor(progress*3.99));
  const groups=m.assault?[9,8,9,10][local]+Math.floor(m.id/12):interlude?1:2+Math.floor(progress*3)+Math.floor(m.id/14)+(m.id>=5?1:0);
  const size=(m.assault?3+local:3+Math.floor(progress*4))+Math.floor(m.id/14);
  const used={}, limits={scout:Math.floor(progress*(3+m.id*.5)), runner:Math.floor(progress*(1+stage*.35)), armor:stage>=3?Math.floor(progress*(1+stage*.18)):0, gunship:stage>=7&&progress>=.6?1+Math.floor(stage/14):0, guardian:stage>=8&&progress>=.45?1+Math.floor(stage/14):0, medic:stage>=11&&progress>=.55?1+Math.floor(stage/19):0};
  const pool=['swarm','swarm','swarm','swarm'];
  if(progress>=.25)pool.push('scout');
  if(stage>=1&&progress>=.5)pool.push('runner');
  if(!interlude&&stage>=3&&progress>=.45)pool.push('armor');
  if(stage>=4&&progress>=.35)pool.push('drone','drone');
  if(!interlude&&stage>=7&&progress>=.6)pool.push('gunship');
  const themeType={rush:'runner',armor:'armor',air:'drone',bastion:'armor',carrier:'drone'}[m.theme];
  if(themeType&&pool.includes(themeType))pool.push(themeType,themeType);
  for(let cohort=0;cohort<groups;cohort++) {
   group++;
   const fronts=progress<.4?1:progress<.8?Math.min(2,entries.length):entries.length;
   const entry=entries[(group-1+recipeWave-1)%fronts], route=entry[(Math.floor((group-1)/fronts)+recipeWave+m.id)%entry.length];
   const formation=wave*100+group;
   const support=interlude?null:cohort===Math.floor(groups*.6)&&limits.guardian?'guardian':cohort===groups-1&&limits.medic?'medic':null;
   const types=[];
   for(let i=0;i<size;i++) {
    const seed=group*37+i*11+recipeWave*7+m.id*19;
    let type=pool[seed%pool.length];
    if((used[type]||0)>=(limits[type]??Infinity))type='swarm';
    used[type]=(used[type]||0)+1;types.push(type);
   }
   if(support){types[Math.floor(size/2)]=support;types[0]='scout';types[size-1]=stage>=12?'armor':'scout';}
   const groupSpeed=support?ENEMIES[support].speed:0;
   for(let i=0;i<types.length;i++) {
    const type=types[i], seed=group*37+i*11+recipeWave*7+m.id*19;
    const elite=!interlude&&type!=='swarm'&&m.id>=4&&progress>=.65&&(seed%100<(m.difficulty===2?16:m.difficulty===1?8:Math.min(9,m.id*.3))||m.modifier==='Элитный эскорт'&&cohort===groups-1&&!isAirUnit(type)&&i%2===1);
    const gap=(support?.5:m.assault?.8-progress*.35:1.05-progress*.45)*(m.modifier==='Плотный строй'?.92:1);
    const hpScale=.4+.6*progress;
    out.push({type,elite,route,wave,group,formation,phase,groupSpeed,hpScale,spawnOffset:offset,gapAfter:gap,bounty:campaignBounty(type,elite)});
    offset+=gap;
   }
   offset+=m.assault?2.4-progress*1.4:3-progress*1.2;
  }
 }
 if(wave===waveCount)scheduleCommander(out,wave);
 return out.sort((a,b)=>a.spawnOffset-b.spawnOffset);
}
function planCampaignAttack(wave){
 const out=rawCampaignAttack(wave);
 if(!extendedStandard())return out;
 const e=standardEconomy();let cursor=(e.prefix[wave-1]||0)*e.killScale;
 for(const item of out)if(item.type!=='boss'){
  const before=Math.floor(cursor+1e-8);cursor+=campaignBounty(item.type,item.elite)*e.killScale;
  item.bounty=Math.floor(cursor+1e-8)-before;
 }
 return out;
}
function scheduleCommander(out,wave) {
 const route=[...new Set(out.map(e=>e.route))].sort((a,b)=>ROUTES[b].length-ROUTES[a].length)[0];
 const spec={type:'boss',elite:false,route,wave,group:out.at(-1).group,phase:4,bounty:campaignBounty('boss')};
 const travel=item=>(isAirUnit(item)?AIR_ROUTES:ROUTES)[item.route].length/plannedUnitSpeed(item);
 let arrival=Math.max(travel(spec),...out.map(item=>item.spawnOffset+travel(item)));
 const lastGroup=out.filter(item=>item.group===out.at(-1).group);
 // Keep the final escorts at the back of the schedule, ending at the same ETA.
 lastGroup.forEach((item,i)=>{item.spawnOffset=Math.max(item.spawnOffset,arrival-travel(item)-(lastGroup.length-1-i)*.65);});
 arrival=Math.max(...out.map(item=>item.spawnOffset+travel(item)));
 spec.spawnOffset=Math.max(0,arrival-travel(spec));
 const preceding=out.filter(item=>item.spawnOffset<=spec.spawnOffset).sort((a,b)=>b.spawnOffset-a.spawnOffset)[0]||out[0];
 spec.group=preceding.group;spec.phase=preceding.phase;
 out.push(spec);
}
function initialiseCombatEnemy(e,item) {
 e.assaultPhase=item.phase||1;state.assaultPhase=Math.max(state.assaultPhase||0,e.assaultPhase);
 if(state.mode!=='campaign')return;
 e.formation=item.formation||0;e.groupSpeed=item.groupSpeed||0;e.speed=plannedUnitSpeed(item);
 if(e.type==='boss') {
  e.bossKind=commanderKind(state.sectorId);
  if(e.bossKind>=0)e.armor=BOSS_KINDS[e.bossKind].armor;
  else e.armor=Math.min(10,4+Math.floor(state.sectorId/3));
  e.commander={seed:freshCommanderSeed(),nextAt:state.time+2.5,cast:null,armorUntil:0,repairUntil:0,healSpent:0,landed:0};
 }
}
function freshCommanderSeed() {
 if(globalThis.crypto?.getRandomValues)return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
 return Math.floor(Math.random()*4294967296)>>>0;
}
function commanderRandom(boss) {
 const data=boss.commander;
 data.seed=(Math.imul(data.seed,1664525)+1013904223)>>>0;
 return data.seed/4294967296;
}
function commanderSkill(boss) {
 const available=COMMANDER_SKILLS.filter(kind=>canCommanderCast(boss,kind));
 return available[Math.floor(commanderRandom(boss)*available.length)];
}
function inCommanderRange(owner,target) {return target.hp>0&&Math.hypot(owner.x-target.x,owner.y-target.y)<=COMMANDER_RADIUS;}
function healCombatEnemy(target,amount) {
 if(target.type==='boss'&&target.commander)amount=Math.min(amount,target.maxHp*.24-target.commander.healSpent);
 const gained=Math.max(0,Math.min(amount,target.maxHp-target.hp));
 target.hp+=gained;
 if(target.type==='boss'&&target.commander)target.commander.healSpent+=gained;
 if(gained)target.repairedUntil=state.time+.25;
 return gained;
}
function deployCommanderMinions(boss) {
 const data=boss.commander,alive=state.enemies.filter(e=>e.hp>0&&e.summonedBossId===boss.id).length;
 const amount=Math.min((state.sectorId<4?2:3)+(state.sectorId>=14?1:0),6-alive,24-data.landed);
 for(let i=0;i<amount;i++) {
  const type=state.sectorId>=4&&i===0?'drone':'swarm';
  spawnReinforcement(boss,type);
  const e=state.enemies.at(-1);e.summonedBossId=boss.id;e.bounty=0;
  e.hp=e.maxHp=Math.round((type==='drone'?60:40)+state.sectorId*2);
  e.distance=Math.max(0,e.distance-i*CELL*.55);Object.assign(e,pointOnPath(e.distance,e.route,isAirUnit(e)));
  ring(e.x,e.y,'#ffd298',27,.6,'shield');data.landed++;
 }
}
function sabotageCandidates(boss) {
 if(state.towers.some(t=>t.disabled)||state.bossShots.length)return [];
 const dx=Math.cos(boss.angle),dy=Math.sin(boss.angle);
 return state.towers.filter(t=>!t.disabled&&Math.hypot(t.x-boss.x,t.y-boss.y)<=6*CELL&&(t.x-boss.x)*dx+(t.y-boss.y)*dy>1e-6);
}
function sabotageTarget(boss) {
 const candidates=sabotageCandidates(boss);
 return candidates.length?candidates[Math.floor(commanderRandom(boss)*candidates.length)]:null;
}
function canCommanderCast(boss,kind) {
 if(kind==='sabotage')return sabotageCandidates(boss).length>0;
 if(kind==='repair')return boss.commander.healSpent<boss.maxHp*.24||state.enemies.some(e=>e!==boss&&e.hp<e.maxHp&&inCommanderRange(boss,e));
 if(kind==='landing')return boss.commander.landed<24&&state.enemies.filter(e=>e.hp>0&&e.summonedBossId===boss.id).length<6;
 return kind==='armor';
}
function beginCommanderCast(boss,kind) {
 if(!canCommanderCast(boss,kind))return false;
 const target=kind==='sabotage'?sabotageTarget(boss):null;
 boss.commander.cast={kind,startedAt:state.time,finishAt:state.time+(kind==='sabotage'?1.7:1),targetId:target?.id||0};
 if(kind==='sabotage'){announce('Босс наводится на башню. ЭМИ сорвёт выстрел.');notify('Диверсия! Босс наводится на '+TOWERS[target.type].name);}
 return true;
}
function finishCommanderCast(boss,cast) {
 const data=boss.commander;
 if(cast.kind==='landing')deployCommanderMinions(boss);
 if(cast.kind==='armor'){data.armorUntil=state.time+6;ring(boss.x,boss.y,'#8ebdff',COMMANDER_RADIUS,.9,'shield');}
 if(cast.kind==='repair'){data.repairUntil=state.time+4;ring(boss.x,boss.y,'#a5ffb0',COMMANDER_RADIUS,.9,'shield');}
 if(cast.kind==='sabotage') {
  const target=state.towers.find(t=>t.id===cast.targetId);
  if(target&&sabotageCandidates(boss).includes(target)) {
   state.bossShots.push({bossId:boss.id,targetId:target.id,x:boss.x,y:boss.y,startedAt:state.time,impactAt:state.time+.65});
   burst(boss.x,boss.y,'#ffd1ee',16);beep(170,.15,.04,'sawtooth');
  }
 }
 data.cast=null;data.nextAt=state.time+8+commanderRandom(boss)*5;
 uiDirty=true;
}
function tickCombatSupport(dt) {
 tickTowerRepair(dt);
 if(state.mode!=='campaign'||state.phase!=='wave')return;
 for(const e of state.enemies)e.bossArmor=0;
 const heals=new Map();
 const addHeal=(e,amount)=>heals.set(e,Math.max(heals.get(e)||0,amount));
 for(const e of [...state.enemies]) {
  if(e.hp<=0||e.stunUntil>state.time) {
   if(e.commander?.cast){e.commander.cast=null;e.commander.nextAt=Math.max(e.commander.nextAt,state.time+4);}
   continue;
  }
  if(e.type==='medic')for(const other of state.enemies)if(other.id!==e.id&&other.type!=='medic'&&!isAirUnit(other)&&other.hp>0&&Math.hypot(other.x-e.x,other.y-e.y)<=125)addHeal(other,other.maxHp*.055*dt);
  if(!e.commander)continue;
  const data=e.commander;
  if(data.cast&&state.time>=data.cast.finishAt)finishCommanderCast(e,data.cast);
  if(!data.cast&&state.time>=data.nextAt) {
   const skill=commanderSkill(e);
   if(!beginCommanderCast(e,skill))data.nextAt=state.time+2;
  }
  for(const other of state.enemies)if(inCommanderRange(e,other)) {
   if(data.armorUntil>state.time)other.bossArmor=Math.max(other.bossArmor,4+Math.floor(state.sectorId/3));
   if(data.repairUntil>state.time)addHeal(other,other.maxHp*(other===e?.025:.055)*dt);
  }
 }
 for(const [e,amount]of heals)healCombatEnemy(e,amount);
 state.bossShots=state.bossShots.filter(shot=>{
  if(state.time<shot.impactAt)return true;
  const t=state.towers.find(t=>t.id===shot.targetId);
  if(t&&!t.disabled&&!state.towers.some(t=>t.disabled))disableCombatTower(t);
  return false;
 });
}
function disableCombatTower(t) {
 t.disabled=true;t.repairProgress=0;t.cooldown=Math.max(.3,t.cooldown);
 FX.sabotageHits.push({x:t.x,y:t.y,at:state.time});
 burst(t.x,t.y,'#ffbe8d',36);ring(t.x,t.y,'#ff6b91',68,.85,'shield');
 if(fullEffects&&!REDUCED_MOTION)FX.shake=Math.max(FX.shake,3);
 notify(TOWERS[t.type].name+' отключена. Удерживай башню 2 секунды для ремонта.');
 saveProgress();uiDirty=true;
}
function combatShieldFactor(e) {
 if(state.mode!=='campaign')return 1;
 return state.enemies.some(other=>other.hp>0&&other.stunUntil<=state.time&&other.id!==e.id&&other.type==='guardian'&&Math.hypot(other.x-e.x,other.y-e.y)<=125)?.7:1;
}
function advanceCombatEnemy(e,dt,factor) {
 let next=e.distance+e.speed*factor*dt;
 if(e.formation&&e.groupSpeed) {
  const group=state.enemies.filter(other=>other.hp>0&&other.formation===e.formation&&other.route===e.route);
  if(group.length>1)next=Math.min(next,Math.min(...group.map(other=>other.distance))+CELL*2.2);
 }
 e.distance=Math.max(e.distance,next);
}
function beginTowerRepair(t,pointerId=null) {
 if(!t?.disabled||!sessionStarted||paused||anyDialogOpen()||!['wave','build'].includes(state.phase))return false;
 endCameraGesture();closeContextPanel();selectedType=null;selectedId=t.id;hover=null;
 repairHold={towerId:t.id,pointerId};if(pointerId!==null)repairPointers.add(pointerId);
 uiDirty=true;return true;
}
function stopTowerRepair(save=true) {
 if(!repairHold)return;
 repairHold=null;uiDirty=true;if(save)saveProgress();
}
function tickTowerRepair(dt) {
 if(!repairHold)return;
 const t=state.towers.find(t=>t.id===repairHold.towerId);
 if(!sessionStarted||paused||anyDialogOpen()||!t?.disabled){stopTowerRepair(false);return;}
 t.repairProgress=Math.min(REPAIR_SECONDS,(t.repairProgress||0)+dt/Math.max(1,speed));
 if(fullEffects&&Math.floor(state.time*18)!==t.repairSpark){t.repairSpark=Math.floor(state.time*18);burst(t.x+(fxNoise(state.time)*2-1)*16,t.y-8,'#c0ffe3',2);}
 if(t.repairProgress+1e-8>=REPAIR_SECONDS) {
  t.disabled=false;t.repairProgress=0;delete t.repairGraceUntil;t.cooldown=.25;
  repairHold=null;burst(t.x,t.y,'#aeffcf',24);ring(t.x,t.y,'#aeffcf',48,.6,'shield');
  notify(TOWERS[t.type].name+' отремонтирована');saveProgress();uiDirty=true;
 }
}
function initCombatInput() {
 canvas.addEventListener('pointerdown',event=>{
  if(repairPointers.size){
   repairPointers.add(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
   try{canvas.setPointerCapture(event.pointerId);}catch(_e){}
   return;
  }
  if(event.button!==0||abilityAim||repairHold)return;
  const cell=cellFromEvent(event),tower=cell&&towerAt(cell.c,cell.r);
  if(!beginTowerRepair(tower,event.pointerId))return;
  event.preventDefault();event.stopImmediatePropagation();
  try{canvas.setPointerCapture(event.pointerId);}catch(_e){}
 },true);
 canvas.addEventListener('pointermove',event=>{
  if(!repairPointers.has(event.pointerId))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(repairHold){const cell=cellFromEvent(event),t=state.towers.find(t=>t.id===repairHold.towerId);if(!cell||cell.c!==t?.c||cell.r!==t?.r)stopTowerRepair();}
 },true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{
  if(!repairPointers.has(event.pointerId))return;
  event.preventDefault();event.stopImmediatePropagation();repairPointers.delete(event.pointerId);
  if(repairHold?.pointerId===event.pointerId)stopTowerRepair();blockCameraClick();
 },true);
 window.addEventListener('blur',()=>{stopTowerRepair();repairPointers.clear();});
 document.addEventListener('keydown',event=>{
  if(event.code==='KeyF'&&!event.repeat&&beginTowerRepair(selectedTower()))event.preventDefault();
 });
 document.addEventListener('keyup',event=>{if(event.code==='KeyF'&&repairHold?.pointerId===null)stopTowerRepair();});
}
function paintRepairAlert(t,g=ctx) {
 if(!t.disabled)return;
 const held=repairHold?.towerId===t.id,progress=(t.repairProgress||0)/REPAIR_SECONDS;
 const pulse=REDUCED_MOTION?1:.65+.35*Math.sin(state.time*6);
 g.save();g.translate(t.x,t.y);if(VIEW.rotated)g.rotate(-Math.PI/2);
 g.strokeStyle=held?'#b4ffda':'#ff7b9b';g.fillStyle=held?'#163e36ed':'#401d32ed';g.lineWidth=2;
 g.shadowColor=held?'#75ffc7':'#ff4e83';g.shadowBlur=fullEffects?10+pulse*9:0;
 g.beginPath();g.arc(0,0,29,0,Math.PI*2);g.stroke();g.shadowBlur=0;
 g.globalAlpha=.85;g.fillRect(-27,-42,54,19);g.strokeRect(-27,-42,54,19);g.globalAlpha=1;
 g.font='bold 9px system-ui';g.textAlign='center';g.fillStyle=held?'#cbffe3':'#ffd1df';g.fillText(held?'РЕМОНТ':'РЕМОНТ !',0,-29);
 // A solid wrench, rather than a small generic warning icon.
 g.save();g.translate(0,0);g.rotate(-.65);g.fillStyle=held?'#bcffdc':'#ffc1d3';g.fillRect(-3,-2,6,17);
 g.beginPath();g.arc(0,-5,8,.4,Math.PI*2-.4);g.lineTo(4,-5);g.lineTo(0,-2);g.lineTo(-4,-5);g.closePath();g.fill();g.restore();
 g.lineWidth=4;g.strokeStyle='#0b1923';g.beginPath();g.arc(0,0,34,-Math.PI/2,Math.PI*1.5);g.stroke();
 if(progress){g.strokeStyle='#a6ffd0';g.beginPath();g.arc(0,0,34,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);g.stroke();}
 if(held){g.fillStyle='#c9ffe0';g.font='bold 9px system-ui';g.fillText(Math.round(progress*100)+'%',0,48);}
 else {g.fillStyle='#ffe5b8';g.globalAlpha=pulse;g.beginPath();g.moveTo(0,-50);g.lineTo(-5,-57);g.lineTo(5,-57);g.closePath();g.fill();}
 g.restore();
}
function paintCommanderGround() {
 if(state.mode!=='campaign')return;
 for(const e of state.enemies) {
  if(e.hp<=0)continue;
  const radius=e.type==='guardian'?125:e.commander&&(e.commander.armorUntil>state.time||e.commander.repairUntil>state.time)?COMMANDER_RADIUS:0;
  if(!radius||e.stunUntil>state.time)continue;
  const green=e.commander?.repairUntil>state.time,color=green?'#a5ffbd':'#8cbdff';
  ctx.save();ctx.strokeStyle=color+'75';ctx.fillStyle=color+'08';ctx.lineWidth=1.5;ctx.setLineDash([7,9]);ctx.lineDashOffset=-state.time*14;
  ctx.beginPath();ctx.arc(e.x,e.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
  if(fullEffects&&e.commander)for(const other of state.enemies)if(other!==e&&inCommanderRange(e,other)){ctx.strokeStyle=color+'33';ctx.beginPath();ctx.moveTo(e.x,e.y);ctx.lineTo(other.x,other.y);ctx.stroke();}
  ctx.restore();
 }
}
function paintCommanderEffects() {
 const bolt=(x,y,tx,ty,phase,color,width)=>{
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);
  const dx=tx-x,dy=ty-y,len=Math.hypot(dx,dy)||1;
  for(let i=1;i<=18;i++){const f=i/18,jitter=i===18?0:Math.sin(i*19.7+phase*45)*(fullEffects?5:2);ctx.lineTo(x+dx*f-dy/len*jitter,y+dy*f+dx/len*jitter);}
  ctx.stroke();
 };
 ctx.save();
 for(const e of state.enemies)if(e.hp>0&&e.commander?.cast) {
  const cast=e.commander.cast,p=clamp((state.time-cast.startedAt)/(cast.finishAt-cast.startedAt),0,1),color={landing:'#ffc680',armor:'#92bcff',repair:'#a5ffbd',sabotage:'#ff89b9'}[cast.kind];
  ctx.strokeStyle=color;ctx.fillStyle=color+'44';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(e.x,e.y,19+p*17,-state.time*3,Math.PI*1.5-state.time*3);ctx.stroke();
  ctx.save();ctx.translate(e.x,e.y);if(VIEW.rotated)ctx.rotate(-Math.PI/2);ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.fillStyle=color;ctx.strokeStyle='#101e2d';ctx.lineWidth=3;ctx.strokeText(COMMANDER_NAMES[cast.kind],0,48);ctx.fillText(COMMANDER_NAMES[cast.kind],0,48);ctx.restore();
  if(cast.kind==='sabotage') {
   const t=state.towers.find(t=>t.id===cast.targetId);if(!t)continue;
   ctx.strokeStyle='#ff86b880';ctx.setLineDash([4,7]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(e.x,e.y);ctx.lineTo(t.x,t.y);ctx.stroke();ctx.setLineDash([]);
   ctx.strokeStyle='#ff8da9';ctx.lineWidth=2;ctx.beginPath();ctx.arc(t.x,t.y,25+6*(1-p),state.time*2,state.time*2+Math.PI*1.6);ctx.stroke();
   for(let i=0;i<4;i++){const a=i*Math.PI/2+state.time;ctx.beginPath();ctx.moveTo(t.x+Math.cos(a)*39,t.y+Math.sin(a)*39);ctx.lineTo(t.x+Math.cos(a)*29,t.y+Math.sin(a)*29);ctx.stroke();}
   ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowColor='#ff5ba0';ctx.shadowBlur=16;ctx.fillStyle='#fff0f6';ctx.beginPath();ctx.arc(e.x,e.y,3+p*7,0,Math.PI*2);ctx.fill();ctx.restore();
  }
 }
 for(const shot of state.bossShots) {
  const t=state.towers.find(t=>t.id===shot.targetId);if(!t)continue;
  const p=clamp((state.time-shot.startedAt)/(shot.impactAt-shot.startedAt),0,1),x=shot.x+(t.x-shot.x)*p,y=shot.y+(t.y-shot.y)*p-Math.sin(p*Math.PI)*35;
  ctx.save();ctx.globalCompositeOperation='lighter';bolt(shot.x,shot.y,x,y,p,'#ff4e951e',13);bolt(shot.x,shot.y,x,y,p,'#ff76b4aa',5);bolt(shot.x,shot.y,x,y,p,'#fff0fc',1.5);
  ctx.fillStyle='#fff1db';ctx.shadowColor='#ff6da7';ctx.shadowBlur=20;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 FX.sabotageHits=FX.sabotageHits.filter(hit=>state.time-hit.at<1.1);
 for(const hit of FX.sabotageHits) {
  const age=state.time-hit.at;ctx.save();ctx.globalAlpha=1-age/1.1;ctx.strokeStyle='#ff8dad';ctx.lineWidth=4*(1-age/1.1);ctx.beginPath();ctx.arc(hit.x,hit.y,10+age*70,0,Math.PI*2);ctx.stroke();
  for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;bolt(hit.x,hit.y,hit.x+Math.cos(angle)*(20+age*28),hit.y+Math.sin(angle)*(20+age*28),age+i,'#ffc5db',1);}
  ctx.restore();
 }
 ctx.restore();
}
function nextAttackForecast() {
 if(state.mode!=='campaign'||!sessionStarted||['win','lose'].includes(state.phase))return {items:[],label:''};
 const assault=state.difficulty>0;
 if(assault&&state.wave) {
  const next=state.queue[0];
  return {items:next?state.queue.filter(q=>q.group===next.group):[],label:'СЛЕДУЮЩИЙ ОТРЯД'};
 }
 if(!assault&&state.wave>=state.goalWaves)return {items:[],label:''};
 return {items:wavePlan(state.wave+1),label:assault?'ПЕРВЫЙ ОТРЯД':'ВОЛНА '+(state.wave+1)};
}
function paintAttackForecast() {
 const forecast=nextAttackForecast(),groups=new Map(),layer=$('attackMarkers');
 const items=forecastItems(forecast);
 for(const item of items) {
  const route=ROUTES[item.route],key=route.cells[0].join(',');
  if(!groups.has(key))groups.set(key,{route:item.route,items:[]});
  groups.get(key).items.push(item);
 }
 for(const button of [...layer.children])if(!groups.has(button.dataset.entry))button.remove();
 layer.hidden=!groups.size;
 if(!groups.size){closeEntryForecast();return;}
 const placed=[],origin=canvas.getBoundingClientRect();
 const hud=['topHud','bonusHud','cameraControls','battleSector'].map(id=>$(id).getBoundingClientRect()).filter(r=>r.width&&r.height);
 const top=Math.max(30,...hud.map(r=>r.bottom-origin.top+30));
 const bottom=Math.max(top,Math.min(VIEW.h-30,$('commandBar').getBoundingClientRect().top-origin.top-30));
 const offsets=[-104,-52,0,52,104].flatMap(dx=>[-104,-52,0,52,104].map(dy=>({dx,dy}))).sort((a,b)=>a.dx*a.dx+a.dy*a.dy-b.dx*b.dx-b.dy*b.dy);
 for(const [key,g] of groups) {
  const p=pointOnRoute(ROUTES[g.route],CELL*.9),screen=worldToScreen(p.x,p.y);
  let x=clamp(screen.x,30,VIEW.w-30),y=clamp(screen.y,top,bottom);
  const free=offsets.map(({dx,dy})=>({x:clamp(x+dx,30,VIEW.w-30),y:clamp(y+dy,top,bottom)})).find(p=>placed.every(other=>Math.hypot(other.x-p.x,other.y-p.y)>=52));
  if(free){x=free.x;y=free.y;}
  placed.push({x,y});
  let button=[...layer.children].find(el=>el.dataset.entry===key);
  if(!button){button=document.createElement('button');button.type='button';button.className='attack-marker';button.dataset.entry=key;button.setAttribute('aria-controls','entryForecastPopover');button.setAttribute('aria-expanded','false');button.innerHTML='<span aria-hidden="true"></span>';button.addEventListener('click',()=>showEntryForecast(key));layer.append(button);}
  const clock=attackForecastClock(g.items);
  button.style.left=x+'px';button.style.top=y+'px';button.style.setProperty('--remaining',(360*clock.progress).toFixed(2)+'deg');
  button.classList.toggle('boss-warning',g.items.some(item=>item.type==='boss'));
  button.classList.toggle('waiting',clock.waiting);
  button.firstElementChild.textContent=state.difficulty>0?'›':String(state.wave+1).padStart(2,'0');
  button.setAttribute('aria-label',forecast.label+'. '+ROUTES[g.route].name+'. '+clock.label+'. Нажми, чтобы узнать состав.');
 }
 refreshEntryForecast(forecast,groups.get(ENTRY_FORECAST.key)?.items||[]);
}
function forecastItems(forecast=nextAttackForecast()){
 return state.difficulty>0&&!state.wave?forecast.items.filter(q=>q.group===forecast.items[0]?.group):forecast.items;
}
function attackForecastClock(items){
 if(!state.wave)return {progress:1,waiting:false,label:'Запуск по команде'};
 if(state.difficulty>0){
  const end=Math.max(...items.map(item=>item.spawnAt)),plan=wavePlan(1),first=plan.find(item=>item.group===items[0]?.group);
  const start=(state.waveClock?.openedAt||0)+.3+(first?.spawnOffset||0),left=Math.max(0,end-state.time);
  return {progress:clamp(left/Math.max(.001,end-start),0,1),waiting:false,label:'Выход отряда: '+Math.ceil(left)+' с'};
 }
 const clock=state.waveClock;if(!clock)return {progress:1,waiting:false,label:'Подготовка волны'};
 const deadline=clock.dueAt??clock.bonusDeadline,left=Math.max(0,deadline-state.time),waiting=left===0&&state.waves.length>=MAX_ACTIVE_WAVES;
 return {progress:clamp(left/Math.max(.001,deadline-clock.openedAt),0,1),waiting,label:waiting?'Ожидает свободное место среди двух волн':'До автозапуска: '+Math.ceil(left)+' с'};
}
function showEntryForecast(key){
 const forecast=nextAttackForecast(),items=forecastItems(forecast).filter(item=>ROUTES[item.route].cells[0].join(',')===key);
 if(!items.length||anyDialogOpen()||battleResultPending())return;
 if(ENTRY_FORECAST.run===state&&ENTRY_FORECAST.key===key&&!$('entryForecastPopover').hidden){closeEntryForecast();return;}
 closeEntryForecast();ENTRY_FORECAST.run=state;ENTRY_FORECAST.key=key;ENTRY_FORECAST.stamp=entryForecastStamp(forecast);
 $('entryForecastPopover').hidden=false;refreshEntryForecast(forecast,items);
}
function entryForecastStamp(forecast){return state.wave+'/'+forecast.label+'/'+(state.difficulty>0?forecast.items[0]?.group:'wave');}
function closeEntryForecast(){
 ENTRY_FORECAST.run=null;ENTRY_FORECAST.key=null;ENTRY_FORECAST.stamp='';
 const pop=$('entryForecastPopover');pop.hidden=true;delete pop.dataset.roster;
 for(const button of $('attackMarkers').children)button.setAttribute('aria-expanded','false');
}
function refreshEntryForecast(forecast,items){
 const pop=$('entryForecastPopover');if(pop.hidden)return;
 const button=[...$('attackMarkers').children].find(el=>el.dataset.entry===ENTRY_FORECAST.key);
 if(ENTRY_FORECAST.run!==state||!button||!items.length||anyDialogOpen()||entryForecastStamp(forecast)!==ENTRY_FORECAST.stamp){closeEntryForecast();return;}
 const types=[...new Set(items.map(item=>item.type))],counts=types.map(type=>items.filter(item=>item.type===type).length),roster=types.map((type,i)=>type+':'+counts[i]).join('/');
 if(pop.dataset.roster!==roster){
  pop.dataset.roster=roster;$('entryForecastTypes').style.setProperty('--columns',Math.min(4,types.length));
  $('entryForecastTypes').innerHTML=types.map((type,i)=>'<span class="entry-forecast-unit" style="--unit-color:'+ENEMIES[type].color+'" role="img" aria-label="'+ENEMIES[type].name+': '+counts[i]+'" title="'+ENEMIES[type].name+'">'+unitIcon(type)+'<b>×'+counts[i]+'</b></span>').join('');
 }
 button.setAttribute('aria-expanded','true');positionEntryForecast(button);
}
function positionEntryForecast(button){
 const pop=$('entryForecastPopover'),a=button.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,gap=8;
 const obstacles=['topHud','bonusHud','cameraControls','battleSector','commandBar'].map(id=>$(id).getBoundingClientRect()).filter(r=>r.width&&r.height);
 obstacles.push(...[...$('attackMarkers').children].map(el=>el.getBoundingClientRect()));
 const overlap=(p,r)=>Math.max(0,Math.min(p.x+w,r.right)-Math.max(p.x,r.left))*Math.max(0,Math.min(p.y+h,r.bottom)-Math.max(p.y,r.top));
 const options=[{x:(a.left+a.right-w)/2,y:a.top-h-gap},{x:(a.left+a.right-w)/2,y:a.bottom+gap},{x:a.right+gap,y:(a.top+a.bottom-h)/2},{x:a.left-w-gap,y:(a.top+a.bottom-h)/2}].map(p=>({x:clamp(p.x,8,Math.max(8,innerWidth-w-8)),y:clamp(p.y,8,Math.max(8,innerHeight-h-8))}));
 options.sort((p,q)=>obstacles.reduce((sum,r)=>sum+overlap(p,r)-overlap(q,r),0));
 pop.style.left=Math.round(options[0].x)+'px';pop.style.top=Math.round(options[0].y)+'px';
}
function validateCombatState(run) {
 const finite=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isFinite(n)&&n>=min&&n<=max;
 if(!Array.isArray(run.bossShots)||run.bossShots.length>1||run.towers.filter(t=>t.disabled).length>1)return false;
 for(const t of run.towers)if(t.disabled!==undefined&&typeof t.disabled!=='boolean'||t.repairProgress!==undefined&&!finite(t.repairProgress,0,REPAIR_SECONDS)||t.repairGraceUntil!==undefined&&!finite(t.repairGraceUntil))return false;
 for(const shot of run.bossShots)if(!shot||!Number.isSafeInteger(shot.targetId)||!finite(shot.x,-100,WIDTH+100)||!finite(shot.y,-100,HEIGHT+100)||!finite(shot.startedAt,0,run.time)||!finite(shot.impactAt,shot.startedAt,shot.startedAt+1))return false;
 for(const item of run.queue)if(item.hpScale!==undefined&&!finite(item.hpScale,.4,1)||item.groupSpeed!==undefined&&!finite(item.groupSpeed,0,112))return false;
 for(const e of run.enemies) {
  if(e.bossArmor!==undefined&&!finite(e.bossArmor,0,20))return false;
  if(!e.commander)continue;
  const d=e.commander;
  if(!Number.isInteger(d.seed)||!finite(d.seed,0,4294967295)||d.bag!==undefined&&(!Array.isArray(d.bag)||d.bag.length>4||new Set(d.bag).size!==d.bag.length||d.bag.some(k=>!COMMANDER_SKILLS.includes(k)))||!finite(d.nextAt)||!finite(d.armorUntil)||!finite(d.repairUntil)||!finite(d.healSpent,0,e.maxHp*.240001)||!Number.isInteger(d.landed)||!finite(d.landed,0,24))return false;
  if(d.cast&&(!COMMANDER_SKILLS.includes(d.cast.kind)||!finite(d.cast.startedAt,0,run.time)||!finite(d.cast.finishAt,d.cast.startedAt,d.cast.startedAt+2)||!Number.isSafeInteger(d.cast.targetId)))return false;
 }
 return true;
}
