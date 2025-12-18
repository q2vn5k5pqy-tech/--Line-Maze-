// Wire Labyrinth (PWA/offline)
// Data-driven fixed dungeon with thick wireframe rendering.
// (c) You - generated scaffold

const $ = (id) => document.getElementById(id);

const screens = {
  title: $('screenTitle'),
  game: $('screenGame'),
  result: $('screenResult')
};

const modalSettings = $('modalSettings');
const modalItems = $('modalItems');

const canvas = $('viewCanvas');
const ctx = canvas.getContext('2d');

let DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

// --------- State ---------
const SAVE_KEY = 'wire_dungeon_save_v1';
const PREF_KEY = 'wire_dungeon_prefs_v1';

let rules, playerBase, floors, entitiesBase, enemiesDef, itemsDef, weaponsDef, facilitiesDef;
let i18n = { ja: {}, en: {} };

const DIRS = [
  { name:'N', dx:0, dy:-1 },
  { name:'E', dx:1, dy:0 },
  { name:'S', dx:0, dy:1 },
  { name:'W', dx:-1, dy:0 },
];

function nowMs(){ return Date.now(); }

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

function chebyshev(ax, ay, bx, by){
  return Math.max(Math.abs(ax-bx), Math.abs(ay-by));
}

// Line of sight along grid line (cardinal) from (x1,y1) to (x2,y2), inclusive of target cell.
// Only supports straight lines for our rules.
function hasLineOfSight(mapLines, x1, y1, x2, y2, doorOverlay){
  if (x1 === x2){
    const step = (y2 > y1) ? 1 : -1;
    for (let y = y1 + step; y !== y2; y += step){
      if (isWall(mapLines, x1, y, doorOverlay)) return false;
    }
    return true;
  }
  if (y1 === y2){
    const step = (x2 > x1) ? 1 : -1;
    for (let x = x1 + step; x !== x2; x += step){
      if (isWall(mapLines, x, y1, doorOverlay)) return false;
    }
    return true;
  }
  // not straight => treat as blocked
  return false;
}

function isWall(mapLines, x, y, doorOverlay){
  const key = `${x},${y}`;
  if (doorOverlay && (key in doorOverlay)){
    return doorOverlay[key] === '#';
  }
  const row = mapLines[y];
  return row?.[x] === '#';
}

function setOverlayTile(state, floorId, x, y, tile){
  state.doorOverlay[floorId] ||= {};
  state.doorOverlay[floorId][`${x},${y}`] = tile;
}

function getOverlayTile(state, floorId, x, y){
  return state.doorOverlay?.[floorId]?.[`${x},${y}`] ?? null;
}

// BFS one-step direction from enemy to player (4-neighbor)
function bfsNextStep(mapLines, sx, sy, tx, ty, doorOverlay, blockedSet){
  const W = rules.gridSize.w;
  const H = rules.gridSize.h;
  const q = [];
  const dist = Array.from({length:H}, () => Array(W).fill(-1));
  q.push([tx, ty]);
  dist[ty][tx] = 0;
  let head = 0;

  while (head < q.length){
    const [x,y] = q[head++];
    const d = dist[y][x];
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = x + dx, ny = y + dy;
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      if (dist[ny][nx] !== -1) continue;
      if (isWall(mapLines, nx, ny, doorOverlay)) continue;
      if (blockedSet && blockedSet.has(`${nx},${ny}`) && !(nx===sx && ny===sy)) continue;
      dist[ny][nx] = d + 1;
      q.push([nx,ny]);
    }
  }
  if (dist[sy][sx] <= 0) return null; // already at target or unreachable
  // pick neighbor of (sx,sy) with smallest dist
  let best = null;
  let bestD = 1e9;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx = sx + dx, ny = sy + dy;
    if (nx<0||ny<0||nx>=W||ny>=H) continue;
    if (isWall(mapLines, nx, ny, doorOverlay)) continue;
    if (blockedSet && blockedSet.has(`${nx},${ny}`)) continue;
    const d = dist[ny][nx];
    if (d >= 0 && d < bestD){
      bestD = d;
      best = { nx, ny };
    }
  }
  return best;
}

// --------- Audio (WebAudio synth) ---------
let audio = {
  ctx: null,
  bgmOn: true,
  seOn: true,
  bgmNode: null,
  bgmGain: null,
  started: false,
};

function ensureAudio(){
  if (audio.ctx) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.bgmGain = audio.ctx.createGain();
  audio.bgmGain.gain.value = 0.08;
  audio.bgmGain.connect(audio.ctx.destination);
}

async function resumeAudio(){
  ensureAudio();
  if (audio.ctx.state !== 'running'){
    try{ await audio.ctx.resume(); }catch{}
  }
  audio.started = true;
}

function stopBgm(){
  if (audio.bgmNode){
    try{ audio.bgmNode.stop(); }catch{}
    audio.bgmNode.disconnect();
    audio.bgmNode = null;
  }
}

function startBgm(patternId){
  if (!audio.bgmOn) return;
  ensureAudio();
  stopBgm();
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.0;
  osc.type = 'triangle';
  osc.connect(gain);
  gain.connect(audio.bgmGain);

  const base = (patternId === 1) ? 220 : (patternId === 2) ? 196 : (patternId === 3) ? 246 : 174;
  const seq = (patternId === 1) ? [0,4,7,12,7,4] :
              (patternId === 2) ? [0,3,7,10,7,3] :
              (patternId === 3) ? [0,5,7,11,7,5] :
                                  [0,2,5,9,5,2];
  const step = 0.22;

  const t0 = ctx.currentTime + 0.02;
  for (let i=0;i<64;i++){
    const t = t0 + i*step;
    const n = seq[i % seq.length];
    const f = base * Math.pow(2, n/12);
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.6, t+0.02);
    gain.gain.linearRampToValueAtTime(0.0, t+step-0.02);
  }
  osc.start(t0);
  osc.stop(t0 + 64*step);
  audio.bgmNode = osc;
  // loop by scheduling restart
  setTimeout(() => {
    if (state && state.mode === 'game'){
      startBgm(patternId);
    }
  }, Math.floor(64*step*1000) - 60);
}

