const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('cameraFeed');
const handOverlay = document.getElementById('handOverlay');
const handCtx = handOverlay.getContext('2d');
const webcamPreview = document.getElementById('webcamPreview');
const crosshair = document.getElementById('crosshair');
const introOverlay = document.getElementById('introOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const scoreValue = document.getElementById('scoreValue');
const timerValue = document.getElementById('timerValue');
const targetValue = document.getElementById('targetValue');
const streakValue = document.getElementById('streakValue');
const trackingStatus = document.getElementById('trackingStatus');
const modeLabel = document.getElementById('modeLabel');
const aimHint = document.getElementById('aimHint');
const startButton = document.getElementById('startButton');
const postureGuide = document.getElementById('postureGuide');
const postureMessage = document.getElementById('postureMessage');
const audioToggle = document.getElementById('audioToggle');
const audioLabel = document.getElementById('audioLabel');

let width = 0, height = 0, animationId, lastFrame = 0, lastShot = 0;
let discs = [], bursts = [], score = 0, streak = 0, bestStreak = 0, timeLeft = 60, playing = false;
let pointer = { x: 0, y: 0, viewX: 0, viewY: 0, lastX: 0, lastY: 0, lastMove: performance.now() };
let handMode = false, camera = null, previousHandX = null, previousHandY = null, previousHandTime = 0;
let previousRawX = null, previousRawY = null, previousRawTime = 0, smoothedLandmarks = null, lastHandSeenAt = 0, lastValidPoseAt = 0, poseWasValid = false, lastValidLandmarks = null;
let postureReady = false, validPoseSince = 0;
let audioContext = null, masterGain = null, musicGain = null, sfxGain = null, musicTimer = null, musicStep = 0, audioEnabled = false;

const palette = ['#c8f23e', '#e8eadb', '#ff6b35'];
const rand = (min, max) => Math.random() * (max - min) + min;
const pad = n => String(Math.max(0, Math.ceil(n))).padStart(2, '0');

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain(); masterGain.gain.value = .8; masterGain.connect(audioContext.destination);
    musicGain = audioContext.createGain(); musicGain.gain.value = .3; musicGain.connect(masterGain);
    sfxGain = audioContext.createGain(); sfxGain.gain.value = .8; sfxGain.connect(masterGain);
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}
function tone(frequency, duration=.12, type='sine', volume=.12, destination=sfxGain, delay=0) {
  if (!audioEnabled || !ensureAudio()) return;
  const now = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(volume, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain); gain.connect(destination); oscillator.start(now); oscillator.stop(now + duration + .03);
}
function scheduleMusicNote() {
  if (!audioEnabled) return;
  const notes = [110, 0, 146.83, 0, 164.81, 0, 130.81, 0, 98, 0, 146.83, 0, 174.61, 0, 130.81, 0];
  const note = notes[musicStep++ % notes.length];
  if (note) { tone(note, .42, 'triangle', .045, musicGain); tone(note * 2, .16, 'sine', .018, musicGain, .08); }
}
function startMusic() {
  ensureAudio();
  if (musicTimer || !audioEnabled) return;
  musicStep = 0; scheduleMusicNote(); musicTimer = window.setInterval(scheduleMusicNote, 360);
}
function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
function setAudioEnabled(enabled) {
  audioEnabled = enabled;
  if (enabled) { ensureAudio(); audioToggle.classList.add('is-on'); audioToggle.setAttribute('aria-pressed', 'true'); audioToggle.setAttribute('aria-label', 'Turn sound off'); audioLabel.textContent = 'SOUND ON'; if (playing) startMusic(); }
  else { stopMusic(); if (masterGain) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .03); audioToggle.classList.remove('is-on'); audioToggle.setAttribute('aria-pressed', 'false'); audioToggle.setAttribute('aria-label', 'Turn sound on'); audioLabel.textContent = 'SOUND OFF'; }
  if (enabled && masterGain) masterGain.gain.setTargetAtTime(.8, audioContext.currentTime, .03);
}
audioToggle.addEventListener('click', () => setAudioEnabled(!audioEnabled));

