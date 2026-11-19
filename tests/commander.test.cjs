const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../src/battle.js'),'utf8');
function combat(){
 let entropy=100;
 const c={CELL:48,WIDTH:1152,HEIGHT:576,crypto:{getRandomValues:bytes=>{bytes[0]=++entropy;return bytes;}},
  state:{mode:'campaign',phase:'wave',sectorId:0,difficulty:0,time:10,enemies:[],towers:[],bossShots:[],queue:[]},
  ENEMIES:{boss:{speed:30}},missionInfo:()=>({bossKind:-1}),commanderKind:()=>-1,
  TOWERS:{pulse:{name:'Pulse'}},announce:()=>{},notify:()=>{},ring:()=>{},burst:()=>{},beep:()=>{},saveProgress:()=>{},
  FX:{sabotageHits:[]},fullEffects:false,REDUCED_MOTION:false};
 vm.createContext(c);vm.runInContext(code,c);
 vm.runInContext("globalThis.boss={id:7,type:'boss',x:500,y:300,angle:0,hp:620,maxHp:620};initialiseCombatEnemy(boss,{type:'boss'});state.enemies=[boss];state.towers=[{id:1,type:'pulse',x:600,y:300}];",c);
 return script=>vm.runInContext(script,c);
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('Identical new encounters request fresh entropy; saved RNG is not overwritten',()=>{
 const run=combat();
 assert.deepEqual(plain(run("const first=boss.commander.seed;const other={...boss,id:boss.id};initialiseCombatEnemy(other,{type:'boss'});[first,other.commander.seed]")),[101,102]);
 assert.equal(run("const saved=JSON.parse(JSON.stringify(boss.commander));boss.commander=saved;boss.commander.seed===101"),true);
});
test('Each skill is an independent draw and may repeat four times consecutively',()=>{
 const run=combat();
 assert.deepEqual(plain(run("commanderRandom=()=>.1;Array.from({length:4},()=>commanderSkill(boss))")),['landing','landing','landing','landing']);
 assert.equal(run("boss.commander.bag===undefined"),true);
});
test('All four legal skills have equal weight over deterministic random draws',()=>{
 const counts=plain(combat()("boss.commander.seed=42;const counts={};for(let i=0;i<4000;i++){const skill=commanderSkill(boss);counts[skill]=(counts[skill]||0)+1;}counts"));
 assert.deepEqual(Object.keys(counts).sort(),['armor','landing','repair','sabotage']);
 assert.ok(Object.values(counts).every(count=>count>850&&count<1150));
});
test('No legal forward target or exhausted landing/heal budget leaves only armor',()=>{
 const run=combat();
 assert.equal(run("state.towers=[];boss.commander.landed=24;boss.commander.healSpent=boss.maxHp*.24;Array.from({length:20},()=>commanderSkill(boss)).every(skill=>skill==='armor')"),true);
});
test('Forward half-plane and six-cell radius work in all four travel directions',()=>{
 const run=combat();
 for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  run(`boss.angle=${angle};`);
  const ids=plain(run("(()=>{const dx=Math.cos(boss.angle),dy=Math.sin(boss.angle),at=(id,forward,side=0)=>({id,x:boss.x+dx*forward-dy*side,y:boss.y+dy*forward+dx*side});state.towers=[at(1,48,30),at(2,130,-40),at(3,-48),at(4,0,48),at(5,6*CELL+.01),at(6,6*CELL)];return sabotageCandidates(boss).map(t=>t.id);})()"));
  assert.deepEqual(ids,[1,2,6]);
 }
});
test('All five forward towers can be chosen, independent of distance or previous repair',()=>{
 const run=combat();
 const counts=plain(run("boss.commander.seed=87;state.towers=Array.from({length:5},(_,i)=>({id:i+1,x:boss.x+40*(i+1),y:boss.y,repairGraceUntil:9999}));const hits={};for(let i=0;i<4000;i++){const id=sabotageTarget(boss).id;hits[id]=(hits[id]||0)+1;}hits"));
 assert.equal(Object.keys(counts).length,5);
 assert.ok(Object.values(counts).every(count=>count>650&&count<950));
 assert.equal(run("state.towers=[state.towers[0]];sabotageTarget(boss).id===sabotageTarget(boss).id"),true);
});
test('One disabled tower or a projectile in flight blocks a second sabotage',()=>{
 const run=combat();
 assert.equal(run("state.towers[0].disabled=true;sabotageTarget(boss)===null"),true);
 assert.equal(run("state.towers[0].disabled=false;state.bossShots=[{}];sabotageTarget(boss)===null"),true);
});
test('A locked target that is behind the boss at release does not receive a shot',()=>{
 const run=combat();
 assert.equal(run("beginCommanderCast(boss,'sabotage')"),true);
 assert.equal(run("boss.x=601;finishCommanderCast(boss,boss.commander.cast);state.bossShots.length===0"),true);
});
test('Forward projectile disables its selected tower despite legacy repair grace',()=>{
 const run=combat();
 assert.equal(run("state.towers[0].repairGraceUntil=9999;beginCommanderCast(boss,'sabotage')"),true);
 assert.equal(run("state.time=11.71;tickCombatSupport(.01);state.bossShots.length===1"),true);
 assert.equal(run("state.time=12.37;tickCombatSupport(.01);state.towers[0].disabled===true"),true);
});
test('Old bag saves and new independent RNG saves remain valid',()=>{
 const run=combat();
 assert.equal(run("validateCombatState(state)"),true);
 assert.equal(run("boss.commander.bag=['armor','landing'];validateCombatState(state)"),true);
 assert.equal(run("boss.commander.bag=['armor','armor'];validateCombatState(state)"),false);
 assert.equal(run("delete boss.commander.bag;boss.commander.seed=1.5;validateCombatState(state)"),false);
});