function playSe(kind){
  if (!audio.seOn) return;
  ensureAudio();
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const t = ctx.currentTime + 0.001;
  const presets = {
    step: { type:'square', f1:180, f2:120, dur:0.06 },
    hit:  { type:'sawtooth', f1:420, f2:180, dur:0.10 },
    miss: { type:'triangle', f1:160, f2:90, dur:0.08 },
    open: { type:'triangle', f1:540, f2:720, dur:0.10 },
    coin: { type:'square', f1:700, f2:900, dur:0.08 },
    turn: { type:'triangle', f1:220, f2:180, dur:0.06 },
    rest: { type:'sine', f1:320, f2:480, dur:0.12 },
    die:  { type:'sawtooth', f1:220, f2:60, dur:0.40 },
    win:  { type:'triangle', f1:392, f2:784, dur:0.35 },
  };
  const p = presets[kind] || presets.miss;
  osc.type = p.type;
  osc.frequency.setValueAtTime(p.f1, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.f2), t + p.dur);
  gain.gain.setValueAtTime(0.0, t);
  gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
  gain.gain.linearRampToValueAtTime(0.0, t + p.dur);
  osc.start(t);
  osc.stop(t + p.dur + 0.02);
}

// --------- Preferences ---------
let prefs = {
  lang: 'ja',
  bgmOn: true,
  seOn: true,
  invertSwipe: false
};

function loadPrefs(){
  try{
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    prefs = { ...prefs, ...p };
  }catch{}
}

function savePrefs(){
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

// --------- Localization ---------
function t(key){
  const dict = i18n[prefs.lang] || i18n.ja;
  return dict[key] ?? i18n.ja[key] ?? key;
}

function applyI18nStatic(){
  $('brandTitle').textContent = t('app.title');
  $('btnSettings').textContent = t('menu.settings');
  $('titleText').textContent = t('app.title');
  $('btnNew').textContent = t('menu.new');
  $('btnContinue').textContent = t('menu.continue');
  $('btnReset').textContent = 'セーブ消去 / Reset';
  $('lblFloor').textContent = t('ui.floor');
  $('lblHP').textContent = t('ui.hp');
  $('lblMP').textContent = t('ui.mp');
  $('lblGold').textContent = t('ui.gold');
  $('lblWeapon').textContent = t('ui.weapon');
  $('btnForward').textContent = t('ui.forward');
  $('btnBack').textContent = t('ui.back');
  $('btnMelee').textContent = t('ui.melee');
  $('btnRanged').textContent = t('ui.ranged');
  $('btnInteract').textContent = t('ui.interact');
  $('btnItems').textContent = t('ui.items');
  $('btnSave').textContent = t('ui.save');
  $('lblLog').textContent = t('ui.log');

  $('settingsTitle').textContent = t('menu.settings');
  $('btnCloseSettings').textContent = t('ui.close');
  $('lblLang').textContent = t('ui.lang');
  $('lblAudio').textContent = t('ui.audio');
  $('lblBgm').textContent = t('ui.bgm');
  $('lblSe').textContent = t('ui.se');
  $('lblControls').textContent = t('ui.controls');
  $('lblInvert').textContent = t('ui.swipeInvert');

  $('itemsTitle').textContent = t('ui.items');
  $('btnCloseItems').textContent = t('ui.close');

  $('resultTitle').textContent = t('ui.result');
  $('lblResFloor').textContent = t('result.floor');
  $('lblResTurns').textContent = t('result.turns');
  $('lblResTime').textContent = t('result.time');
  $('lblResGold').textContent = t('result.gold');
  $('btnRetry').textContent = t('ui.retry');
  $('btnBackTitle').textContent = t('ui.backToTitle');
}

// --------- Game runtime state ---------
let state = null;

function freshState(){
  const f0 = floors[0].id;
  const p = deepCopy(playerBase);
  return {
    mode: 'game',
    startedAt: nowMs(),
    elapsedMs: 0,
    turns: 0,
    floorIndex: 0,
    player: {
      x: floors[0].start.x,
      y: floors[0].start.y,
      dir: floors[0].start.dir,
      hp: p.maxHp,
      mp: p.maxMp,
      maxHp: p.maxHp,
      maxMp: p.maxMp,
      atk: p.atk,
      def: p.def,
      acc: p.acc,
      eva: p.eva,
      gold: p.startGold,
      weapon: p.startWeapon,
      ammo: { ...(p.startAmmo || {}) },
      items: (p.startItems || []).map(it => ({ id: it.id, qty: it.qty })),
    },
    // entity states
    enemyStates: {}, // by entityId: {hp, alive, aware}
    chestOpened: {}, // entityId: true
    facilityUses: {}, // floorId: { facilityId: count }
    doorOverlay: {}, // floorId: {"x,y": "#/."}
    logs: []
  };
}

function hasSave(){
  return !!localStorage.getItem(SAVE_KEY);
}

function saveGame(){
  if (!state) return;
  const s = deepCopy(state);
  s.elapsedMs = (nowMs() - s.startedAt);
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  log(t('msg.saved'));
}

function loadGame(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s;
  }catch{
    return null;
  }
}

function resetSave(){
  localStorage.removeItem(SAVE_KEY);
}

// --------- Entities helpers ---------
function currentFloorId(){ return floors[state.floorIndex].id; }

function entitiesOnFloor(floorId){
  return entitiesBase.filter(e => e.floor === floorId);
}

function getEntityAt(floorId, x, y){
  return entitiesOnFloor(floorId).find(e => e.x === x && e.y === y);
}

function getEnemyEntities(floorId){
  return entitiesOnFloor(floorId).filter(e => e.type === 'enemy');
}

function isBlockedByEnemy(floorId, x, y){
  const enemies = getEnemyEntities(floorId);
  for (const e of enemies){
    const st = state.enemyStates[e.id] || initEnemyState(e);
    if (st.alive && e.x === x && e.y === y) return true;
  }
  return false;
}