function resize() { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); width = rect.width; height = rect.height; canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); handOverlay.width=320; handOverlay.height=240; if (!pointer.x) { pointer.x = width / 2; pointer.y = height / 2; pointer.viewX=pointer.x; pointer.viewY=pointer.y; } }
window.addEventListener('resize', resize); resize();

function setPointer(x, y, recoil = false) { const nextX=Math.max(0,Math.min(width,x)); const nextY=Math.max(0,Math.min(height,y)); if(recoil && playing)shoot(pointer.x,pointer.y); pointer.x=nextX; pointer.y=nextY; crosshair.classList.add('is-visible'); }
function smoothCrosshair() { const distance=Math.hypot(pointer.x-pointer.viewX,pointer.y-pointer.viewY); const easing=distance>90?.52:.38; pointer.viewX+=(pointer.x-pointer.viewX)*easing; pointer.viewY+=(pointer.y-pointer.viewY)*easing; crosshair.style.left=`${pointer.viewX}px`;crosshair.style.top=`${pointer.viewY}px`;requestAnimationFrame(smoothCrosshair); }
smoothCrosshair();
function pointerMove(e) { const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top; const now = performance.now(); const dx = x - pointer.lastX, dy = y - pointer.lastY; const speed = Math.hypot(dx, dy) / Math.max(1, now - pointer.lastMove); setPointer(x, y); if (playing && speed > 1.5 && now - lastShot > 420 && Math.hypot(dx,dy)>28) shoot(); pointer.lastX=x; pointer.lastY=y; pointer.lastMove=now; }
canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerdown', e => { const r=canvas.getBoundingClientRect(); setPointer(e.clientX-r.left,e.clientY-r.top); if(playing)shoot(pointer.x,pointer.y); });

function spawnDisc() { const r = rand(20, 31); const edge = Math.floor(rand(0,4)); let x, y; if(edge===0){x=-r;y=rand(90,height-70);} else if(edge===1){x=width+r;y=rand(90,height-70);} else if(edge===2){x=rand(40,width-40);y=-r;} else {x=rand(40,width-40);y=height+r;} const angle=Math.atan2(rand(80,height-80)-y,rand(40,width-40)-x); discs.push({x,y,r, vx:Math.cos(angle)*rand(55,105), vy:Math.sin(angle)*rand(55,105), spin:rand(-2,2), rotation:rand(0,6), tilt:rand(.58,.78), depth:rand(4,8), hue:palette[Math.floor(rand(0,palette.length))], age:0}); }
function seedDiscs() { discs=[]; for(let i=0;i<6;i++){ spawnDisc(); discs[i].x=rand(80,width-80); discs[i].y=rand(100,height-100); discs[i].vx=rand(-65,65); discs[i].vy=rand(-45,45); } targetValue.textContent='06'; }

function startGame() { if(!postureReady)return; setAudioEnabled(true); tone(220,.18,'square',.06); startMusic(); score=0; streak=0; bestStreak=0; timeLeft=60; playing=true; scoreValue.textContent='0000'; streakValue.textContent='00'; timerValue.textContent='01:00'; introOverlay.classList.add('is-hidden'); gameOverOverlay.classList.add('is-hidden'); aimHint.classList.remove('is-hidden'); seedDiscs(); lastFrame=performance.now(); cancelAnimationFrame(animationId); animationId=requestAnimationFrame(loop); }
function endGame() { playing=false; stopMusic(); tone(130,.35,'sawtooth',.06); document.getElementById('finalScore').textContent=String(score).padStart(4,'0'); document.getElementById('finalStreak').textContent=String(bestStreak).padStart(2,'0'); gameOverOverlay.classList.remove('is-hidden'); aimHint.classList.add('is-hidden'); }
document.getElementById('startButton').addEventListener('click', startGame); document.getElementById('restartButton').addEventListener('click', startGame);

