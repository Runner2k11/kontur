const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../src/battle.js'),'utf8');
function battle(){
 const c={CELL:48,WIDTH:1152,HEIGHT:576,state:{time:0,mode:'campaign',sectorId:0,difficulty:0,towers:[{id:1,type:'garrison',level:1,x:50,y:120,rally:{x:150,y:120,route:0,distance:100}}],enemies:[]},towerStats:()=>({damage:6,rate:.9,range:150}),isAirUnit:e=>!!e.flying,remainingDistance:e=>1000-e.distance,damageEnemy:(e,n)=>{e.hp=Math.max(0,e.hp-n);c.damageCalls++;},damageCalls:0,burst:()=>{},beams:[]};
 vm.createContext(c);vm.runInContext(code,c);return {c,run:s=>vm.runInContext(s,c),tick(dt=.1){c.state.time+=dt;vm.runInContext('tickGarrisons('+dt+')',c);}};
}
const soldier=(x,y=120)=>({hp:80,maxHp:80,respawnAt:0,readyAt:0,cooldown:0,x,y,enemyId:null});
const enemy=(id=2,extra={})=>({id,type:'scout',hp:1000,maxHp:1000,x:150,y:120,distance:100,speed:50,stunUntil:0,...extra});
test('Speed is bounded and independent of distance, without overshoot',()=>{
 const {run}=battle(),p=JSON.parse(JSON.stringify(run("const near={x:0,y:0},far={x:0,y:0},tiny={x:0,y:0};moveGarrisonSoldier(near,100,0,.5);moveGarrisonSoldier(far,1000,0,.5);moveGarrisonSoldier(tiny,3,4,1);[near,far,tiny]")));
 assert.equal(p[0].x,26);assert.equal(p[1].x,26);assert.equal(p[2].x,3);assert.equal(p[2].y,4);
});
test('New troops depart in sequence, without attacking from the barracks',()=>{
 const {c,tick}=battle();c.state.enemies=[enemy()];tick();const t=c.state.towers[0];assert.ok(Math.hypot(t.soldiers[0].x-t.x,t.soldiers[0].y-(t.y+8))<=5.21);assert.equal(t.soldiers[1].x,t.x);assert.equal(t.soldiers[2].x,t.x);assert.equal(c.damageCalls,0);assert.equal(c.state.enemies[0].blockedBy,undefined);
 for(let i=0;i<4;i++)tick();assert.ok(t.soldiers[0].x>t.soldiers[1].x&&t.soldiers[1].x>t.soldiers[2].x);
});
test('All three join one target, entering weapon range at different times',()=>{
 const {c,tick}=battle();c.state.towers[0].soldiers=[soldier(130),soldier(80),soldier(20)];c.state.enemies=[enemy()];tick();assert.ok(c.state.towers[0].soldiers[0].fireUntil>0);assert.equal(c.state.towers[0].soldiers[1].fireUntil,undefined);assert.equal(c.state.towers[0].soldiers[2].fireUntil,undefined);assert.equal(c.damageCalls,1);
 for(let i=0;i<10;i++)tick();assert.ok(c.state.towers[0].soldiers[1].fireUntil>0);assert.equal(c.state.towers[0].soldiers[2].fireUntil,undefined);
 for(let i=0;i<16;i++)tick();assert.ok(c.state.towers[0].soldiers.every(s=>s.enemyId===2&&s.fireUntil>0));assert.ok(c.beams.some(b=>b.life===.14));
});
test('Three ground threats get three blockers; air and bosses keep moving',()=>{
 const {c,run,tick}=battle();c.state.towers[0].soldiers=[soldier(133,110),soldier(167,110),soldier(150,139)];c.state.enemies=[enemy(2),enemy(3),enemy(4),enemy(5,{type:'boss'}),enemy(6,{flying:true})];tick(.01);assert.equal(c.state.enemies.filter(e=>e.blockedBy).length,3);run('for(const e of state.enemies)advanceCombatEnemy(e,.1,1)');assert.deepEqual(c.state.enemies.map(e=>e.distance),[100,100,100,105,105]);
});
test('One surrounded enemy strikes one defender, while all three return fire',()=>{
 const {c,tick}=battle();c.state.towers[0].soldiers=[soldier(133,110),soldier(167,110),soldier(150,139)];c.state.enemies=[enemy()];tick();const losses=c.state.towers[0].soldiers.map(s=>80-s.hp);assert.ok(Math.abs(losses.reduce((a,b)=>a+b,0)-.7)<1e-8);assert.equal(losses.filter(n=>n>0).length,1);assert.equal(c.damageCalls,3);
});
test('A lone boss receives squad fire without being stopped',()=>{
 const {c,run,tick}=battle();c.state.towers[0].soldiers=[soldier(133,110),soldier(167,110),soldier(150,139)];c.state.enemies=[enemy(2,{type:'boss'})];tick();assert.equal(c.damageCalls,3);assert.equal(c.state.enemies[0].blockedBy,undefined);run('advanceCombatEnemy(state.enemies[0],.1,1)');assert.equal(c.state.enemies[0].distance,105);
});
test('A replacement waits nine seconds, then walks from the barracks',()=>{
 const {c,tick}=battle();c.state.towers[0].soldiers=[soldier(150),soldier(150),soldier(150)];for(const s of c.state.towers[0].soldiers){s.hp=0;s.respawnAt=9;}c.state.time=8.8;tick();assert.ok(c.state.towers[0].soldiers.every(s=>s.hp===0));tick(.2);assert.ok(c.state.towers[0].soldiers.every(s=>s.hp>0&&s.x<65&&s.x>50));
});
test('Disabled garrisons release enemies and stop both marching and fire',()=>{
 const {c,tick}=battle();c.state.towers[0].soldiers=[soldier(133,110),soldier(167,110),soldier(150,139)];c.state.enemies=[enemy()];tick(.01);assert.equal(c.state.enemies[0].blockedBy,1);const before=JSON.stringify(c.state.towers[0].soldiers.map(s=>[s.x,s.y])),shots=c.damageCalls;c.state.towers[0].disabled=true;tick();assert.equal(c.state.enemies[0].blockedBy,undefined);assert.equal(c.damageCalls,shots);assert.equal(JSON.stringify(c.state.towers[0].soldiers.map(s=>[s.x,s.y])),before);
});
