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
 if(e.blockedBy)return;
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

// Campaign revision 1.030.09. Prices, progression and road families are explicit
// so extending a mission never silently dilutes its per-enemy income.
const FRONTIER_UPGRADES={pulse:[80,130,210],garrison:[90,140,230],rail:[120,180,280],cannon:[140,220,300],frost:[100,150,240]};
const FRONTIER_SKILLS={pulse:['Сервоприводы','Урон +15%, скорость огня +8%'],rail:['Сверхпроводник','Урон +22%'],cannon:['Термобарический заряд','Урон +16%, радиус +10%'],frost:['Криоконтур','Длительность +35%, дальность +10%'],garrison:['Боевой комплект','Прочность +30%, урон +20%']};
const FRONTIER_MAP_NAMES={serpentine:'Серпантин',funnel:'Воронка',island:'Центральный остров',multiline:'Мосты и фланги'};
let rallyTargetId=null;
function spriteAtlas(s){return s.atlas==='troops'?ART.garrisonAnimation:s.atlas==='frontier'?ART.frontierAtlas:s.atlas==='air'?ART.airAtlas:ART.atlas;}
function initFrontierRevision(){
 Object.defineProperty(TOWERS.rail,'cost',{get(){return state.mode==='campaign'?100:180;},enumerable:true,configurable:true});
 const extra={
  spider:{name:'Пауки-разведчики',hp:44,speed:94,reward:3,armor:0,damage:1,color:'#efb272',radius:8},
  buggy:{name:'Рейдеры',hp:95,speed:102,reward:7,armor:2,damage:1,color:'#ed8c80',radius:10},
  tank:{name:'Гусеничные танки',hp:440,speed:39,reward:18,armor:12,damage:3,color:'#bc9fe9',radius:15},
  hover:{name:'Парящие броневики',hp:260,speed:58,reward:12,armor:5,damage:2,color:'#8de4e1',radius:13},
  walker:{name:'Осадные шагоходы',hp:720,speed:33,reward:27,armor:15,damage:4,color:'#becb87',radius:17},
  shieldbot:{name:'Энергощиты',hp:310,speed:49,reward:15,armor:1,damage:2,color:'#c6a6ff',radius:12},
  repairbot:{name:'Ремонтные краулеры',hp:330,speed:44,reward:18,armor:3,damage:2,color:'#9fd991',radius:12},
  transport:{name:'Десантные транспорты',hp:480,speed:40,reward:21,armor:8,damage:3,color:'#ecaaa0',radius:15}
 };
 for(const [type,def]of Object.entries(extra))ENEMIES[type]={symbol:'◆',...def};
 const rally=document.createElement('button');rally.id='garrisonRally';rally.textContent='Точка сбора';rally.hidden=true;
 rally.addEventListener('click',()=>{const t=selectedTower();if(!t||t.type!=='garrison'||paused)return;const id=t.id;closeContextPanel();rallyTargetId=id;notify('Укажи дорогу в радиусе гарнизона. Esc — отмена.');});
 $('selectionActions').append(rally);
 const skill=document.createElement('button');skill.id='towerSkill';skill.hidden=true;skill.addEventListener('click',buyTowerSkill);$('selectionActions').append(skill);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&rallyTargetId!==null){rallyTargetId=null;uiDirty=true;}if(e.key==='5'&&sessionStarted&&!paused&&!anyDialogOpen()&&!['INPUT','TEXTAREA'].includes(e.target?.tagName)){chooseType('garrison');e.preventDefault();}});
 for(let id=0;id<SECTOR_COUNT;id++)CAMPAIGN_ROAD_COUNTS[id]=new Set(baseSectorBlueprint(id).raw.map(r=>r.cells[0].join(','))).size;
 const oldRefresh=refreshProgressionUI;
 refreshProgressionUI=function(){oldRefresh();refreshFrontierSelection();};
 // Endless keeps its established price, combat stats and tier-III branches.
 const oldStats=towerStats;
 towerStats=function(t){
  if(state.mode!=='campaign'){
   const result=oldStats(t);if(t.type==='rail')result.damage=Math.round(result.damage*100/49);return result;
  }
  const d={...TOWERS[t.type],...(t.type==='pulse'?{damage:11,rate:.55}:t.type==='cannon'?{rate:2.4}:{})},level=t.level-1,s={...d,damage:d.damage*Math.pow(1.9,level),rate:d.rate*Math.pow(.96,level),range:d.range+level*10,slow:d.slow?Math.max(.34,d.slow-.035*level):null,slowDuration:1.8};
  if(t.branch==='rapid'){s.rate*=.52;s.damage*=.85;}
  if(t.branch==='piercer'){s.damage*=1.45;s.rate*=1.12;s.pierce=true;}
  if(t.branch==='blast'){s.splash*=1.55;s.damage*=.85;}
  if(t.branch==='scorch'){s.scorch=true;s.damage*=.65;s.splash*=.85;s.rate*=1.1;s.scorchDuration=3;}
  if(t.branch==='permafrost'){s.slow=.24;s.slowDuration=3;s.damage*=.85;}
  if(t.branch==='blizzard'){s.splash=60;s.slow=.62;s.slowDuration=1.6;}
  if(t.branch==='sniper'){s.damage*=1.75;s.range+=48;s.rate*=1.2;}
  if(t.branch==='chain')s.chain=true;
  s.damage*=1+.12*perkRank('reactor');s.range*=1+.08*perkRank('optics');s.rate/=1+.1*perkRank('loader');
  if(s.splash)s.splash*=1+.15*perkRank('blast');s.slowDuration*=1+.25*perkRank('cryo');
  if(t.skillRank){s.damage*=t.type==='rail'?1.22:1.16;if(t.type==='pulse')s.rate*=.92;if(t.type==='cannon')s.splash*=1.1;if(t.type==='frost'){s.range*=1.1;s.slowDuration*=1.35;}}
  s.damage=Math.round(s.damage);if(s.scorch)s.scorchDps=Math.round(s.damage/.65*.4);return s;
 };
 const oldInteract=interactCell;interactCell=function(c,r){if(rallyTargetId!==null){setGarrisonRally({x:(c+.5)*CELL,y:(r+.5)*CELL,inside:true});return;}oldInteract(c,r);};
 const oldStart=startBattle;startBattle=function(...args){rallyTargetId=null;oldStart(...args);};
 const oldDamage=damageEnemy;
 damageEnemy=function(e,amount,pierce=false){
  if(state.mode==='campaign'&&e.type==='shieldbot'&&pierce)amount*=.6;
  oldDamage(e,amount,pierce);
 };
 const oldFire=fire;fire=function(t,target){if(t.type==='garrison')return;oldFire(t,target);};
 const oldDestroy=enemyDestroyed;enemyDestroyed=function(e){oldDestroy(e);if(e.type==='transport'&&state.mode==='campaign'&&!e.summonedBossId){for(let i=0;i<2;i++)spawnReinforcement(e,'spider');}};
 const oldSupport=tickCombatSupport;
 tickCombatSupport=function(dt){
  oldSupport(dt);
  for(const e of state.enemies)if(e.hp>0&&e.type==='repairbot'&&e.stunUntil<=state.time){for(const other of state.enemies)if(other.hp>0&&other.type!=='boss'&&Math.hypot(other.x-e.x,other.y-e.y)<115)healCombatEnemy(other,other.maxHp*.025*dt);}
 };
 const oldShield=combatShieldFactor;
 combatShieldFactor=function(e){const factor=oldShield(e);return state.enemies.some(o=>o.hp>0&&o.id!==e.id&&o.type==='shieldbot'&&o.stunUntil<=state.time&&Math.hypot(o.x-e.x,o.y-e.y)<100)?Math.min(factor,.85):factor;};
}
function upgradeCost(t){return state.mode==='campaign'?(FRONTIER_UPGRADES[t.type][t.level-1]??Infinity):Math.round((t.type==='rail'?180:TOWERS[t.type].cost)*(t.level===1?.9:1.4));}
function campaignOpeningBudget(id,difficulty=0){return 190+Math.floor(id/7)*35+(CAMPAIGN_ROAD_COUNTS[id]>=3?30:0)+difficulty*20;}
function sectorInfo(id){const biome=Math.min(3,Math.floor(id/7));return {id,name:SECTOR_NAMES[id],biome,routes:CAMPAIGN_ROAD_COUNTS[id],waves:id<7?[10,12,14,16,18,20,20][id]:20,budget:campaignOpeningBudget(id)};}
function captureArsenal(){
 const progress=standardProgress(),types={pulse:true,cannon:true,garrison:true,rail:progress>=1,frost:progress>=2},caps={};
 const specialties={pulse:5,garrison:5,rail:7,cannon:7,frost:9};
 for(const type of Object.keys(TOWERS)){if(testModeActive){types[type]=true;caps[type]=4;}else caps[type]=types[type]?(progress>=specialties[type]?4:progress>=2?3:progress>=1?2:1):0;}
 return {progress,types,caps};
}
function arsenalDescription(a=captureArsenal()){return Object.keys(TOWERS).filter(t=>a.types[t]).map(t=>TOWERS[t].name+' '+['','I','II','III','IV'][a.caps[t]]).join(' · ');}
function campaignWaveBonus(){return 0;}
function campaignRewardText(type,elite=false){return String(campaignBounty(type,elite));}
function planCampaignAttack(wave){return rawCampaignAttack(wave);}
function earlyRewardCap(n){
 if(state.wave===0||n===1)return 0;
 const budget=wavePlan(n).reduce((sum,e)=>sum+campaignBounty(e.type,e.elite),0);
 return state.mode==='campaign'?Math.min(65,12+Math.round(budget*.14)):20+n*2+Math.round(budget*.18);
}
function activeAssaultPhase(){return Math.min(20,Math.max(1,state.assaultPhase||1));}
function bossHealthForSector(id){return commanderKind(id)<0?1100+id*145:[2200,5000,7500,10000][commanderKind(id)];}
function rawCampaignAttack(wave){
 const m=missionInfo(state.sectorId,state.difficulty),out=[],entries=battleEntryGroups(),chunks=m.assault?20:1;
 let offset=0,group=0;
 for(let chunk=0;chunk<chunks;chunk++){
  const p=m.assault?chunk/19:(wave-1)/Math.max(1,m.waves-1),phase=m.assault?chunk+1:wave;
  const biome=m.biome,stage=m.id+(m.difficulty===1?2:m.difficulty===2?5:0);
  const swarms=['swarm','spider','spider','swarm'],lights=['scout','buggy','scout','buggy'],heavies=['armor','tank','hover','walker'];
  const count=Math.round((7+Math.floor(stage/4)+p*(12+stage*.32))*(m.assault?1+state.difficulty*.16:1));
  const fronts=p<.23?1:p<.55?Math.min(2,entries.length):entries.length;
  const support=p>.58&&stage>=7?(phase%3===0?(stage>=14?'repairbot':'medic'):'guardian'):null;
  const packet=4+Math.floor(p*3);
  for(let i=0;i<count;i++){
   if(i%packet===0)group++;
   const seed=i*17+phase*11+stage*7,entry=entries[(group-1+phase)%fronts],route=entry[(group+phase)%entry.length];
   let type=swarms[biome];
   if(p>.14&&seed%7<2)type=lights[biome];
   if(p>.38&&seed%9===3)type='runner';
   if(stage>=2&&p>.48&&(stage<7?seed%9===4:seed%5<(p>.7?2:1)))type=heavies[biome];
   if(stage>=5&&p>.35&&seed%11===1)type='drone';
   if(stage>=8&&p>.65&&seed%19===2)type='gunship';
   if(stage>=10&&p>.55&&seed%17===3)type='shieldbot';
   if(stage>=16&&p>.7&&seed%23===5)type='transport';
   if(support&&i===Math.floor(count*.6))type=support;
   const formation=wave*10000+group,elite=p>.7&&stage>=6&&seed%17===0;
   const groupSpeed=support&&!isAirUnit(type)?Math.min(ENEMIES[support].speed,ENEMIES[type].speed):0;
   out.push({type,elite,route,wave,group,formation,phase,groupSpeed,hpScale:.75+.25*p,spawnOffset:offset,gapAfter:.65,bounty:campaignBounty(type,elite)});
   offset+=Math.max(.38,.85-p*.25);
   if(i%packet===packet-1)offset+=2.1-p*.7;
  }
  if(m.assault)offset+=Math.max(1.2,5-p*3);
 }
 if(wave===m.waves)scheduleCommander(out,wave);
 return out.sort((a,b)=>a.spawnOffset-b.spawnOffset);
}
function baseSectorBlueprint(id){
 const family=id<3?'serpentine':['funnel','island','multiline'][(id-3)%3],v=Math.floor(id/3)%3;
 const a=6+2*v,b=14+2*(v%2),raw=[],anchors=[];
 const add=(cells,extra={})=>raw.push({cells,mapFamily:family,mapId:id,...extra});
 const at=(c,r,role='crossfire')=>anchors.push({c,r,role});
 if(family==='serpentine'){
  const far=18+2*(v%2);add([[-1,1],[far,1],[far,5],[a,5],[a,9],[22,9],[22,5],[23,5]]);at(a+2,7);at(far-2,3);
 }else if(family==='funnel'){
  add([[-1,1],[a,1],[a,5],[18,5],[23,5]]);
  add([[a,12],[a,9],[a+4,9],[a+4,5],[18,5],[23,5]]);
  if(id>=8&&id%2===0)add([[24,9],[18,9],[18,5],[23,5]]);
  at(a+2,3);at(a+2,7);at(17,7);
 }else if(family==='island'){
  const left=4,right=14+2*v;
  add([[-1,5],[left,5],[left,1],[right,1],[right,5],[23,5]],{fork:true,entryId:0});
  add([[-1,5],[left,5],[left,9],[right,9],[right,5],[23,5]],{fork:true,entryId:0});
  if(id>=10&&id%2===0)add([[24,11],[22,11],[22,5],[23,5]],{fork:true,entryId:1});
  at(9+v,3);at(9+v,7);at(right-2,5);
 }else{
  const suffix=[[18,5],[18,9],[22,9],[22,5],[23,5]];
  add([[-1,1],[a,1],[a,5],...suffix]);
  add([[-1,9],[a-2,9],[a-2,5],[a,5],...suffix]);
  if(id>=9&&id%2===1)add([[16,-1],[16,1],[a,1],[a,5],...suffix]);
  if(id%12===8){raw[0].fork=true;raw[0].entryId=0;raw[1].fork=true;raw[1].entryId=1;add([[-1,1],[a,1],[a,5],[a+4,5],[a+4,9],[22,9],[22,5],[23,5]],{fork:true,entryId:0});}
  at(a+2,3);at(12,7);at(20,7);
 }
 return {raw,anchors,name:FRONTIER_MAP_NAMES[family],note:'',doublePass:family==='serpentine',fork:raw.some(r=>r.fork),family};
}
function sectorBlueprint(id){
 const b=baseSectorBlueprint(id),reflect=id%2===1,flipY=id%4>=2;
 const raw=b.raw.map(r=>({...r,cells:r.cells.map(([x,y])=>[reflect?COLS-1-x:x,flipY?ROWS-1-y:y])}));
 return {...b,raw,anchors:b.anchors.map(a=>({...a,c:reflect?COLS-1-a.c:a.c,r:flipY?ROWS-1-a.r:a.r}))};
}
function paintMapWater(g,routes,biome){
 if(routes[0]?.mapFamily!=='multiline')return;
 g.fillStyle=biome===1?'#6590a6':'#123d4f';g.fillRect(11*CELL,0,2*CELL,HEIGHT);
 g.strokeStyle='#8bcce033';g.lineWidth=2;
 for(let y=12;y<HEIGHT;y+=21){g.beginPath();g.moveTo(11*CELL+8,y);g.lineTo(13*CELL-8,y+7);g.stroke();}
}
function paintMapBridges(g,routes){
 if(routes[0]?.mapFamily!=='multiline')return;
 const rows=new Set();for(const r of routes)for(const s of r.segments)if(s.a.y===s.b.y&&Math.min(s.a.x,s.b.x)<11*CELL&&Math.max(s.a.x,s.b.x)>13*CELL)rows.add(s.a.y);
 for(const y of rows){g.fillStyle='#6a7e84';g.fillRect(11*CELL-8,y-20,2*CELL+16,40);g.strokeStyle='#b8d0c9';g.lineWidth=3;for(const side of[-1,1]){g.beginPath();g.moveTo(11*CELL-8,y+side*22);g.lineTo(13*CELL+8,y+side*22);g.stroke();}g.strokeStyle='#1b2d34';g.lineWidth=2;for(let x=11*CELL;x<=13*CELL;x+=12){g.beginPath();g.moveTo(x,y-16);g.lineTo(x,y+16);g.stroke();}}
}
function towerSkillPrice(t){return 90+Math.floor(TOWERS[t.type].cost*.6);}
function buyTowerSkill(){const t=selectedTower();if(!t||t.disabled||paused||t.level!==4||t.skillRank||state.money<towerSkillPrice(t))return false;const price=towerSkillPrice(t);state.money-=price;t.invested+=price;t.skillRank=1;burst(t.x,t.y,TOWERS[t.type].color,24);saveProgress();uiDirty=true;return true;}
function refreshFrontierSelection(){
 const t=selectedTower(),campaign=state.mode==='campaign';
 $('garrisonRally').hidden=!t||t.type!=='garrison';$('garrisonRally').disabled=paused||!!t?.disabled;
 $('towerSkill').hidden=!campaign||!t||t.level<4;
 if(t&&campaign&&t.level===4){const skill=FRONTIER_SKILLS[t.type];$('towerSkill').textContent=t.skillRank?skill[0]+' · изучено':skill[0]+' · '+towerSkillPrice(t);$('towerSkill').title=skill[1];$('towerSkill').disabled=!!t.skillRank||paused||!!t.disabled||state.money<towerSkillPrice(t);}
 if(t?.type==='garrison'){$('damageStat').textContent=towerStats(t).damage+' ×3';$('specialStat').textContent='Блокирует до 3 наземных целей';$('selectionDesc').textContent=TOWERS.garrison.desc;}
 if(!campaign)document.querySelector('[data-type="rail"] .tower-cost').firstChild.textContent='180';
 else document.querySelector('[data-type="rail"] .tower-cost').firstChild.textContent='100';
}
function garrisonRally(t){
 if(t.rally)return t.rally;
 let best=null,distance=Infinity;for(let route=0;route<ROUTES.length;route++)for(let d=CELL;d<ROUTES[route].length;d+=CELL/4){const p=pointOnRoute(ROUTES[route],d),dist=Math.hypot(t.x-p.x,t.y-p.y);if(dist<distance){distance=dist;best={x:p.x,y:p.y,route,distance:d};}}
 return t.rally=best;
}
function setGarrisonRally(p){
 const t=state.towers.find(t=>t.id===rallyTargetId);if(!t||!p.inside||paused){rallyTargetId=null;return;}
 let best=null,distance=Infinity;for(let route=0;route<ROUTES.length;route++)for(let d=CELL;d<ROUTES[route].length;d+=CELL/8){const q=pointOnRoute(ROUTES[route],d),dist=Math.hypot(q.x-p.x,q.y-p.y);if(dist<distance&&Math.hypot(t.x-q.x,t.y-q.y)<=towerStats(t).range){distance=dist;best={x:q.x,y:q.y,route,distance:d};}}
 if(!best||distance>CELL*.7){notify('Точка сбора должна быть на дороге в радиусе гарнизона.',true);return;}
 t.rally=best;rallyTargetId=null;saveProgress();uiDirty=true;ring(best.x,best.y,'#a4f6d5',28,.6);
}
function garrisonSoldierStats(t){const s=towerStats(t),hp=80*Math.pow(1.85,t.level-1)*(t.branch==='sentinel'?2:t.branch==='rangers'?.8:1)*(t.skillRank?1.3:1);return {hp,damage:s.damage*(t.branch==='rangers'?1.6:1)*(t.skillRank?1.2:1),rate:s.rate,range:t.branch==='rangers'?CELL*2.3:28};}
// Infantry uses world units per second: no distance-dependent interpolation.
const GARRISON_WALK_SPEED=52;
const GARRISON_CONTACT_RANGE=24;
function moveGarrisonSoldier(s,x,y,dt){
 const dx=x-s.x,dy=y-s.y,distance=Math.hypot(dx,dy),step=Math.min(distance,GARRISON_WALK_SPEED*dt);
 s.walking=step>.05;
 if(step>0){s.x+=dx/distance*step;s.y+=dy/distance*step;s.walkDistance=(s.walkDistance||0)+step;if(Math.abs(dx)>.5)s.facing=dx<0?-1:1;}
 return step;
}
function retireGarrisonSoldier(s){s.hp=0;s.respawnAt=state.time+9;s.enemyId=null;s.walking=false;s.fireUntil=0;burst(s.x,s.y,'#9bf1cf',8);}
function tickGarrisons(dt){
 for(const e of state.enemies)delete e.blockedBy;
 const assignments=new Map(),contacts=new Map(),shots=[];
 for(const t of state.towers)if(t.type==='garrison'){
  const r=garrisonRally(t),stats=garrisonSoldierStats(t);
  t.soldiers??=Array.from({length:3},(_,i)=>({hp:stats.hp,maxHp:stats.hp,respawnAt:0,readyAt:state.time+i*.25,cooldown:.15,x:t.x,y:t.y+8,enemyId:null,walkDistance:0,walking:false,facing:r.x<t.x?-1:1}));
  for(let i=0;i<t.soldiers.length;i++){
   const s=t.soldiers[i];s.walking=false;
   if(s.hp<=0){if(state.time<s.respawnAt)continue;Object.assign(s,{hp:stats.hp,maxHp:stats.hp,x:t.x,y:t.y+8,readyAt:state.time,cooldown:.15,enemyId:null,walkDistance:0,fireUntil:0});}
   if(s.maxHp!==stats.hp){s.hp=Math.min(stats.hp,s.hp+Math.max(0,stats.hp-s.maxHp));s.maxHp=stats.hp;}
   if(t.disabled||state.time<(s.readyAt??0))continue;
   s.cooldown=Math.max(-.5,s.cooldown-dt);
   const candidates=state.enemies.filter(e=>e.hp>0&&!isAirUnit(e)&&Math.hypot(e.x-r.x,e.y-r.y)<=(t.branch==='rangers'?stats.range+16:CELL*.95)).sort((a,b)=>remainingDistance(a)-remainingDistance(b)||a.id-b.id);
   // Cover separate threats when possible. Extra soldiers join the same enemy;
   // selecting a target does not itself block, damage or claim it exclusively.
   const previous=candidates.find(e=>e.id===s.enemyId),free=candidates.filter(e=>!assignments.get(e.id));
   const enemy=(previous&&!assignments.get(previous.id)?previous:null)||free[0]||previous||candidates[0];
   s.enemyId=enemy?.id??null;
   if(enemy)assignments.set(enemy.id,(assignments.get(enemy.id)||0)+1);
   const standX=r.x+[-15,0,15][i],standY=r.y+[-11,12,-11][i];
   const ranged=t.branch==='rangers';
   const x=enemy&&!ranged?enemy.x+[-17,17,0][i]:standX,y=enemy&&!ranged?enemy.y+[-10,-10,19][i]:standY;
   moveGarrisonSoldier(s,x,y,dt);
   if(!enemy){s.hp=Math.min(stats.hp,s.hp+6*dt);continue;}
   const distance=Math.hypot(enemy.x-s.x,enemy.y-s.y);
   if(enemy.type!=='boss'&&distance<=GARRISON_CONTACT_RANGE){if(!contacts.has(enemy))contacts.set(enemy,[]);contacts.get(enemy).push({t,s,key:t.id+':'+i,distance});}
   if(distance<=stats.range){s.aimAngle=Math.atan2(enemy.y-7-(s.y-14),enemy.x-s.x);if(Math.abs(enemy.x-s.x)>.5)s.facing=enemy.x<s.x?-1:1;shots.push({s,enemy,stats});}
  }
 }
 // A single enemy strikes a single defender per tick, even when surrounded.
 // Keep its current defender until that soldier dies or leaves contact range.
 for(const [enemy,defenders]of contacts){
  if(enemy.hp<=0)continue;
  defenders.sort((a,b)=>a.distance-b.distance||a.key.localeCompare(b.key));
  const victim=defenders.find(d=>d.key===enemy.garrisonDefender)||defenders[0];
  enemy.garrisonDefender=victim.key;enemy.blockedBy=victim.t.id;
  const attack=enemy.type==='walker'||enemy.type==='tank'?24:enemy.type==='armor'?17:7;
  if(enemy.stunUntil<=state.time||enemy.stunUntil===undefined)victim.s.hp-=attack*dt;
  if(victim.s.hp<=0){retireGarrisonSoldier(victim.s);const next=defenders.find(d=>d.s.hp>0);if(next){enemy.garrisonDefender=next.key;enemy.blockedBy=next.t.id;}else{delete enemy.blockedBy;delete enemy.garrisonDefender;}}
 }
 for(const {s,enemy,stats}of shots){
  if(s.hp<=0||enemy.hp<=0||s.cooldown>0)continue;
  const angle=s.aimAngle||0,x=s.x+Math.cos(angle)*12,y=s.y-14+Math.sin(angle)*6;
  damageEnemy(enemy,stats.damage,false);s.cooldown=stats.rate;s.fireUntil=state.time+.18;s.shotAngle=angle;
  beams.push({x,y,tx:enemy.x,ty:enemy.y-7,color:'#baffdf',life:.14,maxLife:.14});
  burst(x,y,'#ffe2a1',3);burst(enemy.x,enemy.y-7,'#c5ffdf',2);
 }
}
function drawGarrisonTower(t,ghost,g){
 g.save();g.globalAlpha=ghost?.5:t.disabled?.4:1;sprite(g,'base_garrison',t.x,t.y-3,48+(t.level-1)*2);for(let i=0;i<t.level;i++){g.fillStyle='#9bf1cf';g.fillRect(t.x-8+i*5,t.y+20,3,3);}g.restore();if(!ghost)paintRepairAlert(t,g);
 if(selectedId===t.id||rallyTargetId===t.id){const r=garrisonRally(t);g.save();g.strokeStyle='#9bf1cf88';g.setLineDash([4,4]);g.beginPath();g.moveTo(t.x,t.y);g.lineTo(r.x,r.y);g.stroke();g.setLineDash([]);g.fillStyle='#b7ffe0';g.fillRect(r.x-1,r.y-14,2,24);g.beginPath();g.moveTo(r.x+1,r.y-14);g.lineTo(r.x+15,r.y-9);g.lineTo(r.x+1,r.y-4);g.fill();g.restore();}
}
function drawGarrisonUnits(g){
 for(const t of state.towers)if(t.type==='garrison')for(const s of t.soldiers||[]){
  if(s.hp<=0||state.time<(s.readyAt??0))continue;
  const firing=(s.fireUntil||0)>state.time,base=t.branch==='sentinel'?'soldier_sentinel':t.branch==='rangers'?'soldier_rangers':'soldier';
  const frame=s.walking?Math.floor((s.walkDistance||0)/6)%6:firing?6:7,key=base+'_motion_'+frame;
  g.save();if(t.disabled)g.globalAlpha=.4;
  g.fillStyle='#071c2455';g.beginPath();g.ellipse(s.x,s.y+1,10,4,0,0,Math.PI*2);g.fill();
  g.save();g.translate(s.x,s.y);if(s.facing<0)g.scale(-1,1);
  if(ART.garrisonAnimation&&ART.sprites[key])sprite(g,key,0,0,36);
  else sprite(g,base,0,-10,22);
  g.restore();
  if(firing&&!t.disabled){
   const angle=s.shotAngle||0,x=s.x+Math.cos(angle)*12,y=s.y-14+Math.sin(angle)*6,alpha=Math.min(1,(s.fireUntil-state.time)/.1);
   g.save();g.translate(x,y);g.rotate(angle);g.globalAlpha*=alpha;g.fillStyle='#ffbf6655';g.beginPath();g.arc(0,0,7,0,Math.PI*2);g.fill();g.fillStyle='#ffe9b2';g.beginPath();g.moveTo(9,0);g.lineTo(2,-3);g.lineTo(0,-6);g.lineTo(-2,-2);g.lineTo(-5,0);g.lineTo(-1,2);g.lineTo(0,5);g.lineTo(3,2);g.closePath();g.fill();g.fillStyle='#fff';g.fillRect(-1,-1,4,2);g.restore();
  }
  if(s.hp<s.maxHp){g.fillStyle='#142d30';g.fillRect(s.x-10,s.y-33,20,3);g.fillStyle='#a2f6c9';g.fillRect(s.x-10,s.y-33,20*s.hp/s.maxHp,3);}
  g.restore();
 }
}
function validateGarrisons(run){
 const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
 for(const t of run.towers){if(t.skillRank!==undefined&&![0,1].includes(t.skillRank))return false;if(t.rally&&(!finite(t.rally.x,0,WIDTH)||!finite(t.rally.y,0,HEIGHT)||!Number.isInteger(t.rally.route)||!ROUTES[t.rally.route]||!finite(t.rally.distance,0,ROUTES[t.rally.route].length)))return false;if(t.soldiers&&(!Array.isArray(t.soldiers)||t.soldiers.length!==3||t.soldiers.some(s=>!finite(s.hp,0,s.maxHp)||!finite(s.maxHp,1,100000)||!finite(s.respawnAt,0,1e10)||!finite(s.cooldown,-1,5)||!finite(s.x,-100,WIDTH+100)||!finite(s.y,-100,HEIGHT+100))))return false;}
 for(const t of run.towers)for(const soldier of t.soldiers||[]){
  for(const key of ['readyAt','walkDistance','fireUntil'])if(soldier[key]!==undefined&&!finite(soldier[key],0,1e12))return false;
  for(const key of ['aimAngle','shotAngle'])if(soldier[key]!==undefined&&!finite(soldier[key],-100,100))return false;
  if(soldier.walking!==undefined&&typeof soldier.walking!=='boolean'||soldier.facing!==undefined&&![1,-1].includes(soldier.facing))return false;
 }
 return true;
}