function shoot(aimX=pointer.x,aimY=pointer.y) { lastShot=performance.now(); tone(88,.07,'square',.07); tone(55,.1,'sawtooth',.04,sfxGain,.035); let hit=-1; let nearest=Infinity; discs.forEach((d,i)=>{const distance=Math.hypot(d.x-aimX,d.y-aimY); if(distance<d.r+22&&distance<nearest){nearest=distance;hit=i;}}); if(hit>=0){ const d=discs.splice(hit,1)[0]; tone(440,.09,'triangle',.08); tone(660,.18,'sine',.06,sfxGain,.06); score+=100+streak*20; streak++; bestStreak=Math.max(bestStreak,streak); bursts.push({x:d.x,y:d.y,r:2,life:1,color:d.hue}); scoreValue.textContent=String(score).padStart(4,'0'); streakValue.textContent=String(streak).padStart(2,'0'); } else { tone(150,.12,'sine',.045); streak=0; streakValue.textContent='00'; bursts.push({x:aimX,y:aimY,r:2,life:.55,color:'#ff6b35'}); } while(discs.length<6) spawnDisc(); }

function drawDisc(d) { ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.rotation); ctx.scale(1,d.tilt); ctx.globalAlpha=.32; ctx.fillStyle='#000'; ctx.filter='blur(5px)'; ctx.beginPath(); ctx.ellipse(d.depth*.8,d.depth*1.8,d.r*1.03,d.r*.84,0,0,Math.PI*2); ctx.fill(); ctx.filter='none'; ctx.globalAlpha=1; for(let layer=d.depth;layer>0;layer-=1){ ctx.fillStyle=layer%2?'#53620f':'#313a16'; ctx.beginPath();ctx.ellipse(0,layer*.7,d.r,d.r*.86,0,0,Math.PI*2);ctx.fill(); } const shell=ctx.createRadialGradient(-d.r*.35,-d.r*.45,d.r*.08,d.r*.2,d.r*.3,d.r*1.1); shell.addColorStop(0,'#f2f7d0'); shell.addColorStop(.18,d.hue); shell.addColorStop(.63,d.hue); shell.addColorStop(1,'#343d18'); ctx.fillStyle=shell;ctx.shadowBlur=18;ctx.shadowColor=d.hue;ctx.beginPath();ctx.ellipse(0,0,d.r,d.r*.86,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0; ctx.strokeStyle='rgba(255,255,255,.86)';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,0,d.r*.88,d.r*.74,0,Math.PI*1.08,Math.PI*1.86);ctx.stroke();ctx.strokeStyle='rgba(12,14,12,.6)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(0,0,d.r*.57,d.r*.45,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-d.r*.72,0);ctx.lineTo(d.r*.72,0);ctx.moveTo(0,-d.r*.56);ctx.lineTo(0,d.r*.56);ctx.stroke();ctx.fillStyle='#e8eadb';ctx.globalAlpha=.85;ctx.beginPath();ctx.ellipse(-d.r*.22,-d.r*.29,d.r*.12,d.r*.055,-.4,0,Math.PI*2);ctx.fill();ctx.restore(); }
function drawBackground(t) { ctx.clearRect(0,0,width,height); ctx.strokeStyle='rgba(200,242,62,.045)';ctx.lineWidth=1; const grid=80; for(let x=(t*.01)%grid;x<width;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();} for(let y=(t*.008)%grid;y<height;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();} ctx.strokeStyle='rgba(200,242,62,.08)';ctx.beginPath();ctx.arc(width/2,height/2,Math.min(width,height)*.31,0,Math.PI*2);ctx.stroke(); }
function loop(now) { if(!playing)return; const dt=Math.min(.04,(now-lastFrame)/1000); lastFrame=now; timeLeft-=dt; timerValue.textContent=`${pad(Math.floor(timeLeft/60))}:${pad(timeLeft%60)}`; if(timeLeft<=0){timeLeft=0;timerValue.textContent='00:00';endGame();return;} drawBackground(now); discs.forEach(d=>{d.x+=d.vx*dt;d.y+=d.vy*dt;d.rotation+=d.spin*dt;d.age+=dt;if(d.x<-50)d.x=width+50;if(d.x>width+50)d.x=-50;if(d.y<-50)d.y=height+50;if(d.y>height+50)d.y=-50;drawDisc(d);}); bursts=bursts.filter(b=>b.life>0); bursts.forEach(b=>{b.life-=dt*2.4;b.r+=dt*130;ctx.strokeStyle=b.color;ctx.globalAlpha=Math.max(0,b.life);ctx.lineWidth=2;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.stroke();for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(b.x+Math.cos(a)*b.r,b.y+Math.sin(a)*b.r);ctx.lineTo(b.x+Math.cos(a)*(b.r+12),b.y+Math.sin(a)*(b.r+12));ctx.stroke();}ctx.globalAlpha=1;}); animationId=requestAnimationFrame(loop); }

