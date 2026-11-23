const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../src/battle.js'),'utf8');
function battle(){
 const c={CELL:48,WIDTH:1152,HEIGHT:576,state:{time:0,mode:'campaign',sectorId:0,difficulty:0,towers:[{id:1,type:'garrison',level:1,x:120,y:120,rally:{x:150,y:120,route:0,distance:100}}],enemies:[]},towerStats:()=>({damage:6,rate:.9,range:150}),isAirUnit:e=>!!e.flying,remainingDistance:e=>1000-e.distance,damageEnemy:(e,n)=>e.hp=Math.max(0,e.hp-n),burst:()=>{},beams:[]};
 vm.createContext(c);vm.runInContext(code,c);return {c,run:s=>vm.runInContext(s,c)};
}
test('Three soldiers stop three ground enemies; air and bosses keep moving',()=>{
 const {c,run}=battle();c.state.enemies=Array.from({length:5},(_,i)=>({id:i+2,type:i===3?'boss':'scout',flying:i===4,hp:1000,maxHp:1000,x:150,y:120,distance:100,speed:50}));
 run('tickGarrisons(.01)');assert.equal(c.state.towers[0].soldiers.length,3);assert.equal(c.state.enemies.filter(e=>e.blockedBy).length,3);
 run('for(const e of state.enemies)advanceCombatEnemy(e,.1,1)');assert.deepEqual(c.state.enemies.map(e=>e.distance),[100,100,100,105,105]);
});
test('Dead defenders unblock enemies and return only after the respawn deadline',()=>{
 const {c,run}=battle();c.state.enemies=[{id:2,type:'tank',hp:1000,maxHp:1000,x:150,y:120,distance:100,speed:50}];
 run('tickGarrisons(.01);for(const s of state.towers[0].soldiers)s.hp=.01;tickGarrisons(.1)');
 assert.equal(c.state.towers[0].soldiers.filter(s=>s.hp>0).length,0);assert.equal(c.state.enemies[0].blockedBy,undefined);
 c.state.enemies=[];c.state.time=8.99;run('tickGarrisons(.01)');assert.ok(c.state.towers[0].soldiers.every(s=>s.hp===0));
 c.state.time=9.01;run('tickGarrisons(.01)');assert.ok(c.state.towers[0].soldiers.every(s=>s.hp>0));
});
test('Disabled garrisons release all enemies until repaired',()=>{
 const {c,run}=battle();c.state.enemies=[{id:2,type:'scout',hp:1000,maxHp:1000,x:150,y:120,distance:100,speed:50}];run('tickGarrisons(.01)');assert.equal(c.state.enemies[0].blockedBy,1);
 c.state.towers[0].disabled=true;run('tickGarrisons(.01)');assert.equal(c.state.enemies[0].blockedBy,undefined);
});
