(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const menuScreen = $("menuScreen"), levelsScreen = $("levelsScreen"), gameScreen = $("gameScreen");
  const canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
  const TOTAL_LEVELS = 10;
  const store = {unlocked:1, coins:0, sound:true};
  try {
    const saved = JSON.parse(localStorage.getItem("lh-save") || "{}");
    store.unlocked = Math.max(1, Math.min(TOTAL_LEVELS, Number(saved.unlocked) || 1));
    store.coins = Math.max(0, Number(saved.coins) || 0);
  } catch (_) {}
  let state = "menu", level = 1, score = 0, coins = 0, health = 3, frame = 0, lastTime = 0;
  let player, platforms, enemies, bullets, enemyBullets, pickups, particles, keys = {};
  let cameraX = 0, worldWidth = 2400, levelExit = 0, spawnTimer = 0, toastTimer = 0;
  let audioCtx = null, rafId = 0;
  const gravity = 0.62;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a,b) => a + Math.random()*(b-a);

  function save() {
    try { localStorage.setItem("lh-save", JSON.stringify({unlocked:store.unlocked, coins:store.coins})); } catch (_) {}
  }
  function beep(freq=440, duration=.07, type="sine", volume=.035) {
    if (!store.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = volume;
      o.connect(g); g.connect(audioCtx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
      o.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }
  function showScreen(which) {
    menuScreen.classList.toggle("hidden", which !== "menu");
    levelsScreen.classList.toggle("hidden", which !== "levels");
    gameScreen.classList.toggle("hidden", which !== "game");
    $("pauseBtn").disabled = which !== "game";
  }
  function showToast(text) {
    $("toast").textContent = text;
    $("toast").classList.remove("hidden");
    toastTimer = 110;
  }
  function buildLevels() {
    const grid = $("levelGrid"); grid.innerHTML = "";
    for (let i=1;i<=TOTAL_LEVELS;i++) {
      const b = document.createElement("button");
      b.className = "level-card" + (i>store.unlocked ? " locked" : "") + (i===store.unlocked ? " current" : "");
      b.innerHTML = `<strong>${i>store.unlocked ? "🔒" : String(i).padStart(2,"0")}</strong><small>${i>store.unlocked ? "مغلقة" : (i===store.unlocked ? "المتاحة التالية" : "مفتوحة")}</small>`;
      b.disabled = i>store.unlocked;
      b.addEventListener("click", () => startGame(i));
      grid.appendChild(b);
    }
  }
  function openOverlay(title, text, icon, mainLabel, mainAction) {
    $("overlayTitle").textContent = title; $("overlayText").textContent = text; $("overlayIcon").textContent = icon;
    $("overlayMainBtn").textContent = mainLabel;
    $("overlay").classList.remove("hidden");
    $("overlayMainBtn").onclick = mainAction;
  }
  function hideOverlay() { $("overlay").classList.add("hidden"); }
  function startGame(lvl=1) {
    level = clamp(lvl,1,store.unlocked); score = 0; coins = 0; health = 3; frame = 0; cameraX = 0;
    worldWidth = 2100 + level*210; levelExit = worldWidth - 100; spawnTimer=0;
    player = {x:70,y:340,w:34,h:48,vx:0,vy:0,dir:1,onGround:false,invuln:0,shootCd:0};
    platforms = [{x:0,y:440,w:worldWidth,h:100}];
    const gapCount = 9 + level;
    let x = 270;
    for(let i=0;i<gapCount;i++){
      const w = rand(100,190), y = rand(330,405);
      platforms.push({x,y,w,h:18});
      if(i%2===0) platforms.push({x:x+rand(25,65),y:y-rand(55,95),w:rand(70,115),h:14});
      x += w + rand(70,125);
    }
    platforms.push({x:worldWidth-180,y:390,w:180,h:50});
    enemies = []; bullets=[]; enemyBullets=[]; pickups=[]; particles=[];
    const enemyCount = 8 + level*2;
    for(let i=0;i<enemyCount;i++){
      const ex=rand(250,worldWidth-220), groundY=groundAt(ex);
      enemies.push({x:ex,y:groundY-38,w:32,h:38,hp:level>=5?2:1,maxHp:level>=5?2:1,vx:rand(.5,1.15)*(Math.random()<.5?-1:1),shoot:rand(60,180),type:i%5===4?"elite":"bot"});
    }
    for(let i=0;i<18+level*2;i++){
      const px=rand(170,worldWidth-160), gy=groundAt(px);
      pickups.push({x:px,y:gy-rand(28,85),r:9,kind:i%5===0?"heart":"coin",taken:false,bob:rand(0,6.28)});
    }
    state="playing"; showScreen("game"); hideOverlay(); updateHud(); $("pauseBtn").textContent="Ⅱ"; lastTime=performance.now(); beep(620,.12,"triangle");
    cancelAnimationFrame(rafId); rafId=requestAnimationFrame(loop);
  }
  function groundAt(x) {
    let y=440;
    for(const p of platforms||[]) if(x>=p.x && x<=p.x+p.w && p.y<y) y=Math.min(y,p.y);
    return y;
  }
  function updateHud() {
    $("hudLevel").textContent=String(level).padStart(2,"0");
    $("hudHealth").textContent=health>0 ? "♥ ".repeat(health).trim() : "—";
    $("hudCoins").textContent=store.coins+coins;
    $("hudScore").textContent=score;
  }
  function spawnParticles(x,y,color,n=8) {
    for(let i=0;i<n;i++) particles.push({x,y,vx:rand(-3,3),vy:rand(-4,1),life:rand(18,35),max:35,color,size:rand(2,5)});
  }
  function shoot() {
    if(state!=="playing" || !player || player.shootCd>0) return;
    bullets.push({x:player.x+player.w/2+player.dir*18,y:player.y+20,vx:player.dir*10.5,life:75});
    player.shootCd=18; beep(720,.045,"square",.018);
  }
  function jump() {
    if(state==="playing" && player && player.onGround){player.vy=-12.5;player.onGround=false;beep(330,.07,"triangle",.025);}
  }
  function damage() {
    if(player.invuln>0) return;
    health--; player.invuln=85; player.vy=-5; spawnParticles(player.x+player.w/2,player.y+player.h/2,"#ff5f9c",12); beep(145,.18,"sawtooth",.04); updateHud();
    if(health<=0){state="gameover";openOverlay("انتهت المحاولة","حاول تاني، واجمع العملات وتفادى ضربات الروبوتات.","✕","إعادة المحاولة",()=>startGame(level));$("pauseBtn").disabled=true;}
  }
  function finishLevel() {
    if(state!=="playing") return;
    state="leveldone"; const earnedCoins=coins; store.coins+=earnedCoins; coins=0; store.unlocked=Math.max(store.unlocked,Math.min(TOTAL_LEVELS,level+1)); save(); updateHud();
    const final = level>=TOTAL_LEVELS;
    openOverlay(final?"أنت أسطورة!":"تم إنجاز المهمة",final?"أنهيت كل مراحل النسخة التجريبية. تقدر تعيد اللعب وتحسن نتيجتك.":`جمعت ${earnedCoins} عملة وحققت ${score} نقطة. المرحلة التالية أصبحت متاحة!`,"✦",final?"العب من جديد":"المرحلة التالية",()=>startGame(final?1:level+1));
    $("pauseBtn").disabled=true; beep(880,.22,"triangle",.045); buildLevels();
  }
  function pauseGame() {
    if(state==="playing"){state="paused";$("pauseBtn").textContent="▶";openOverlay("استراحة قصيرة","اللعبة متوقفة مؤقتًا. لما تكون جاهز كمّل مهمتك.","Ⅱ","استكمال",()=>{state="playing";hideOverlay();$("pauseBtn").textContent="Ⅱ";lastTime=performance.now();rafId=requestAnimationFrame(loop);});}
    else if(state==="paused"){state="playing";hideOverlay();$("pauseBtn").textContent="Ⅱ";lastTime=performance.now();rafId=requestAnimationFrame(loop);}
  }
  function rects(a,b){return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;}
  function update() {
    frame++;
    const left=keys.left||keys.ArrowLeft||keys.a||keys.A, right=keys.right||keys.ArrowRight||keys.d||keys.D;
    if(left){player.vx-=.75;player.dir=-1;} if(right){player.vx+=.75;player.dir=1;}
    player.vx*=left||right?.86:.78; player.vx=clamp(player.vx,-5.2,5.2);
    if(!left&&!right&&Math.abs(player.vx)<.2)player.vx=0;
    if((keys.jump||keys.ArrowUp||keys.w||keys.W||keys[" "])&&!player.jumpHeld) jump();
    player.jumpHeld=!!(keys.jump||keys.ArrowUp||keys.w||keys.W||keys[" "]);
    if(keys.shoot||keys.f||keys.F)shoot();
    player.vy+=gravity;player.vy=clamp(player.vy,-15,13);
    const oldY=player.y; player.x+=player.vx; player.x=clamp(player.x,0,worldWidth-player.w); player.y+=player.vy; player.onGround=false;
    for(const p of platforms){
      if(player.vy>=0 && oldY+player.h<=p.y+8 && player.y+player.h>=p.y && player.x+player.w>p.x && player.x<p.x+p.w){player.y=p.y-player.h;player.vy=0;player.onGround=true;}
      if(player.vy<0 && oldY>=p.y+p.h && player.y<=p.y+p.h && player.x+player.w>p.x && player.x<p.x+p.w){player.y=p.y+p.h;player.vy=1;}
    }
    if(player.y>600)damage(),player.y=300,player.vy=0;
    if(player.invuln>0)player.invuln--;if(player.shootCd>0)player.shootCd--;
    cameraX=clamp(player.x-canvas.width*.36,0,worldWidth-canvas.width);
    for(const b of bullets){b.x+=b.vx;b.life--;for(const e of enemies){if(e.hp>0&&rects({x:b.x-5,y:b.y-3,w:10,h:6},e)){e.hp--;b.life=0;spawnParticles(b.x,b.y,"#62edff",5);if(e.hp<=0){score+=e.type==="elite"?150:100;spawnParticles(e.x+e.w/2,e.y+e.h/2,"#b08bff",13);beep(240,.06,"square",.02);}break;}}}
    bullets=bullets.filter(b=>b.life>0&&b.x>-20&&b.x<worldWidth+20);
    for(const e of enemies){
      if(e.hp<=0)continue;
      e.x+=e.vx;
      const floor=groundAt(e.x+e.w/2);
      if(e.x<0||e.x+e.w>worldWidth||Math.random()<.015)e.vx*=-1;
      if(e.y+e.h<floor)e.y+=Math.min(4,floor-(e.y+e.h));else if(e.y+e.h>floor)e.y=floor-e.h;
      if(Math.abs((e.x+e.w/2)-(player.x+player.w/2))<230){e.vx += Math.sign(player.x-e.x)*.018;e.vx=clamp(e.vx,-1.5,1.5);}
      e.shoot--;
      if(e.shoot<=0 && Math.abs(e.x-player.x)<450){enemyBullets.push({x:e.x+e.w/2,y:e.y+15,vx:Math.sign(player.x-e.x)*3.3,life:120});e.shoot=rand(100,180)-level*2;}
      if(rects(player,e))damage();
    }
    enemies=enemies.filter(e=>e.hp>0);
    for(const b of enemyBullets){b.x+=b.vx;b.life--;if(rects({x:b.x-5,y:b.y-5,w:10,h:10},player)){b.life=0;damage();}}
    enemyBullets=enemyBullets.filter(b=>b.life>0);
    for(const p of pickups){if(p.taken)continue;p.bob+=.08;if(Math.hypot((player.x+player.w/2)-p.x,(player.y+player.h/2)-(p.y+Math.sin(p.bob)*4))<26){p.taken=true;if(p.kind==="coin"){coins++;score+=25;beep(960,.055,"sine",.025);}else{health=Math.min(3,health+1);beep(540,.1,"sine");}updateHud();}}
    for(const p of particles){p.x+=p.vx;p.y+=p.vy;p.vy+=.08;p.life--;}particles=particles.filter(p=>p.life>0);
    if(toastTimer>0&&!--toastTimer)$("toast").classList.add("hidden");
    if(player.x>levelExit)finishLevel();
    if(frame%10===0)updateHud();
  }
  function drawBackground() {
    const g=ctx.createLinearGradient(0,0,0,540);g.addColorStop(0,"#080d25");g.addColorStop(.62,"#15153c");g.addColorStop(1,"#241644");ctx.fillStyle=g;ctx.fillRect(0,0,960,540);
    for(let i=0;i<75;i++){const sx=((i*137-cameraX*.15)%1020+1020)%1020,sy=(i*71)%310;ctx.fillStyle=i%4===0?"#7cefff":"#7887d4";ctx.globalAlpha=.25+(i%5)*.12;ctx.fillRect(sx,sy, i%7===0?3:1.5, i%7===0?3:1.5);}ctx.globalAlpha=1;
    ctx.fillStyle="#1b2351";ctx.beginPath();ctx.moveTo(0,380);for(let x=0;x<=960;x+=80)ctx.lineTo(x,350+Math.sin((x+cameraX*.1)*.014)*26);ctx.lineTo(960,540);ctx.lineTo(0,540);ctx.fill();
    ctx.strokeStyle="#4e4dd4";ctx.globalAlpha=.24;ctx.lineWidth=1;
    for(let x=-(cameraX*.35%60);x<980;x+=60){ctx.beginPath();ctx.moveTo(x,420);ctx.lineTo(480+(x-480)*2,540);ctx.stroke();}
    for(let y=438;y<550;y+=22){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(960,y);ctx.stroke();}ctx.globalAlpha=1;
  }
  function drawPlatform(p){
    const x=p.x-cameraX;if(x+p.w<0||x>960)return;
    ctx.fillStyle="#111d3b";ctx.fillRect(x,p.y,p.w,p.h);
    ctx.fillStyle="#344f8c";ctx.fillRect(x,p.y,p.w,4);
    ctx.shadowBlur=12;ctx.shadowColor="#55eaff";ctx.fillStyle="#58e8ff";ctx.fillRect(x,p.y,p.w,2);ctx.shadowBlur=0;
    ctx.strokeStyle="#26396a";ctx.strokeRect(x,p.y,p.w,p.h);
  }
  function drawHero(){
    const x=player.x-cameraX,y=player.y;
    if(player.invuln>0&&Math.floor(frame/5)%2===0)return;
    ctx.save();ctx.translate(x+player.w/2,y);ctx.scale(player.dir,1);
    ctx.shadowBlur=15;ctx.shadowColor="#5cecff";
    ctx.fillStyle="#a6f6ff";ctx.beginPath();ctx.moveTo(-11,8);ctx.lineTo(-8,-5);ctx.lineTo(8,-5);ctx.lineTo(13,8);ctx.lineTo(9,19);ctx.lineTo(-9,19);ctx.closePath();ctx.fill();
    ctx.fillStyle="#273a77";ctx.fillRect(-10,18,20,20);ctx.fillStyle="#55eaff";ctx.fillRect(-8,23,16,4);
    ctx.fillStyle="#263e7c";ctx.fillRect(-9,37,7,11);ctx.fillRect(3,37,7,11);ctx.fillStyle="#6deaff";ctx.fillRect(-10,45,9,3);ctx.fillRect(2,45,9,3);
    ctx.fillStyle="#8cf5ff";ctx.fillRect(8,20,12,5);ctx.fillStyle="#b3a1ff";ctx.fillRect(17,20,13,3);
    ctx.restore();ctx.shadowBlur=0;
  }
  function drawEnemy(e){
    const x=e.x-cameraX;if(x<-50||x>1010)return;
    ctx.save();ctx.shadowBlur=10;ctx.shadowColor=e.type==="elite"?"#b277ff":"#ff548b";
    ctx.fillStyle=e.type==="elite"?"#7b55bf":"#ad315e";ctx.fillRect(x,e.y+8,e.w,e.h-8);
    ctx.fillStyle="#ff9fca";ctx.fillRect(x+5,e.y+15,e.w-10,5);ctx.fillStyle="#fff";ctx.fillRect(x+8,e.y+16,4,3);ctx.fillRect(x+20,e.y+16,4,3);
    ctx.fillStyle="#36224f";ctx.fillRect(x+4,e.y+e.h-5,8,5);ctx.fillRect(x+e.w-12,e.y+e.h-5,8,5);
    if(e.maxHp>1){ctx.fillStyle="#331e43";ctx.fillRect(x,e.y-8,e.w,4);ctx.fillStyle="#dba5ff";ctx.fillRect(x,e.y-8,e.w*(e.hp/e.maxHp),4);}
    ctx.restore();
  }
  function render(){
    drawBackground();
    for(const p of platforms)drawPlatform(p);
    // Gate at the end of the level
    const gx=levelExit-cameraX;
    if(gx>-80&&gx<1000){ctx.strokeStyle="#62edff";ctx.lineWidth=4;ctx.shadowBlur=18;ctx.shadowColor="#62edff";ctx.strokeRect(gx,300,54,140);ctx.shadowBlur=0;ctx.fillStyle="#c1fbff";ctx.font="bold 12px system-ui";ctx.textAlign="center";ctx.fillText("EXIT",gx+27,290);}
    for(const p of pickups){if(p.taken)continue;const x=p.x-cameraX,y=p.y+Math.sin(p.bob)*4;if(x<-20||x>980)continue;ctx.save();ctx.translate(x,y);ctx.shadowBlur=14;ctx.shadowColor=p.kind==="coin"?"#ffe66a":"#ff5f9c";ctx.fillStyle=p.kind==="coin"?"#ffe66a":"#ff6b9d";if(p.kind==="coin"){ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff4ac";ctx.fillRect(-2,-5,4,10);}else{ctx.font="20px system-ui";ctx.textAlign="center";ctx.fillText("♥",0,7);}ctx.restore();}
    for(const b of bullets){ctx.shadowBlur=13;ctx.shadowColor="#5cecff";ctx.fillStyle="#b7fbff";ctx.fillRect(b.x-cameraX-7,b.y-2,14,4);}ctx.shadowBlur=0;
    for(const b of enemyBullets){ctx.shadowBlur=10;ctx.shadowColor="#ff6a9b";ctx.fillStyle="#ff8bb2";ctx.beginPath();ctx.arc(b.x-cameraX,b.y,5,0,Math.PI*2);ctx.fill();}ctx.shadowBlur=0;
    for(const e of enemies)drawEnemy(e);
    drawHero();
    for(const p of particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x-cameraX,p.y,p.size,p.size);}ctx.globalAlpha=1;
    // Level progress
    ctx.fillStyle="#0c1530";ctx.fillRect(18,18,180,7);ctx.fillStyle="#5cecff";ctx.fillRect(18,18,180*clamp(player.x/levelExit,0,1),7);
    ctx.fillStyle="#c7d8ff";ctx.font="11px system-ui";ctx.textAlign="left";ctx.fillText("PROGRESS",18,38);
  }
  function loop(now){
    if(state!=="playing")return;
    const dt=Math.min(2,(now-lastTime)/16.67||1);lastTime=now;
    // Simulation remains stable on common mobile refresh rates.
    for(let i=0;i<Math.ceil(dt);i++){if(state==="playing")update();}
    render();
    if(state==="playing")rafId=requestAnimationFrame(loop);
  }
  function bindHold(id,key){
    const el=$(id);
    const down=e=>{e.preventDefault();keys[key]=true;try{el.setPointerCapture(e.pointerId);}catch(_){}};
    const up=e=>{e.preventDefault();keys[key]=false;};
    el.addEventListener("pointerdown",down);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);el.addEventListener("lostpointercapture",up);
    el.addEventListener("contextmenu",e=>e.preventDefault());
  }
  $("startBtn").addEventListener("click",()=>startGame(Math.min(store.unlocked,TOTAL_LEVELS)));
  $("levelsBtn").addEventListener("click",()=>{buildLevels();showScreen("levels");});
  $("backBtn").addEventListener("click",()=>showScreen("menu"));
  $("pauseBtn").addEventListener("click",pauseGame);
  $("soundBtn").addEventListener("click",()=>{store.sound=!store.sound;$("soundBtn").textContent=store.sound?"🔊":"🔇";if(store.sound)beep(500,.07);});
  $("overlayMenuBtn").addEventListener("click",()=>{state="menu";hideOverlay();showScreen("menu");$("pauseBtn").disabled=true;});
  bindHold("leftBtn","left");bindHold("rightBtn","right");bindHold("jumpBtn","jump");bindHold("shootBtn","shoot");
  window.addEventListener("keydown",e=>{
    if(["ArrowLeft","ArrowRight","ArrowUp"," ","ArrowDown"].includes(e.key))e.preventDefault();
    keys[e.key]=true;
    if(e.key==="Escape"&&state==="playing")pauseGame();
    if((e.key==="Enter")&&state==="paused")pauseGame();
  },{passive:false});
  window.addEventListener("keyup",e=>{keys[e.key]=false;});
  window.addEventListener("blur",()=>{keys.left=keys.right=keys.jump=keys.shoot=false;if(state==="playing")pauseGame();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&state==="playing")pauseGame();});
  // Prevent a mobile browser's double-tap zoom from interrupting gameplay.
  let lastTouch=0;document.addEventListener("touchend",e=>{const now=Date.now();if(now-lastTouch<300)e.preventDefault();lastTouch=now;},{passive:false});
  // Canvas scales with the screen while preserving its internal coordinate system.
  function resizeCanvas(){
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const rect=canvas.getBoundingClientRect();
    if(rect.width>0&&rect.height>0){canvas.width=960;canvas.height=540;ctx.imageSmoothingEnabled=true;}
  }
  window.addEventListener("resize",resizeCanvas);resizeCanvas();
  buildLevels();showScreen("menu");
  // A small static background makes the game screen look intentional before starting.
  ctx.fillStyle="#080d25";ctx.fillRect(0,0,960,540);
  ctx.fillStyle="#5cecff";ctx.globalAlpha=.6;
  for(let i=0;i<55;i++){ctx.fillRect((i*139)%960,(i*73)%540,2,2);}
  ctx.globalAlpha=1;ctx.fillStyle="#182247";ctx.fillRect(0,440,960,100);
  ctx.fillStyle="#5cecff";ctx.fillRect(0,440,960,3);
})();