function initEnemyState(e){
  const def = enemiesDef[e.enemyType];
  const st = { hp: def.hp, alive: true, aware: false };
  state.enemyStates[e.id] = st;
  return st;
}

function getDoorOverlayForFloor(floorId){
  return state.doorOverlay?.[floorId] || null;
}

function floorMapLines(floorId){
  return floorsById[floorId].mapLines;
}

let floorsById = {};

// --------- Combat math (simple, adjustable in weapons/enemies files) ---------
function hitChance(attAcc, defEva){
  // base 0.75 + (acc-eva)*0.05 clamped
  return clamp(0.75 + (attAcc - defEva)*0.05, 0.10, 0.95);
}
function rollHit(attAcc, defEva){
  return Math.random() < hitChance(attAcc, defEva);
}
function rollDamage(attAtk, defDef, base=0){
  const jitter = (Math.random()<0.33)?-1:(Math.random()<0.66)?0:1;
  return Math.max(1, base + attAtk - defDef + jitter);
}

// --------- Input / UI ---------
function showScreen(which){
  for (const k of Object.keys(screens)){
    screens[k].classList.toggle('hidden', k !== which);
  }
}

function showModal(modal, on=true){
  modal.classList.toggle('hidden', !on);
}

function updateWeaponSelect(){
  const sel = $('weaponSelect');
  sel.innerHTML = '';
  for (const [id, w] of Object.entries(weaponsDef)){
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${w.name[prefs.lang] || w.name.ja || id}`;
    sel.appendChild(opt);
  }
  sel.value = state.player.weapon;
}

function updateHUD(){
  const f = floors[state.floorIndex];
  $('hudFloor').textContent = `${f.id.toUpperCase()} ${f.name[prefs.lang]}`;
  $('hudHP').textContent = `${state.player.hp}/${state.player.maxHp}`;
  $('hudMP').textContent = `${state.player.mp}/${state.player.maxMp}`;
  $('hudGold').textContent = `${state.player.gold}`;
  $('compass').textContent = DIRS[state.player.dir].name;
  updateWeaponSelect();
  applyTheme();
  updateInteractButton();
}

function applyTheme(){
  const f = floors[state.floorIndex];
  document.documentElement.style.setProperty('--bg', f.bgColor);
  document.documentElement.style.setProperty('--accent', f.accent);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', f.bgColor);
  document.body.style.background = themeBackgroundCss(f.theme);
}

function themeBackgroundCss(theme){
  if (theme === 'meadow'){
    return `radial-gradient(1200px 600px at 50% 20%, rgba(255,255,255,0.08), transparent 60%), 
            radial-gradient(900px 500px at 10% 80%, rgba(80,180,90,0.18), transparent 60%),
            radial-gradient(900px 500px at 90% 70%, rgba(70,160,80,0.14), transparent 60%),
            var(--bg)`;
  }
  if (theme === 'cavern'){
    return `radial-gradient(1200px 600px at 50% 10%, rgba(255,255,255,0.06), transparent 60%),
            radial-gradient(900px 500px at 20% 80%, rgba(130,150,170,0.10), transparent 60%),
            radial-gradient(900px 500px at 90% 70%, rgba(80,90,110,0.10), transparent 60%),
            var(--bg)`;
  }
  if (theme === 'volcano'){
    return `radial-gradient(1200px 600px at 50% 15%, rgba(255,255,255,0.06), transparent 60%),
            radial-gradient(900px 500px at 20% 80%, rgba(255,110,40,0.16), transparent 60%),
            radial-gradient(900px 500px at 90% 70%, rgba(240,60,40,0.12), transparent 60%),
            var(--bg)`;
  }
  return `radial-gradient(1200px 600px at 50% 15%, rgba(255,255,255,0.06), transparent 60%),
          radial-gradient(900px 500px at 20% 80%, rgba(190,140,255,0.14), transparent 60%),
          radial-gradient(900px 500px at 90% 70%, rgba(120,70,200,0.12), transparent 60%),
          var(--bg)`;
}

function log(msg){
  state.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  // keep last 120
  if (state.logs.length > 120) state.logs.shift();
  $('logBody').textContent = state.logs.slice(-80).join('\n');
  $('logBody').scrollTop = $('logBody').scrollHeight;
}

function updateInteractButton(){
  const btn = $('btnInteract');
  const info = getInteractableAhead();
  btn.disabled = !info;
  if (info){
    btn.textContent = `${t('ui.interact')}`;
  }else{
    btn.textContent = t('ui.interact');
  }
}

function getInteractableAhead(){
  const floorId = currentFloorId();
  const dir = DIRS[state.player.dir];
  const tx = state.player.x + dir.dx;
  const ty = state.player.y + dir.dy;
  const e = getEntityAt(floorId, tx, ty);
  if (!e) return null;
  // enemy not interactable
  if (e.type === 'enemy') return null;
  // door is handled as map overlay, but entity exists
  if (e.type === 'door'){
    const tile = getOverlayTile(state, floorId, e.x, e.y) || e.closedTile;
    if (tile === '#') return e; // closed door
    return null;
  }
  return e;
}

// --------- Rendering (thick wireframe, to wall distance) ---------
function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.floor(rect.width * DPR);
  canvas.height = Math.floor(rect.height * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  render();
}

function render(){
  if (!state || state.mode !== 'game') return;
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;

  // background fill
  const f = floors[state.floorIndex];
  ctx.clearRect(0,0,w,h);
  // subtle haze
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0,0,w,h);

  // wire line style (thick)
  ctx.strokeStyle = 'rgba(245,245,245,0.95)';
  ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const floorId = currentFloorId();
  const mapLines = floorMapLines(floorId);
  const doorOverlay = getDoorOverlayForFloor(floorId);

  // compute distance until wall in front
  const dir = DIRS[state.player.dir];
  const maxDist = rules.maxRayDistance;
  let dist = 0;
  for (let i=1;i<=maxDist;i++){
    const nx = state.player.x + dir.dx*i;
    const ny = state.player.y + dir.dy*i;
    if (isWall(mapLines, nx, ny, doorOverlay)){
      dist = i;
      break;
    }
    // if outside, treat as wall (outer walls exist anyway)
    if (nx<=0||ny<=0||nx>=rules.gridSize.w-1||ny>=rules.gridSize.h-1){
      dist = i;
      break;
    }
  }
  if (dist === 0) dist = 1; // should not happen due to outer wall

  // perspective mapping: depth k => rectangle inset
  const margin = 26;
  const cx = w/2, cy = h/2;
  const topBase = margin;
  const bottomBase = h - margin;
  const leftBase = margin;
  const rightBase = w - margin;

  // We'll draw frames from 0..dist
  // scale factor decreases with depth (nonlinear)
  function insetFor(k){
    // k=0 -> 0 inset; k increases -> more inset
    const t = k / (dist+0.7);
    // ease
    const e = 1 - Math.pow(1 - t, 1.6);
    const maxInsetX = (w*0.42);
    const maxInsetY = (h*0.38);
    return { ix: e * maxInsetX, iy: e * maxInsetY };
  }

  const frames = [];
  for (let k=0;k<=dist;k++){
    const {ix, iy} = insetFor(k);
    frames.push({
      l: leftBase + ix,
      r: rightBase - ix,
      t: topBase + iy,
      b: bottomBase - iy
    });
  }

  // draw corridor edges for each segment, showing openings by omitting wall segments
  for (let k=0;k<dist;k++){
    const a = frames[k];
    const b = frames[k+1];

    // Determine cell at depth k+1 (the slice position)
    const sx = state.player.x + dir.dx*(k+1);
    const sy = state.player.y + dir.dy*(k+1);

    // left/right directions relative to facing
    const leftDir = DIRS[(state.player.dir + 3) % 4];
    const rightDir = DIRS[(state.player.dir + 1) % 4];

    // wall presence at slice
    const leftWall = isWall(mapLines, sx + leftDir.dx, sy + leftDir.dy, doorOverlay);
    const rightWall = isWall(mapLines, sx + rightDir.dx, sy + rightDir.dy, doorOverlay);

    // floor/ceiling edges (always draw segment frames lightly)
    ctx.beginPath();
    // top edge segment
    ctx.moveTo(a.l, a.t); ctx.lineTo(a.r, a.t);
    ctx.moveTo(b.l, b.t); ctx.lineTo(b.r, b.t);
    // bottom
    ctx.moveTo(a.l, a.b); ctx.lineTo(a.r, a.b);
    ctx.moveTo(b.l, b.b); ctx.lineTo(b.r, b.b);
    ctx.stroke();

    // left wall (if wall, connect frames)
    if (leftWall){
      ctx.beginPath();
      ctx.moveTo(a.l, a.t); ctx.lineTo(b.l, b.t);
      ctx.moveTo(a.l, a.b); ctx.lineTo(b.l, b.b);
      ctx.stroke();
    }
    // right wall
    if (rightWall){
      ctx.beginPath();
      ctx.moveTo(a.r, a.t); ctx.lineTo(b.r, b.t);
      ctx.moveTo(a.r, a.b); ctx.lineTo(b.r, b.b);
      ctx.stroke();
    }
  }

  // draw the final wall plane at depth=dist
  const wall = frames[dist];
  ctx.beginPath();
  ctx.rect(wall.l, wall.t, wall.r-wall.l, wall.b-wall.t);
  ctx.stroke();

  // detect first visible entity in front line before wall (enemies/chests/stairs/goal/door)
  const vis = firstVisibleAhead(mapLines, doorOverlay, dist);
  if (vis){
    const k = vis.depth;
    const f0 = frames[k-1] || frames[0];
    const f1 = frames[k] || frames[dist];
    const mx = (f1.l + f1.r)/2;
    const my = (f1.t + f1.b)/2;

    // draw marker (simple)
    ctx.save();
    ctx.lineWidth = 4.5;
    if (vis.kind === 'enemy'){
      ctx.strokeStyle = 'rgba(255,120,120,0.95)';
      ctx.beginPath();
      ctx.moveTo(mx-10, my); ctx.lineTo(mx+10, my);
      ctx.moveTo(mx, my-10); ctx.lineTo(mx, my+10);
      ctx.stroke();
    }else if (vis.kind === 'chest'){
      ctx.strokeStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath();
      ctx.rect(mx-12, my-10, 24, 20);
      ctx.stroke();
    }else if (vis.kind === 'stairs'){
      ctx.strokeStyle = 'rgba(160,210,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(mx-14, my+10); ctx.lineTo(mx+14, my+10);
      ctx.moveTo(mx-10, my+4); ctx.lineTo(mx+10, my+4);
      ctx.moveTo(mx-6, my-2); ctx.lineTo(mx+6, my-2);
      ctx.stroke();
    }else if (vis.kind === 'goal'){
      ctx.strokeStyle = 'rgba(200,160,255,0.95)';
      ctx.beginPath();
      ctx.arc(mx, my, 14, 0, Math.PI*2);
      ctx.stroke();
    }else if (vis.kind === 'door'){
      ctx.strokeStyle = 'rgba(240,240,240,0.95)';
      ctx.beginPath();
      ctx.rect(mx-10, my-14, 20, 28);
      ctx.moveTo(mx, my-14); ctx.lineTo(mx, my+14);
      ctx.stroke();
    }else if (vis.kind === 'facility'){
      ctx.strokeStyle = 'rgba(155,227,127,0.95)';
      ctx.beginPath();
      ctx.moveTo(mx-14,my+12); ctx.lineTo(mx,my-12); ctx.lineTo(mx+14,my+12); ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function firstVisibleAhead(mapLines, doorOverlay, distToWall){
  const floorId = currentFloorId();
  const dir = DIRS[state.player.dir];
  for (let k=1;k<distToWall;k++){
    const x = state.player.x + dir.dx*k;
    const y = state.player.y + dir.dy*k;

    // door closed is wall already, so won't be in this loop; but door might be placed before wall (closed)
    const e = getEntityAt(floorId, x, y);
    if (!e) continue;
    if (e.type === 'enemy'){
      const st = state.enemyStates[e.id] || initEnemyState(e);
      if (!st.alive) continue;
      return { kind:'enemy', depth:k };
    }
    if (e.type === 'chest'){
      if (state.chestOpened[e.id]) continue;
      return { kind:'chest', depth:k };
    }
    if (e.type === 'stairs'){
      return { kind:'stairs', depth:k };
    }
    if (e.type === 'goal'){
      return { kind:'goal', depth:k };
    }
    if (e.type === 'facility'){
      return { kind:'facility', depth:k };
    }
    if (e.type === 'door'){
      // if open, not visible; if closed, it would be wall; still show at depth if we want
      const tile = getOverlayTile(state, floorId, e.x, e.y) || e.closedTile;
      if (tile === '#') return { kind:'door', depth:k };
    }
  }
  return null;
}

// --------- Turn system ---------
function spendTurn(){
  state.turns += 1;
  updateEnemies();
  autoSave();
}

function autoSave(){
  // save silently
  const s = deepCopy(state);
  s.elapsedMs = (nowMs() - s.startedAt);
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}

function tryMove(deltaForward){
  // deltaForward: +1 forward, -1 back
  const floorId = currentFloorId();
  const mapLines = floorMapLines(floorId);
  const doorOverlay = getDoorOverlayForFloor(floorId);
  const dir = DIRS[state.player.dir];
  const dx = dir.dx * deltaForward;
  const dy = dir.dy * deltaForward;
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;

  // wall?
  if (isWall(mapLines, nx, ny, doorOverlay)){
    log(t('msg.cannotMoveWall'));
    playSe('miss');
    // no turn consumed (your rule)
    updateHUD();
    render();
    return;
  }
  // enemy blocks movement
  if (isBlockedByEnemy(floorId, nx, ny)){
    log(t('msg.cannotMoveWall'));
    playSe('miss');
    // treat as blocked; consume? not specified; we keep as no-turn like wall bump (consistent with "不発")
    updateHUD();
    render();
    return;
  }
  state.player.x = nx;
  state.player.y = ny;
  playSe('step');
  // movement consumes turn (normal), since it succeeded
  spendTurn();
  // triggers after enemy update? We do trigger checks after both phases -> keep stable: check immediate after move and after enemy move.
  checkTriggersAfterAll();
  updateHUD();
  render();
}

function rotate(delta){
  state.player.dir = (state.player.dir + delta + 4) % 4;
  playSe('turn');
  // rotation consumes turn (MVP): yes, to avoid free scouting
  spendTurn();
  updateHUD();
  render();
}

function enemyOccupancySet(floorId){
  const set = new Set();
  for (const e of getEnemyEntities(floorId)){
    const st = state.enemyStates[e.id] || initEnemyState(e);
    if (st.alive) set.add(`${e.x},${e.y}`);
  }
  return set;
}

function updateEnemies(){
  const floorId = currentFloorId();
  const mapLines = floorMapLines(floorId);
  const doorOverlay = getDoorOverlayForFloor(floorId);

  const enemies = getEnemyEntities(floorId);
  // random order
  const order = enemies.slice().sort(() => Math.random() - 0.5);

  // update awareness for all enemies (as per "全てシミュレート")
  for (const e of enemies){
    const st = state.enemyStates[e.id] || initEnemyState(e);
    if (!st.alive) continue;

    // already aware stays aware
    if (st.aware) continue;

    const d = chebyshev(e.x, e.y, state.player.x, state.player.y);
    if (d <= rules.chebyshevSight){
      // require LOS; for LOS we accept straight lines only. If not straight, treat as blocked.
      const los = hasLineOfSight(mapLines, e.x, e.y, state.player.x, state.player.y, doorOverlay);
      if (los){
        st.aware = true;
        log(t('msg.enemyAwake'));
      }
    }
  }

  // occupancy used to prevent stacking
  const blocked = enemyOccupancySet(floorId);

  // each aware enemy acts
  for (const e of order){
    const st = state.enemyStates[e.id] || initEnemyState(e);
    if (!st.alive) continue;
    if (!st.aware) continue;

    // if adjacent => attack
    const d = chebyshev(e.x, e.y, state.player.x, state.player.y);
    if (d <= 1){
      // attack
      const def = enemiesDef[e.enemyType];
      const hit = rollHit(def.acc, state.player.eva);
      if (hit){
        const dmg = rollDamage(def.atk, state.player.def, 0);
        state.player.hp -= dmg;
        log(`${def.name[prefs.lang] || def.name.ja}: ${t('msg.enemyHit')} -${dmg}`);
        playSe('hit');
      }else{
        log(`${def.name[prefs.lang] || def.name.ja}: ${t('msg.miss')}`);
        playSe('miss');
      }
      if (state.player.hp <= 0){
        state.player.hp = 0;
        onDeath();
        return;
      }
      continue;
    }

    // move one step toward player (BFS)
    blocked.delete(`${e.x},${e.y}`); // allow moving from its own cell
    const step = bfsNextStep(mapLines, e.x, e.y, state.player.x, state.player.y, doorOverlay, blocked);
    if (step){
      // don't step onto player cell
      if (step.nx === state.player.x && step.ny === state.player.y){
        // skip
      }else{
        e.x = step.nx;
        e.y = step.ny;
        blocked.add(`${e.x},${e.y}`);
      }
    }else{
      blocked.add(`${e.x},${e.y}`);
    }
  }
}

function checkTriggersAfterAll(){
  // after both player and enemy moves in a turn, check enemy stepping on triggers
  const floorId = currentFloorId();
  const onFloor = entitiesOnFloor(floorId);
  const mapLines = floorMapLines(floorId);
  const doorOverlay = getDoorOverlayForFloor(floorId);

  const triggers = onFloor.filter(e => e.type === 'trigger');
  if (triggers.length === 0) return;

  // build enemy positions
  const enemies = getEnemyEntities(floorId);
  for (const tr of triggers){
    for (const en of enemies){
      const st = state.enemyStates[en.id] || initEnemyState(en);
      if (!st.alive) continue;
      if (en.x === tr.x && en.y === tr.y){
        if (tr.triggerType === 'openDoor'){
          const doorId = tr.targetDoorId;
          const door = onFloor.find(e => e.id === doorId);
          if (door){
            const key = `${door.x},${door.y}`;
            const already = getOverlayTile(state, floorId, door.x, door.y) || door.initial === 'open' ? door.openTile : door.closedTile;
            // if closed => open
            const curTile = getOverlayTile(state, floorId, door.x, door.y) || door.closedTile;
            if (curTile === '#'){
              setOverlayTile(state, floorId, door.x, door.y, '.');
              log(t('msg.secretDoor'));
              playSe('open');
            }
          }
        }
      }
    }
  }
}

// --------- Player actions ---------
function melee(){
  const floorId = currentFloorId();
  const dir = DIRS[state.player.dir];
  const tx = state.player.x + dir.dx;
  const ty = state.player.y + dir.dy;
  const enemy = getEnemyEntities(floorId).find(e => e.x === tx && e.y === ty);
  if (!enemy){
    log(t('msg.meleeWhiff'));
    playSe('miss');
    // consume turn (confirmed)
    spendTurn();
    checkTriggersAfterAll();
    updateHUD();
    render();
    return;
  }
  const st = state.enemyStates[enemy.id] || initEnemyState(enemy);
  const def = enemiesDef[enemy.enemyType];
  const hit = rollHit(state.player.acc, def.eva);
  if (hit){
    const dmg = rollDamage(state.player.atk, def.def, 0);
    st.hp -= dmg;
    st.aware = true;
    log(`${t('msg.hit')} ${def.name[prefs.lang] || def.name.ja} -${dmg}`);
    playSe('hit');
    if (st.hp <= 0){
      st.alive = false;
      st.hp = 0;
      state.player.gold += def.gold || 0;
      log(`+${def.gold || 0}${t('ui.gold')}`);
      playSe('coin');
      // win if boss dead
      if (def.boss){
        onWin();
        return;
      }
    }
  }else{
    log(t('msg.miss'));
    playSe('miss');
    st.aware = true;
  }
  spendTurn();
  checkTriggersAfterAll();
  updateHUD();
  render();
}

function ranged(){
  const floorId = currentFloorId();
  const mapLines = floorMapLines(floorId);
  const doorOverlay = getDoorOverlayForFloor(floorId);
  const w = weaponsDef[state.player.weapon];
  if (!w) return;

  // resource check
  if (w.ammoType === 'ammo'){
    const key = w.ammoKey;
    const cur = state.player.ammo[key] || 0;
    if (cur <= 0){
      log(t('msg.rangedNoTarget'));
      playSe('miss');
      // still consumes turn (confirmed)
      spendTurn();
      checkTriggersAfterAll();
      updateHUD();
      render();
      return;
    }
    state.player.ammo[key] = cur - 1;
  }
  if (w.ammoType === 'mp'){
    if (state.player.mp < w.mpCost){
      log(t('msg.rangedNoTarget'));
      playSe('miss');
      spendTurn();
      checkTriggersAfterAll();
      updateHUD();
      render();
      return;
    }
    state.player.mp -= w.mpCost;
  }

  const dir = DIRS[state.player.dir];
  const range = w.range;
  let hitEnemy = null;
  let hitDist = null;

  for (let i=1; i<=range; i++){
    const x = state.player.x + dir.dx*i;
    const y = state.player.y + dir.dy*i;
    if (isWall(mapLines, x, y, doorOverlay)) break;
    const enemy = getEnemyEntities(floorId).find(e => e.x === x && e.y === y);
    if (enemy){
      hitEnemy = enemy; hitDist = i;
      break;
    }
  }

  if (!hitEnemy){
    log(t('msg.rangedNoTarget'));
    playSe('miss');
    // consumes turn anyway
    spendTurn();
    checkTriggersAfterAll();
    updateHUD();
    render();
    return;
  }

  // apply hit
  const st = state.enemyStates[hitEnemy.id] || initEnemyState(hitEnemy);
  const def = enemiesDef[hitEnemy.enemyType];

  const hit = rollHit(state.player.acc + (w.hitBonus||0), def.eva);
  if (hit){
    const dmg = rollDamage(state.player.atk, def.def, w.baseDamage||0);
    st.hp -= dmg;
    st.aware = true; // hit wakes enemy
    log(`${t('msg.hit')} ${def.name[prefs.lang] || def.name.ja} -${dmg}`);
    playSe('hit');
    if (st.hp <= 0){
      st.alive = false;
      st.hp = 0;
      state.player.gold += def.gold || 0;
      log(`+${def.gold || 0}${t('ui.gold')}`);
      playSe('coin');
      if (def.boss){
        onWin();
        return;
      }
    }
  }else{
    log(t('msg.miss'));
    playSe('miss');
    // miss does NOT wake by your rule? you said "ヒットした時" only, so keep aware false unless already.
  }

  spendTurn();
  checkTriggersAfterAll();
  updateHUD();
  render();
}

function interact(){
  const e = getInteractableAhead();
  if (!e) return;

  if (e.type === 'chest'){
    if (state.chestOpened[e.id]){
      log(t('msg.alreadyOpened'));
      return;
    }
    state.chestOpened[e.id] = true;
    log(t('msg.openChest'));
    playSe('open');
    for (const c of e.contents || []){
      if (c.kind === 'gold'){
        state.player.gold += c.amount;
        log(`+${c.amount}${t('ui.gold')}`);
        playSe('coin');
      }
      if (c.kind === 'item'){
        addItem(c.id, 1);
        log(`+${itemsDef[c.id]?.name?.[prefs.lang] || itemsDef[c.id]?.name?.ja || c.id}`);
      }
    }
    // interacting does not consume a turn by default; but to keep roguelike tension, we can consume turn.
    // Not specified => We choose "consume turn" to avoid free looting.
    spendTurn();
    checkTriggersAfterAll();
    updateHUD();
    render();
    return;
  }

  if (e.type === 'stairs'){
    // consume turn on use
    if (e.dir === 'down'){
      if (state.floorIndex < floors.length - 1){
        state.floorIndex += 1;
        // place player at stairsUp position of new floor
        const nf = floors[state.floorIndex];
        state.player.x = nf.stairsUp.x;
        state.player.y = nf.stairsUp.y;
        state.player.dir = nf.start.dir;
        // refill MP (magic) on floor change (your rule)
        state.player.mp = state.player.maxMp;
        log(t('msg.stairsDown'));
        log(t('msg.mpRefillFloor'));
        playSe('step');
        startBgm(nf.musicPattern);
      }
    }else{
      if (state.floorIndex > 0){
        state.floorIndex -= 1;
        const pf = floors[state.floorIndex];
        // place at stairsDown position of previous floor
        state.player.x = pf.stairsDown.x;
        state.player.y = pf.stairsDown.y;
        state.player.dir = pf.start.dir;
        state.player.mp = state.player.maxMp;
        log(t('msg.stairsUp'));
        log(t('msg.mpRefillFloor'));
        playSe('step');
        startBgm(pf.musicPattern);
      }
    }
    spendTurn();
    checkTriggersAfterAll();
    updateHUD();
    render();
    return;
  }

  if (e.type === 'goal'){
    // win without boss optional; but boss exists; still allow goal win
    onWin();
    return;
  }

  if (e.type === 'door'){
    // if closed, do nothing (needs trigger)
    log(t('msg.cannotMoveWall'));
    return;
  }

  if (e.type === 'facility'){
    useFacility(e);
    return;
  }
}

function addItem(itemId, qty){
  const it = state.player.items.find(x => x.id === itemId);
  if (it) it.qty += qty;
  else state.player.items.push({ id: itemId, qty });
}

function useFacility(ent){
  const floorId = currentFloorId();
  state.facilityUses[floorId] ||= {};
  const key = ent.id;
  const used = state.facilityUses[floorId][key] || 0;
  const def = facilitiesDef[ent.facilityType];
  const cost = def.baseCost + def.costIncrement * used;

  if (state.player.gold < cost){
    log(t('msg.notEnoughGold'));
    playSe('miss');
    return;
  }
  state.player.gold -= cost;
  state.facilityUses[floorId][key] = used + 1;

  if (ent.facilityType === 'inn'){
    state.player.hp = state.player.maxHp;
    state.player.mp = state.player.maxMp;
    // restore ammo (bow)
    for (const w of Object.values(weaponsDef)){
      if (w.ammoType === 'ammo'){
        state.player.ammo[w.ammoKey] = w.ammoMax;
      }
    }
    log(`${t('msg.rested')} (-${cost}${t('ui.gold')}, x${used+1})`);
    playSe('rest');
  }else if (ent.facilityType === 'supply'){
    // ammo only
    for (const w of Object.values(weaponsDef)){
      if (w.ammoType === 'ammo'){
        state.player.ammo[w.ammoKey] = w.ammoMax;
      }
    }
    log(`${t('msg.supplied')} (-${cost}${t('ui.gold')}, x${used+1})`);
    playSe('rest');
  }
  // facility use consumes a turn (keeps tension)
  spendTurn();
  checkTriggersAfterAll();
  updateHUD();
  render();
}

// --------- Items UI ---------
function openItems(){
  const body = $('itemsBody');
  body.innerHTML = '';
  for (const it of state.player.items){
    const def = itemsDef[it.id];
    const name = def?.name?.[prefs.lang] || def?.name?.ja || it.id;
    const desc = def?.desc?.[prefs.lang] || def?.desc?.ja || '';
    const row = document.createElement('div');
    row.className = 'item';
    const left = document.createElement('div');
    left.innerHTML = `<div class="name">${escapeHtml(name)}</div><div class="desc">${escapeHtml(desc)}</div>`;
    const right = document.createElement('div');
    right.innerHTML = `<div class="qty">x${it.qty}</div>`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Use';
    btn.disabled = !(def?.type === 'consumable');
    btn.onclick = () => {
      if (def?.type === 'consumable'){
        useConsumable(it.id);
      }
    };
    right.appendChild(btn);
    row.appendChild(left);
    row.appendChild(right);
    body.appendChild(row);
  }
  showModal(modalItems, true);
}

function useConsumable(itemId){
  const inv = state.player.items.find(x => x.id === itemId);
  if (!inv || inv.qty <= 0) return;
  const def = itemsDef[itemId];
  if (def.healHp){
    const before = state.player.hp;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + def.healHp);
    const healed = state.player.hp - before;
    log(`+HP ${healed}`);
    playSe('rest');
  }
  inv.qty -= 1;
  if (inv.qty <= 0){
    state.player.items = state.player.items.filter(x => x.qty > 0);
  }
  // using item consumes a turn (typical)
  spendTurn();
  checkTriggersAfterAll();
  updateHUD();
  render();
  openItems(); // refresh list
}

// --------- End states ---------
function onDeath(){
  log(t('msg.youDied'));
  playSe('die');
  stopBgm();
  state.mode = 'result';
  // show result
  const elapsed = nowMs() - state.startedAt;
  $('resFloor').textContent = floors[state.floorIndex].id.toUpperCase();
  $('resTurns').textContent = `${state.turns}`;
  $('resTime').textContent = fmtTime(elapsed);
  $('resGold').textContent = `${state.player.gold}`;
  showScreen('result');
}

function onWin(){
  log(t('msg.youWin'));
  playSe('win');
  stopBgm();
  state.mode = 'result';
  const elapsed = nowMs() - state.startedAt;
  $('resFloor').textContent = floors[state.floorIndex].id.toUpperCase();
  $('resTurns').textContent = `${state.turns}`;
  $('resTime').textContent = fmtTime(elapsed);
  $('resGold').textContent = `${state.player.gold}`;
  showScreen('result');
}

function fmtTime(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const r = s%60;
  return `${m}:${String(r).padStart(2,'0')}`;
}

// --------- Utilities ---------
function escapeHtml(s){
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

// --------- Swipe handling (turn) ---------
let touchStartX = 0;
let touchStartY = 0;
let touchActive = false;

function bindSwipe(){
  const view = document.querySelector('.view');
  view.addEventListener('touchstart', (e) => {
    if (!state || state.mode !== 'game') return;
    touchActive = true;
    const t0 = e.changedTouches[0];
    touchStartX = t0.clientX;
    touchStartY = t0.clientY;
  }, { passive: true });

  view.addEventListener('touchend', (e) => {
    if (!touchActive || !state || state.mode !== 'game') return;
    touchActive = false;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - touchStartX;
    const dy = t0.clientY - touchStartY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;

    // default: swipe direction = your spec (left->right means look left).
    // implement by delta = (dx>0 ? -1 : +1), invert option flips.
    let delta = (dx > 0) ? -1 : +1;
    if (prefs.invertSwipe) delta *= -1;

    // rotate with short fade (CSS overlay)
    const overlay = $('viewOverlay');
    overlay.style.transition = 'opacity 140ms linear';
    overlay.style.opacity = '0.92';
    setTimeout(() => {
      rotate(delta);
      overlay.style.opacity = '0.0';
      setTimeout(() => overlay.style.opacity = '', 160);
    }, 60);

  }, { passive: true });
}

// --------- Init / wiring ---------
async function loadAllData(){
  const fetchJson = async (p) => (await fetch(p)).json();

  [rules, playerBase, floors, entitiesBase, enemiesDef, itemsDef, weaponsDef, facilitiesDef] = await Promise.all([
    fetchJson('./data/rules.json'),
    fetchJson('./data/player.json'),
    fetchJson('./data/floors.json'),
    fetchJson('./data/entities.json'),
    fetchJson('./data/enemies.json'),
    fetchJson('./data/items.json'),
    fetchJson('./data/weapons.json'),
    fetchJson('./data/facilities.json'),
  ]);

  i18n.ja = await fetchJson('./data/i18n/ja.json');
  i18n.en = await fetchJson('./data/i18n/en.json');

  // load maps
  for (const f of floors){
    const m = await fetchJson(`./data/maps/${f.id}.json`);
    floorsById[f.id] = {
      ...f,
      mapLines: m.mapLines
    };
  }
}

function mountEventHandlers(){
  $('btnSettings').onclick = () => showModal(modalSettings, true);
  $('btnCloseSettings').onclick = () => showModal(modalSettings, false);
  $('btnCloseItems').onclick = () => showModal(modalItems, false);

  $('btnNew').onclick = async () => {
    await resumeAudio();
    startNewGame();
  };
  $('btnContinue').onclick = async () => {
    await resumeAudio();
    const loaded = loadGame();
    if (!loaded){
      alert(t('msg.noSave'));
      return;
    }
    state = loaded;
    state.startedAt = nowMs() - (state.elapsedMs || 0);
    state.mode = 'game';
    log(t('msg.loaded'));
    showScreen('game');
    startBgm(floors[state.floorIndex].musicPattern);
    updateHUD();
    resizeCanvas();
  };
  $('btnReset').onclick = () => {
    if (confirm(t('menu.resetConfirm'))){
      resetSave();
      alert('OK');
    }
  };

  $('btnForward').onclick = () => { resumeAudio(); tryMove(+1); };
  $('btnBack').onclick = () => { resumeAudio(); tryMove(-1); };
  $('btnMelee').onclick = () => { resumeAudio(); melee(); };
  $('btnRanged').onclick = () => { resumeAudio(); ranged(); };
  $('btnInteract').onclick = () => { resumeAudio(); interact(); };
  $('btnItems').onclick = () => { resumeAudio(); openItems(); };
  $('btnSave').onclick = () => { resumeAudio(); saveGame(); };

  $('btnRetry').onclick = async () => { await resumeAudio(); startNewGame(); };
  $('btnBackTitle').onclick = () => {
    stopBgm();
    showScreen('title');
  };

  $('weaponSelect').onchange = (e) => {
    state.player.weapon = e.target.value;
    updateHUD();
  };

  // settings toggles
  $('langSelect').onchange = (e) => {
    prefs.lang = e.target.value;
    savePrefs();
    applyI18nStatic();
    updateHUD();
    render();
  };
  $('toggleBgm').onchange = (e) => {
    prefs.bgmOn = e.target.checked;
    audio.bgmOn = prefs.bgmOn;
    savePrefs();
    if (!audio.bgmOn) stopBgm();
    else startBgm(floors[state.floorIndex].musicPattern);
  };
  $('toggleSe').onchange = (e) => {
    prefs.seOn = e.target.checked;
    audio.seOn = prefs.seOn;
    savePrefs();
  };
  $('toggleInvertSwipe').onchange = (e) => {
    prefs.invertSwipe = e.target.checked;
    savePrefs();
  };

  window.addEventListener('resize', () => resizeCanvas());
  bindSwipe();
}

function startNewGame(){
  state = freshState();
  showScreen('game');
  applyI18nStatic();
  $('langSelect').value = prefs.lang;
  $('toggleBgm').checked = prefs.bgmOn;
  $('toggleSe').checked = prefs.seOn;
  $('toggleInvertSwipe').checked = prefs.invertSwipe;
  audio.bgmOn = prefs.bgmOn;
  audio.seOn = prefs.seOn;
  log('---');
  log(t('msg.loaded')); // as "start"
  startBgm(floors[state.floorIndex].musicPattern);
  updateHUD();
  resizeCanvas();
  autoSave();
}

async function main(){
  loadPrefs();
  await loadAllData();
  // apply prefs to UI
  $('langSelect').value = prefs.lang;
  $('toggleBgm').checked = prefs.bgmOn;
  $('toggleSe').checked = prefs.seOn;
  $('toggleInvertSwipe').checked = prefs.invertSwipe;
  audio.bgmOn = prefs.bgmOn;
  audio.seOn = prefs.seOn;

  applyI18nStatic();
  $('buildInfo').textContent = `Build: ${new Date().toISOString().slice(0,10)}`;

  // register SW
  if ('serviceWorker' in navigator){
    try{
      await navigator.serviceWorker.register('./sw.js');
    }catch{}
  }

  // enable/disable continue based on save
  $('btnContinue').disabled = !hasSave();

  mountEventHandlers();
  showScreen('title');
}

main();
