const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../src/battle.js'),'utf8');
function scene(){
 let clock=0;
 const context={CELL:48,MAX_ACTIVE_WAVES:2,sessionStarted:true,uiDirty:false,
  performance:{now:()=>clock},closeAllDialogs:()=>{},closeContextPanel:()=>{},
  debrisTicks:0,visualTicks:0,advanceDebris:()=>context.debrisTicks++,updateVisuals:()=>context.visualTicks++,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  state:{phase:'wave',wave:1,difficulty:0,time:10,waves:[],waveClock:{openedAt:10,releaseAt:null,dueAt:null,bonusDeadline:30}},
  wavePlan:()=>[{group:2,spawnOffset:4}]};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,at:time=>{clock=time;},run:source=>vm.runInContext(source,context)};
}
test('Both results wait two wall-clock seconds, independently of battle speed',()=>{
 for(const phase of ['win','lose'])for(const speed of [1,3]){
  const s=scene();s.context.state.phase=phase;s.context.speed=speed;
  s.run('beginBattleResult();uiDirty=false');s.at(1999);
  assert.equal(s.run('battleResultPending()'),true);
  s.run('tickBattleResult(.1)');assert.equal(s.context.uiDirty,false);
  assert.equal(s.context.debrisTicks,1);assert.equal(s.context.visualTicks,1);assert.equal(s.context.state.time,10);
  s.at(2000);assert.equal(s.run('battleResultPending()'),false);
  s.run('tickBattleResult(.1)');assert.equal(s.context.uiDirty,true);
 }
});
test('A pending result never delays a new battle or the main menu',()=>{
 const s=scene();s.context.state.phase='win';s.run('beginBattleResult()');
 s.context.sessionStarted=false;assert.equal(s.run('battleResultPending()'),false);
 s.context.sessionStarted=true;s.context.state={phase:'build'};
 assert.equal(s.run('battleResultPending()'),false);s.run('tickBattleResult(.1)');assert.equal(s.context.debrisTicks,0);
});
test('The entry clock shrinks throughout emission and the final pause without a reset',()=>{
 const s=scene();s.context.state.time=20;
 assert.equal(s.run('attackForecastClock([]).progress'),.5);
 Object.assign(s.context.state.waveClock,{releaseAt:25,dueAt:30});s.context.state.time=27.5;
 assert.equal(s.run('attackForecastClock([]).progress'),.125);
 s.context.state.time=30;s.context.state.waves=[{},{}];
 assert.equal(s.run('attackForecastClock([]).progress'),0);assert.equal(s.run('attackForecastClock([]).waiting'),true);
 s.context.state.waves=[];assert.equal(s.run('attackForecastClock([]).progress'),0);
});
test('Manual first-wave preparation has a full clock and no automatic countdown',()=>{
 const s=scene();s.context.state.wave=0;
 assert.equal(s.run('attackForecastClock([]).progress'),1);
 assert.equal(s.run('attackForecastClock([]).label'),'Запуск по команде');
});
test('The assault clock tracks remaining releases in the displayed group',()=>{
 const s=scene();s.context.state.difficulty=1;s.context.state.time=20;
 s.run('globalThis.items=[{group:2,spawnAt:20},{group:2,spawnAt:21}]');
 const progress=s.run('attackForecastClock(items).progress');assert.ok(progress>0&&progress<1);
 s.context.state.time=21;assert.equal(s.run('attackForecastClock(items).progress'),0);
});