async function enableCamera() { if(!navigator.mediaDevices?.getUserMedia){ trackingStatus.textContent='CAMERA UNAVAILABLE'; return; } try { const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false}); video.srcObject=stream; await video.play(); handMode=true; trackingStatus.textContent='LOADING HAND MODEL'; modeLabel.textContent='CAMERA / HAND'; document.querySelector('.session-readout').classList.add('is-live'); webcamPreview.classList.add('is-live'); document.getElementById('cameraButton').textContent='CAMERA ENABLED'; if(!window.Hands || !window.Camera){ trackingStatus.textContent='MODEL UNAVAILABLE'; return; } const hands=new Hands({locateFile:file=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`}); hands.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:.72,minTrackingConfidence:.68}); hands.onResults(onHands); camera=new Camera(video,{onFrame:async()=>{await hands.send({image:video});},width:640,height:480}); camera.start(); } catch(err) { trackingStatus.textContent=err.name==='NotAllowedError'?'CAMERA PERMISSION NEEDED':'CAMERA BLOCKED'; } }
const HAND_BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function clearHandWireframe() { handCtx.clearRect(0,0,handOverlay.width,handOverlay.height); }
function drawHandWireframe(lm, validPose) { clearHandWireframe(); const w=handOverlay.width,h=handOverlay.height; handCtx.lineWidth=2;handCtx.strokeStyle=validPose?'#c8f23e':'#ff6b35';handCtx.shadowBlur=8;handCtx.shadowColor=validPose?'#c8f23e':'#ff6b35'; HAND_BONES.forEach(([a,b])=>{handCtx.beginPath();handCtx.moveTo(lm[a].x*w,lm[a].y*h);handCtx.lineTo(lm[b].x*w,lm[b].y*h);handCtx.stroke();}); handCtx.shadowBlur=0; handCtx.fillStyle=validPose?'#e8eadb':'#ff6b35'; lm.forEach((point,index)=>{handCtx.beginPath();handCtx.arc(point.x*w,point.y*h,index===8?5:2.5,0,Math.PI*2);handCtx.fill();}); }
function distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function jointAngle(a,b,c) { const abx=a.x-b.x, aby=a.y-b.y, cbx=c.x-b.x, cby=c.y-b.y; const cosine=(abx*cbx+aby*cby)/(Math.hypot(abx,aby)*Math.hypot(cbx,cby)); return Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI; }
function smoothLandmarks(raw, now) { if(!smoothedLandmarks){ smoothedLandmarks=raw.map(point=>({x:point.x,y:point.y,z:point.z||0})); lastHandSeenAt=now; return smoothedLandmarks; } const dt=Math.min(120,Math.max(1,now-(lastHandSeenAt||now))); const alpha=1-Math.exp(-dt/70); smoothedLandmarks=raw.map((point,index)=>({x:smoothedLandmarks[index].x+(point.x-smoothedLandmarks[index].x)*alpha,y:smoothedLandmarks[index].y+(point.y-smoothedLandmarks[index].y)*alpha,z:smoothedLandmarks[index].z+((point.z||0)-smoothedLandmarks[index].z)*alpha})); lastHandSeenAt=now; return smoothedLandmarks; }
function setPostureState(state) { postureGuide.classList.toggle('is-valid',state==='valid'||state==='ready'); postureGuide.classList.toggle('is-ready',state==='ready'); postureReady=state==='ready'; startButton.disabled=!postureReady; if(state==='ready'){ postureMessage.textContent='POSTURE LOCKED — START ROUND'; } else if(state==='valid'){ postureMessage.textContent='HOLD STEADY — CALIBRATING'; } else if(state==='searching'){ postureMessage.textContent='POINT INDEX / CURL FINGERS'; } else { postureMessage.textContent='ENABLE CAMERA TO CALIBRATE'; } }
function looksLikeGun(lm) { const wrist=lm[0]; const indexExtended=jointAngle(lm[5],lm[6],lm[8])>125 || distance(lm[8],wrist)>distance(lm[6],wrist)*.98; const curled=(mcp,pip,tip)=>jointAngle(lm[mcp],lm[pip],lm[tip])<175 || distance(lm[tip],wrist)<distance(lm[pip],wrist)*1.45; const curledCount=[curled(9,10,12),curled(13,14,16),curled(17,18,20)].filter(Boolean).length; return indexExtended && curledCount>=2; }
function onHands(results) { const now=performance.now(); if(!results.multiHandLandmarks?.length){ if(lastHandSeenAt && now-lastHandSeenAt<500)return; clearHandWireframe(); previousHandX=null;previousHandY=null;previousRawX=null;previousRawY=null;validPoseSince=0;smoothedLandmarks=null;lastValidLandmarks=null;poseWasValid=false;setPostureState('searching'); trackingStatus.textContent='SHOW YOUR HAND'; crosshair.classList.remove('is-visible'); return; } const raw=results.multiHandLandmarks[0]; const lm=smoothLandmarks(raw,now); const poseDetected=looksLikeGun(raw)||looksLikeGun(lm); const validPose=poseDetected || (poseWasValid && now-lastValidPoseAt<500); if(validPose){ poseWasValid=true;lastValidPoseAt=now;lastValidLandmarks=lm; } else { poseWasValid=false;lastValidLandmarks=null; } drawHandWireframe(validPose?(lastValidLandmarks||lm):lm,validPose); if(!validPose){ validPoseSince=0;setPostureState('searching'); trackingStatus.textContent='POINT INDEX / CURL FINGERS'; crosshair.classList.remove('is-visible'); previousHandX=null;previousHandY=null;previousRawX=null;previousRawY=null; return; } if(!validPoseSince)validPoseSince=now; const stable=now-validPoseSince>900; setPostureState(stable?'ready':'valid'); trackingStatus.textContent=stable?'HAND TRACKING LIVE':'HOLD POSE STEADY'; const index=lm[8], rawIndex=raw[8]; const x=(1-index.x)*width,y=index.y*height; const rawX=(1-rawIndex.x)*width,rawY=rawIndex.y*height; const delta=Math.hypot(rawX-(previousRawX??rawX),rawY-(previousRawY??rawY)); const elapsed=now-(previousRawTime||now); const handSpeed=delta/Math.max(1,elapsed); const recoil=postureReady && previousRawX!==null && delta>48 && handSpeed>1.2 && now-lastShot>480; setPointer(x,y,recoil); previousHandX=x;previousHandY=y;previousRawX=rawX;previousRawY=rawY;previousRawTime=now; }
document.getElementById('cameraButton').addEventListener('click', enableCamera);
trackingStatus.textContent='POINTER READY';
setPostureState('idle');
