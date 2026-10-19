// Sneeuwschuiven: een koddige sneeuwman houdt de straat vrij terwijl het sneeuwt.
// Opbouw: een hoogtekaart van de sneeuw op de straat (kolommen van 4 px), vallende vlokken in drie lagen
// (parallax, wind), en een schuiver die sneeuw voor zich uit duwt. Een hoop sneeuw glijdt weg onder zijn eigen
// natuurlijke talud (hellingshoek), dus een grote hoop wordt breed en zwaar. Aan de rand van de straat verdwijnt de
// sneeuw in een berm die langzaam groeit. De achtergrond wordt één keer getekend en daarna alleen gekopieerd.

const CW = 4; // kolombreedte in px
const LEVELS = {
  1: { name: 'Motsneeuw', rate: 30, area: 6, wind: 0.2 },
  2: { name: 'Matig', rate: 70, area: 8.5, wind: 0.45 },
  3: { name: 'Flink', rate: 130, area: 13, wind: 0.8 },
  4: { name: 'Sneeuwstorm', rate: 220, area: 17, wind: 1.4 },
};
// Drie lagen vlokken: ver (klein, langzaam), midden, dichtbij (groot, snel). p = kans, wf = windgevoeligheid
const LAYERS = [
  { p: 0.45, r: [0.9, 1.5], vy: [38, 60], a: 0.55, wf: 0.5 },
  { p: 0.35, r: [1.5, 2.4], vy: [60, 90], a: 0.8, wf: 0.8 },
  { p: 0.2, r: [2.4, 3.6], vy: [95, 135], a: 0.95, wf: 1.1 },
];
const M3 = 380;        // px² sneeuw per 'kubieke meter' in de score
const SLOPE = 1.15;    // hellingshoek van een sneeuwhoop in px hoogte per kolom
const ROUND = 60;      // seconden per tijdrit
const KEY = 'ww.game.best';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (x) => x.toFixed(1).replace('.', ',');
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

const SAY = {
  start: ['Brr! Daar gaan we weer.', 'Schuiver gereed!', 'Hoeveel sneeuw past er op een straat?'],
  l1: ['Een rustig grieze-buitje…', 'Zacht en stil. Heerlijk.'],
  l2: ['Daar komt de sneeuw!', 'Mooi weertje om te schuiven.'],
  l3: ['Het sneeuwt flink door!', 'Schuif, schuif, schuif!'],
  l4: ['STORM! Hou je muts vast!', 'Wie zette de sneeuwkraan open?!'],
  idle: ['Mijn wortel bevriest…', 'Smelten? Ik? Nooit!', 'Wie wil er chocomel?', 'Ik ben dol op min drie.', 'Ik tel de vlokken. Eén, twee, drie…', 'Mijn muts zit goed, hè?'],
  stress: ['Zwaar werk, zeg!', 'Die berg wordt hoog!', 'Ik smelt van het zweten…', 'Mijn schuiver kreunt!'],
  buried: ['Hallo? Ik zit vast in de sneeuw!', 'Niet blijven staan, schuif!', 'Help, ik word een ijslolly!'],
  clean: ['Straat spik en span!', 'Kijk nou, kaal asfalt!', 'Dat is pas schoon werk.'],
  gold: ['Turbo-schuiver! Wiiii!', 'Gouden vlok! Nu ben ik breed!'],
  goldSeen: ['Kijk, een gouden vlok! Vang hem!'],
};

const G = {
  el: null, cv: null, ctx: null, W: 0, H: 0, dpr: 1, sc: 1, y0: 0, roadTop: 0, N: 0, h: null,
  flakes: [], acc: 0, level: 2, mode: 'free', t: 0, last: 0, raf: 0, visible: false, paused: false, over: false,
  blade: { x: 0, tx: 0, vx: 0, dir: 1, face: 1, w: 84 }, removed: 0, bankL: 0, bankR: 0, stress: 0, ahead: 0,
  gold: null, nextGold: 16, turbo: 0, msg: null, msgCool: 2, idleAt: 7, wind: 0, bg: null, snowGrad: null,
  timeLeft: ROUND, keys: { l: 0, r: 0 }, buriedFor: 0, uiAt: 0, ui: {}, overAction: null, touched: false, clear: 100, hadSnow: false,
};

function best() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function saveBest(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* geen opslag: geen record */ } }

// ---------- opzet ----------
export function initGame(el) {
  G.el = el; G.cv = el.canvas; G.ctx = G.cv.getContext('2d');
  G.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.level.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLevel(+b.dataset.l); });
  el.pause.addEventListener('click', () => togglePause());
  el.reset.addEventListener('click', () => { reset(); say(pick(SAY.start), true); });
  el.mode.addEventListener('click', () => (G.mode === 'free' ? startTimed() : startFree()));
  el.overBtn.addEventListener('click', () => G.overAction?.());

  const toX = (e) => { const r = G.cv.getBoundingClientRect(); return clamp((e.clientX - r.left) * (G.W / r.width), 0, G.W); };
  G.cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) { G.blade.tx = toX(e); touched(); } });
  G.cv.addEventListener('pointerdown', (e) => { G.cv.setPointerCapture?.(e.pointerId); G.blade.tx = toX(e); touched(); });
  G.cv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { G.keys.l = 1; e.preventDefault(); touched(); }
    else if (e.key === 'ArrowRight' || e.key === 'd') { G.keys.r = 1; e.preventDefault(); touched(); }
    else if (e.key === ' ' || e.key === 'p') { togglePause(); e.preventDefault(); }
  });
  G.cv.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') G.keys.l = 0;
    else if (e.key === 'ArrowRight' || e.key === 'd') G.keys.r = 0;
  });
  G.cv.addEventListener('blur', () => { G.keys.l = G.keys.r = 0; });
  document.addEventListener('visibilitychange', kick);
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (G.visible) resize(); }).observe(el.wrap);
  else window.addEventListener('resize', () => { if (G.visible) resize(); });
  G.paused = G.reduced; // wie minder beweging wil, start zelf
  syncLevelButtons(); syncMode();
  return { show };
}

function touched() { if (!G.touched) { G.touched = true; G.el.hint.hidden = true; } }

function show(v) {
  G.visible = v;
  if (v) {
    resize();
    if (G.paused && !G.over) showOver('Pauze', G.reduced ? 'Dit spel beweegt veel. Druk op Verder als je klaar bent.' : 'De sneeuwman wacht even.', 'Verder', () => togglePause(false));
  }
  kick();
}

function kick() {
  const go = G.visible && !G.paused && !G.over && !document.hidden && G.W > 0;
  if (go && !G.raf) { G.last = performance.now(); G.raf = requestAnimationFrame(frame); }
  else if (!go && G.raf) { cancelAnimationFrame(G.raf); G.raf = 0; }
}

function resize() {
  const w = Math.floor(G.el.wrap.clientWidth);
  if (!w) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const H = Math.round(clamp(w * 0.72, 300, 440));
  if (w === G.W && H === G.H && dpr === G.dpr) return;
  const oldH = G.h, oldN = G.N, oldW = G.W;
  G.W = w; G.H = H; G.dpr = dpr; G.sc = clamp(H / 420, 0.72, 1.1);
  G.cv.width = Math.round(w * dpr); G.cv.height = Math.round(H * dpr); G.cv.style.height = `${H}px`;
  G.N = Math.ceil(w / CW) + 1;
  const nh = new Float32Array(G.N);
  if (oldH) for (let i = 0; i < G.N; i++) nh[i] = oldH[Math.min(oldN - 1, Math.round((i * oldW) / w))];
  G.h = nh;
  G.y0 = H - 10 * G.sc; G.roadTop = G.y0 - 30 * G.sc;
  if (oldW) { G.blade.x *= w / oldW; G.blade.tx *= w / oldW; } else { G.blade.x = G.blade.tx = w / 2; reset(true); }
  const sg = G.ctx.createLinearGradient(0, G.y0 - H * 0.5, 0, G.y0);
  sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.7, '#eef5fb'); sg.addColorStop(1, '#c6dbec');
  G.snowGrad = sg;
  makeBg();
  draw();
}

function reset(quiet) {
  G.h?.fill(0); G.flakes.length = 0; G.acc = 0; G.removed = 0; G.bankL = G.bankR = 0; G.ahead = 0; G.stress = 0;
  G.gold = null; G.nextGold = rnd(14, 22); G.turbo = 0; G.msg = null; G.msgCool = 2; G.idleAt = 8; G.buriedFor = 0;
  G.timeLeft = ROUND; G.over = false; G.hadSnow = false; G.t = 0;
  G.blade.vx = 0;
  if (G.W) {
    const L = LEVELS[G.level];
    const n = Math.round(L.rate * (G.W / 600) * 3.2);
    for (let i = 0; i < n; i++) { const f = spawn(); f.y = rnd(0, G.y0 - 20); }
  }
  hideOver(); kick(); uiUpdate(true);
  if (!quiet && G.W) draw();
}

function setLevel(n) {
  if (!LEVELS[n]) return;
  G.level = n; syncLevelButtons();
  if (G.mode === 'timed') reset(); // een tijdrit telt per intensiteit
  say(pick(SAY['l' + n]), true);
  uiUpdate(true);
}
function syncLevelButtons() { for (const b of G.el.level.querySelectorAll('button')) b.setAttribute('aria-checked', String(+b.dataset.l === G.level)); }

function startTimed() { G.mode = 'timed'; syncMode(); reset(); G.paused = false; syncPause(); say('Zestig seconden. Daar gaan we!', true); kick(); }
function startFree() { G.mode = 'free'; syncMode(); reset(); G.paused = false; syncPause(); kick(); }
function syncMode() {
  G.el.mode.textContent = G.mode === 'free' ? 'Tijdrit van 60 s' : 'Terug naar vrij spel';
  G.el.timeLabel.textContent = G.mode === 'free' ? 'Record (tijdrit)' : 'Tijd';
}

function togglePause(force) {
  if (G.over) return;
  G.paused = typeof force === 'boolean' ? force : !G.paused;
  syncPause();
  if (G.paused) showOver('Pauze', 'De sneeuwman wacht even.', 'Verder', () => togglePause(false)); else hideOver();
  kick();
}
function syncPause() { G.el.pause.textContent = G.paused ? 'Verder' : 'Pauze'; G.el.pause.setAttribute('aria-pressed', String(G.paused)); }

function showOver(title, text, btn, action) {
  G.el.overTitle.textContent = title; G.el.overText.textContent = text; G.el.overBtn.textContent = btn;
  G.overAction = action; G.el.over.hidden = false;
  if (G.visible) G.el.overBtn.focus({ preventScroll: true });
}
function hideOver() { G.el.over.hidden = true; G.overAction = null; }

function endRound() {
  G.over = true;
  const score = G.removed / M3, b = best(), prev = b[G.level] || 0, rec = score > prev;
  if (rec) { b[G.level] = score; saveBest(b); }
  uiUpdate(true);
  showOver('Tijd!', `Je ruimde ${fmt(score)} m³ sneeuw op bij “${LEVELS[G.level].name}”.${rec ? ' Nieuw record!' : prev ? ` Record: ${fmt(prev)} m³.` : ''}`, 'Nog een keer', () => startTimed());
  kick();
}

function say(text, force) {
  if (G.msg && !force) return;
  G.msg = { text, t: 3 };
}

// ---------- simulatie ----------
function spawn() {
  const r0 = Math.random(), li = r0 < LAYERS[0].p ? 0 : r0 < LAYERS[0].p + LAYERS[1].p ? 1 : 2, ly = LAYERS[li];
  const r = rnd(ly.r[0], ly.r[1]);
  const f = { x: rnd(-30, G.W + 30), y: rnd(-14, -2), r, vy: rnd(ly.vy[0], ly.vy[1]), ph: Math.random() * 6.28, l: li, f: (r * r) / 3.9 };
  G.flakes.push(f);
  return f;
}

function deposit(c, hgt) {
  const h = G.h, cap = G.H * 0.62;
  const add = (i, w) => { if (i >= 2 && i < G.N - 2) h[i] = Math.min(cap, h[i] + hgt * w); };
  add(c - 1, 0.25); add(c, 0.5); add(c + 1, 0.25);
}

function sink(heightSum, side) {
  const a = heightSum * CW;
  G.removed += a;
  if (side < 0) G.bankL += a; else G.bankR += a;
}

function snowmanX() { return G.blade.x - G.blade.face * (G.blade.w / 2 - 34 * G.sc); }

function step(dt) {
  const { W, y0, sc, N } = G, h = G.h, B = G.blade, L = LEVELS[G.level];
  G.t += dt;
  G.wind = L.wind * 38 * (Math.sin(G.t * 0.37) + 0.6 * Math.sin(G.t * 0.91 + 2) + (G.level === 4 ? 0.5 * Math.sin(G.t * 2.3) : 0));

  // vlokken
  G.acc += L.rate * (W / 600) * dt;
  while (G.acc >= 1) { G.acc -= 1; spawn(); }
  const fl = G.flakes;
  for (let i = fl.length - 1; i >= 0; i--) {
    const f = fl[i], ly = LAYERS[f.l];
    f.y += f.vy * dt;
    f.x += (G.wind * ly.wf + Math.sin(G.t * 1.6 + f.ph) * 12 * ly.wf) * dt;
    if (f.x < -30) f.x += W + 60; else if (f.x > W + 30) f.x -= W + 60;
    if (f.y > y0 - G.H * 0.62 - 6) {
      const c = Math.floor(f.x / CW);
      if (c >= 0 && c < N) {
        if (f.y + f.r * 0.4 >= y0 - h[c]) {
          if (c >= 2 && c < N - 2) { deposit(c, (L.area * f.f) / CW); G.hadSnow = true; }
          fl[i] = fl[fl.length - 1]; fl.pop();
        }
      } else if (f.y > y0 + 6) { fl[i] = fl[fl.length - 1]; fl.pop(); }
    }
  }

  // schuiver
  const w = (G.turbo > 0 ? 150 : 84) * sc;
  B.w += (w - B.w) * Math.min(1, dt * 8);
  if (G.keys.l || G.keys.r) B.tx = clamp(B.x + (G.keys.r - G.keys.l) * 600, 0, W);
  const slow = Math.max(0.22, 1 / (1 + G.ahead / 1400));
  const vmax = W * 1.3 * slow * (G.turbo > 0 ? 1.35 : 1);
  const want = clamp((B.tx - B.x) * 10, -vmax, vmax);
  B.vx += (want - B.vx) * Math.min(1, dt * 14);
  const old = B.x;
  B.x = clamp(B.x + B.vx * dt, 0, W);
  const dx = B.x - old;
  if (Math.abs(dx) > 0.05) B.dir = dx > 0 ? 1 : -1;
  B.face += (B.dir - B.face) * Math.min(1, dt * 11);

  const half = B.w / 2, dir = B.dir;
  const cN = Math.floor((B.x + dir * half) / CW);
  if (Math.abs(dx) > 0.01) {
    const cO = Math.floor((old + dir * half) / CW);
    let carry = 0;
    for (let c = cO + dir; dir > 0 ? c <= cN : c >= cN; c += dir) if (c >= 0 && c < N) { carry += h[c]; h[c] = 0; }
    if (carry > 0) {
      const wts = [0.3, 0.25, 0.2, 0.15, 0.1];
      for (let k = 0; k < wts.length; k++) {
        const idx = cN + dir * (k + 1);
        if (idx < 0) sink(carry * wts[k], -1);
        else if (idx >= N) sink(carry * wts[k], 1);
        else h[idx] = Math.min(G.H * 0.62, h[idx] + carry * wts[k]);
      }
    }
  }

  // talud: hopen glijden uit elkaar, behalve over de schuiverplaat heen
  const wall = dir > 0 ? cN : cN - 1, MD = CW * SLOPE;
  for (let pass = 0; pass < 3; pass++) {
    const up = pass % 2 === 0;
    for (let k = 0; k < N - 1; k++) {
      const i = up ? k : N - 2 - k;
      if (i === wall) continue;
      const d = h[i] - h[i + 1];
      if (d > MD) { const m = (d - MD) * 0.3; h[i] -= m; h[i + 1] += m; }
      else if (d < -MD) { const m = (-d - MD) * 0.3; h[i] += m; h[i + 1] -= m; }
    }
  }
  // afvoer naar de bermen
  for (let c = 0; c < 2; c++) {
    if (h[c] > 0) { sink(h[c], -1); h[c] = 0; }
    const j = N - 1 - c;
    if (h[j] > 0) { sink(h[j], 1); h[j] = 0; }
  }

  // belasting en stemming
  let a = 0;
  for (let k = 1; k <= 24; k++) { const idx = cN + dir * k; if (idx >= 2 && idx < N - 2) a += h[idx]; }
  G.ahead += (a - G.ahead) * Math.min(1, dt * 6);
  const st = clamp(G.ahead / 2200, 0, 1);
  G.stress += (st - G.stress) * Math.min(1, dt * 4);

  const sx = snowmanX(), sc0 = Math.floor(sx / CW);
  let around = 0, cnt = 0;
  for (let c = sc0 - 2; c <= sc0 + 2; c++) if (c >= 0 && c < N) { around += h[c]; cnt++; }
  G.buried = cnt ? around / cnt > 24 * sc : false;

  let free = 0;
  for (let c = 2; c < N - 2; c++) if (h[c] < 5) free++;
  G.clear = (free / (N - 4)) * 100;

  // gouden vlok
  if (!G.gold) {
    G.nextGold -= dt;
    if (G.nextGold <= 0) { G.gold = { x: rnd(40, W - 40), y: -14, ph: Math.random() * 6 }; G.nextGold = rnd(22, 34); say(pick(SAY.goldSeen), true); }
  } else {
    const q = G.gold;
    q.y += 46 * dt; q.x += (G.wind * 0.6 + Math.sin(G.t * 2 + q.ph) * 18) * dt;
    const px = sx + B.face * (B.w - 34 * sc);
    const hitBody = q.y > y0 - 125 * sc && q.y < y0 - 8 * sc && Math.abs(q.x - sx) < 32 * sc;
    const hitBoard = q.y > y0 - 55 * sc && q.y < y0 && Math.abs(q.x - px) < 24 * sc;
    if (hitBody || hitBoard) { G.turbo = 8; G.gold = null; say(pick(SAY.gold), true); }
    else if (q.y > y0 + 6) G.gold = null;
  }
  if (G.turbo > 0) G.turbo = Math.max(0, G.turbo - dt);

  // praatjes
  if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
  G.msgCool -= dt; G.idleAt -= dt;
  if (!G.msg && G.msgCool <= 0) {
    if (G.stress > 0.65) { say(pick(SAY.stress)); G.msgCool = 9; }
    else if (G.buried) { G.buriedFor += dt; if (G.buriedFor > 1.5) { say(pick(SAY.buried)); G.msgCool = 10; G.buriedFor = 0; } }
    else if (G.hadSnow && G.clear > 96 && G.removed > M3 * 2) { say(pick(SAY.clean)); G.msgCool = 25; }
  }
  if (!G.buried) G.buriedFor = 0;
  if (!G.msg && G.idleAt <= 0) { say(pick(SAY.idle)); G.idleAt = rnd(10, 16); }

  if (G.mode === 'timed') { G.timeLeft -= dt; if (G.timeLeft <= 0) { G.timeLeft = 0; endRound(); } }
  G.uiAt -= dt;
  if (G.uiAt <= 0) { G.uiAt = 0.25; uiUpdate(); }
}

function setText(key, node, text) { if (G.ui[key] !== text) { G.ui[key] = text; node.textContent = text; } }
function uiUpdate(force) {
  if (force) G.ui = {};
  const e = G.el, score = G.removed / M3;
  setText('s', e.score, fmt(score));
  setText('c', e.clear, `${Math.round(G.clear)}%`);
  if (G.mode === 'timed') setText('t', e.time, `${Math.ceil(G.timeLeft)} s`);
  else { const b = best()[G.level]; setText('t', e.time, b ? `${fmt(b)} m³` : '–'); }
}

function frame(ts) {
  G.raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (ts - G.last) / 1000));
  G.last = ts;
  step(dt);
  draw();
  if (G.visible && !G.paused && !G.over && !document.hidden) G.raf = requestAnimationFrame(frame);
}

// ---------- tekenen ----------
function makeBg() {
  const { W, H, dpr, sc, roadTop, y0 } = G;
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const rng = mulberry(11);
  // lucht
  let gr = g.createLinearGradient(0, 0, 0, roadTop);
  gr.addColorStop(0, '#0f2038'); gr.addColorStop(0.55, '#284566'); gr.addColorStop(1, '#6d8ca8');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.45})`; g.fillRect(rng() * W, rng() * roadTop * 0.55, 1.4, 1.4); }
  // maan
  const mx = W * 0.84, my = H * 0.17, mr = 17 * sc;
  gr = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
  gr.addColorStop(0, 'rgba(240,238,215,0.35)'); gr.addColorStop(1, 'rgba(240,238,215,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(mx, my, mr * 4, 0, 6.3); g.fill();
  g.fillStyle = '#f2f0dc'; g.beginPath(); g.arc(mx, my, mr, 0, 6.3); g.fill();
  g.fillStyle = 'rgba(160,160,140,0.35)';
  for (const [dx, dy, r] of [[-5, -3, 3.2], [4, 4, 2.4], [3, -6, 1.8]]) { g.beginPath(); g.arc(mx + dx * sc, my + dy * sc, r * sc, 0, 6.3); g.fill(); }
  // heuvels
  g.fillStyle = '#35516f'; g.beginPath(); g.moveTo(0, roadTop);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, roadTop - 62 * sc - Math.sin(x * 0.011 + 1) * 22 * sc - Math.sin(x * 0.027) * 8 * sc);
  g.lineTo(W, roadTop); g.closePath(); g.fill();
  // dennen in twee rijen
  for (const [col, hmin, hmax, off] of [['#1f3550', 36, 62, 20], ['#162a42', 44, 78, 8]]) {
    for (let x = -10; x < W + 10; x += rnd(13, 21)) {
      const th = rnd(hmin, hmax) * sc, tw = th * 0.42, by = roadTop - off * sc;
      g.fillStyle = col;
      for (let k = 0; k < 3; k++) { const yy = by - th * (0.28 * k), ww = tw * (1 - k * 0.22); g.beginPath(); g.moveTo(x - ww / 2, yy); g.lineTo(x, yy - th * 0.5); g.lineTo(x + ww / 2, yy); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(235,245,255,0.5)'; g.beginPath(); g.moveTo(x - 3, by - th * 0.84 + 6); g.lineTo(x, by - th * 1.0); g.lineTo(x + 3, by - th * 0.84 + 6); g.closePath(); g.fill();
    }
  }
  // huizen
  const base = roadTop - 8 * sc;
  const colors = ['#3b4b66', '#4d3d52', '#2f4b55', '#54453a', '#3f4a3c'];
  let x = -14;
  while (x < W) {
    const hw = rnd(70, 108) * sc, hh = rnd(46, 74) * sc, col = pick(colors);
    g.fillStyle = col; g.fillRect(x, base - hh, hw, hh);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(x - 5, base - hh); g.lineTo(x + hw / 2, base - hh - 30 * sc); g.lineTo(x + hw + 5, base - hh); g.closePath(); g.fill();
    g.fillStyle = '#f4f9ff'; g.beginPath(); g.moveTo(x - 7, base - hh + 1); g.lineTo(x + hw / 2, base - hh - 33 * sc); g.lineTo(x + hw + 7, base - hh + 1);
    g.lineTo(x + hw + 2, base - hh - 3); g.lineTo(x + hw / 2, base - hh - 26 * sc); g.lineTo(x - 2, base - hh - 3); g.closePath(); g.fill();
    g.fillStyle = col; g.fillRect(x + hw * 0.7, base - hh - 22 * sc, 9 * sc, 20 * sc); g.fillStyle = '#f4f9ff'; g.fillRect(x + hw * 0.7 - 1, base - hh - 25 * sc, 11 * sc, 5 * sc);
    const cols = Math.max(2, Math.floor(hw / (30 * sc))), rows = hh > 56 * sc ? 2 : 1;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const wx = x + (hw / cols) * (k + 0.5) - 6 * sc, wy = base - hh + 8 * sc + r * 24 * sc, lit = rng() < 0.8;
      if (lit) { const gg = g.createRadialGradient(wx + 6 * sc, wy + 7 * sc, 2, wx + 6 * sc, wy + 7 * sc, 22 * sc); gg.addColorStop(0, 'rgba(255,205,110,0.35)'); gg.addColorStop(1, 'rgba(255,205,110,0)'); g.fillStyle = gg; g.fillRect(wx - 16 * sc, wy - 14 * sc, 44 * sc, 44 * sc); }
      g.fillStyle = lit ? '#ffd47a' : '#1e2a3a'; g.fillRect(wx, wy, 12 * sc, 14 * sc);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(wx + 5.5 * sc, wy, 1 * sc, 14 * sc); g.fillRect(wx, wy + 6.5 * sc, 12 * sc, 1 * sc);
      g.fillStyle = 'rgba(244,249,255,0.85)'; g.fillRect(wx - 1, wy - 2 * sc, 14 * sc, 2.5 * sc);
    }
    x += hw + rnd(4, 16) * sc;
  }
  // besneeuwde stoep en straat
  g.fillStyle = '#b9cde0'; g.fillRect(0, base, W, roadTop - base + 1);
  g.fillStyle = '#dbe8f3'; g.fillRect(0, base, W, 2 * sc);
  g.fillStyle = '#2a323b'; g.fillRect(0, roadTop, W, H - roadTop);
  g.fillStyle = '#39444f'; g.fillRect(0, roadTop, W, 2 * sc);
  g.fillStyle = 'rgba(255,214,102,0.85)';
  for (let dx = 6; dx < W; dx += 46 * sc) g.fillRect(dx, y0 - 15 * sc, 24 * sc, 3 * sc);
  // lantaarn
  const lx = W * 0.64;
  g.fillStyle = '#1b2430'; g.fillRect(lx - 2 * sc, base - 92 * sc, 4 * sc, 92 * sc);
  g.fillRect(lx - 2 * sc, base - 94 * sc, 20 * sc, 4 * sc);
  g.fillStyle = '#ffe9a8'; g.beginPath(); g.ellipse(lx + 16 * sc, base - 88 * sc, 7 * sc, 4 * sc, 0, 0, 6.3); g.fill();
  gr = g.createRadialGradient(lx + 16 * sc, base - 86 * sc, 2, lx + 16 * sc, base - 60 * sc, 120 * sc);
  gr.addColorStop(0, 'rgba(255,233,168,0.5)'); gr.addColorStop(1, 'rgba(255,233,168,0)');
  g.fillStyle = gr; g.fillRect(lx - 110 * sc, base - 190 * sc, 260 * sc, 260 * sc);
  G.bg = c;
}

function drawFlakes(g, l) {
  const ly = LAYERS[l];
  g.fillStyle = `rgba(255,255,255,${ly.a})`;
  g.beginPath();
  for (const f of G.flakes) if (f.l === l) { g.moveTo(f.x + f.r, f.y); g.arc(f.x, f.y, f.r, 0, 6.2832); }
  g.fill();
}

function drawGold(g) {
  const q = G.gold; if (!q) return;
  const s = G.sc, r = 9 * s;
  const gl = g.createRadialGradient(q.x, q.y, 1, q.x, q.y, r * 2.6);
  gl.addColorStop(0, 'rgba(255,220,90,0.7)'); gl.addColorStop(1, 'rgba(255,220,90,0)');
  g.fillStyle = gl; g.beginPath(); g.arc(q.x, q.y, r * 2.6, 0, 6.3); g.fill();
  g.save(); g.translate(q.x, q.y); g.rotate(G.t * 1.5);
  g.fillStyle = '#ffd24a'; g.strokeStyle = '#fff3b0'; g.lineWidth = 1.2;
  g.beginPath();
  for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6, rr0 = k % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr0, Math.sin(a) * rr0); }
  g.closePath(); g.fill(); g.stroke(); g.restore();
}

function drawBank(g, side, area) {
  const s = G.sc, bh = Math.min(G.H * 0.5, 8 * s + Math.sqrt(area) * 0.42), bw = bh * 2.2 + 14;
  g.beginPath();
  g.moveTo(side < 0 ? 0 : G.W, G.y0 + 3);
  for (let x = 0; x <= bw; x += 6) {
    const t = x / bw, y = G.y0 - bh * Math.pow(Math.max(0, 1 - t * t), 0.8) - Math.sin(x * 0.35) * 1.2;
    g.lineTo(side < 0 ? x : G.W - x, y);
  }
  g.lineTo(side < 0 ? bw : G.W - bw, G.y0 + 3); g.closePath();
  g.fillStyle = G.snowGrad; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.stroke();
}

function ball(g, x, y, r) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cddfee');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(70,105,140,0.3)'; g.lineWidth = 1; g.stroke();
}

function drawSnowman(g) {
  const s = G.sc, B = G.blade, st = G.stress, t = G.t;
  const sx = snowmanX();
  const moving = Math.abs(B.vx) > 40;
  const lean = clamp(Math.abs(B.vx) / 1000, 0, 1) * 0.17 + Math.sin(t * 1.5) * 0.025;
  const bob = moving ? Math.sin(t * 20) * 1.6 : Math.sin(t * 2) * 0.8;
  const shake = st > 0.55 ? Math.sin(t * 60) * 1.4 * (st - 0.55) * 2 : 0;
  const buried = G.buried;
  g.save();
  g.translate(sx + shake * s, G.y0 - 3 * s);
  g.scale(B.face * s, s);
  g.rotate(lean);
  g.translate(0, bob);

  // zwaaiarm (achter)
  g.strokeStyle = '#6b4a2f'; g.lineWidth = 3; g.lineCap = 'round';
  const wave = st < 0.4 && !moving ? Math.sin(t * 6) * 7 : -2;
  g.beginPath(); g.moveTo(-12, -62); g.lineTo(-30, -80 + wave); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(-30, -80 + wave); g.lineTo(-37, -88 + wave); g.moveTo(-30, -80 + wave); g.lineTo(-38, -80 + wave); g.moveTo(-30, -80 + wave); g.lineTo(-35, -73 + wave); g.stroke();

  // laarzen
  g.fillStyle = '#1d2530'; g.beginPath(); g.ellipse(-9, -1, 11, 5, 0, 0, 6.3); g.ellipse(11, -1, 11, 5, 0, 0, 6.3); g.fill();
  // lichaam
  ball(g, 0, -24, 24); ball(g, 0, -58, 18);
  g.fillStyle = '#1d2530';
  for (const [bx, by] of [[3, -66], [4, -57], [3, -48], [3, -32], [3, -20]]) { g.beginPath(); g.arc(bx, by, 2.2, 0, 6.3); g.fill(); }
  ball(g, 2, -90, 14);

  // sjaal
  const fl = clamp(Math.abs(B.vx) / 600, 0, 1);
  g.strokeStyle = '#d9483b'; g.lineWidth = 7; g.beginPath(); g.moveTo(-13, -73); g.quadraticCurveTo(0, -66, 14, -72); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-6, -70); g.lineTo(-6, -64); g.moveTo(5, -69); g.lineTo(5, -63); g.stroke();
  g.strokeStyle = '#d9483b'; g.lineWidth = 6;
  const flap = Math.sin(t * 9) * 3 * (0.3 + fl), lift = fl * 14;
  g.beginPath(); g.moveTo(-9, -70); g.quadraticCurveTo(-24 - fl * 6, -70 - lift * 0.4 + flap, -34 - fl * 12, -64 - lift + flap * 1.5); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.moveTo(-5, -68); g.quadraticCurveTo(-16, -62 + flap, -24 - fl * 6, -56 - lift * 0.5 - flap); g.stroke();

  // gezicht
  const hx = 2, hy = -90;
  if (st > 0.5 || buried) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(hx + 1, hy - 4, 4.2, 0, 6.3); g.arc(hx + 9.5, hy - 4, 4.2, 0, 6.3); g.fill();
    g.strokeStyle = '#1d2530'; g.lineWidth = 0.9; g.stroke();
    g.fillStyle = '#1d2530'; g.beginPath(); g.arc(hx + 2.4, hy - 4, 1.6, 0, 6.3); g.arc(hx + 10.9, hy - 4, 1.6, 0, 6.3); g.fill();
  } else {
    g.fillStyle = '#1d2530'; g.beginPath(); g.arc(hx + 1, hy - 4, 2.6, 0, 6.3); g.arc(hx + 9.5, hy - 4, 2.6, 0, 6.3); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(hx + 1.8, hy - 4.8, 0.9, 0, 6.3); g.arc(hx + 10.3, hy - 4.8, 0.9, 0, 6.3); g.fill();
  }
  // wortelneus
  const nl = 15 + Math.sin(t * 3) * 0.8 - st * 2, droop = 2 + st * 3;
  g.fillStyle = '#ff8a2b'; g.strokeStyle = '#d9621b'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(hx + 6, hy - 1); g.lineTo(hx + 6 + nl, hy + 2 + droop); g.lineTo(hx + 6, hy + 4); g.closePath(); g.fill(); g.stroke();
  // mond
  g.fillStyle = '#1d2530';
  if (buried || st > 0.8) { g.beginPath(); g.ellipse(hx + 7, hy + 9, 2.8, 3.4, 0, 0, 6.3); g.fill(); }
  else if (st > 0.5) { for (let k = 0; k < 5; k++) g.fillRect(hx + 1 + k * 3.2, hy + 8 + (k % 2 ? 1 : 0), 2, 2); }
  else { for (let k = 0; k < 5; k++) { const u = k / 4; g.beginPath(); g.arc(hx + 1 + k * 3.2, hy + 7 + Math.sin(u * Math.PI) * 2.6, 1.15, 0, 6.3); g.fill(); } }
  // zweetdruppel
  if (st > 0.45) {
    const dy = (t * 25) % 14; g.fillStyle = 'rgba(150,215,255,0.95)';
    g.beginPath(); g.moveTo(hx - 9, hy - 12 + dy); g.quadraticCurveTo(hx - 13, hy - 6 + dy, hx - 9, hy - 5 + dy); g.quadraticCurveTo(hx - 5, hy - 6 + dy, hx - 9, hy - 12 + dy); g.fill();
  }
  // hoed (wiebelt mee)
  g.save(); g.translate(hx, hy - 12); g.rotate(-0.1 - lean * 0.6 + Math.sin(t * 2.2) * 0.03);
  g.fillStyle = '#1d2530'; g.beginPath(); g.ellipse(0, 0, 18, 4.5, 0, 0, 6.3); g.fill();
  rr(g, -10, -23, 20, 23, 3); g.fill();
  g.fillStyle = '#d9483b'; g.fillRect(-10, -9, 20, 5);
  g.restore();

  // schuiver: arm, steel en plaat
  const padX = B.w / s - 34;
  g.strokeStyle = '#6b4a2f'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(10, -62); g.lineTo(24, -50); g.stroke();
  g.strokeStyle = '#9a6b3c'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-6, -58); g.lineTo(padX - 2, -34); g.stroke();
  g.fillStyle = '#6b4a2f'; g.beginPath(); g.arc(24, -50, 3, 0, 6.3); g.fill();
  const plateGrad = g.createLinearGradient(padX - 8, 0, padX + 8, 0);
  plateGrad.addColorStop(0, '#c43a2c'); plateGrad.addColorStop(1, '#ec6a55');
  g.fillStyle = plateGrad; g.strokeStyle = '#7e2018'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(padX - 7, 2); g.lineTo(padX + 9, 2); g.lineTo(padX + 3, -44); g.lineTo(padX - 9, -44); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#c9d3dc'; g.fillRect(padX - 7, -2, 16, 4);
  g.restore();
}

function drawBubble(g) {
  const m = G.msg; if (!m) return;
  const s = G.sc, sx = snowmanX();
  const fs = Math.round(13 * Math.max(0.92, s));
  g.font = `700 ${fs}px 'Atkinson Hyperlegible', system-ui, sans-serif`;
  const maxW = Math.min(230, G.W - 28), words = m.text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const t2 = cur ? `${cur} ${w}` : w; if (g.measureText(t2).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t2; }
  lines.push(cur);
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)), bw = tw + 22, bh = lines.length * (fs + 4) + 12;
  const bx = clamp(sx - bw / 2, 6, G.W - bw - 6), by = Math.max(6, G.y0 - 132 * s - bh - 8);
  g.save();
  g.globalAlpha = clamp(m.t / 0.4, 0, 1) * clamp((3 - m.t) / 0.15, 0, 1);
  g.fillStyle = '#ffffff'; rr(g, bx, by, bw, bh, 10); g.fill();
  const tx = clamp(sx, bx + 14, bx + bw - 14);
  g.beginPath(); g.moveTo(tx - 6, by + bh - 1); g.lineTo(tx + 3, by + bh + 8); g.lineTo(tx + 6, by + bh - 1); g.closePath(); g.fill();
  g.fillStyle = '#16314a'; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, bx + 11, by + 7 + i * (fs + 4)));
  g.restore();
}

function drawSnow(g) {
  const h = G.h, N = G.N, y0 = G.y0;
  g.beginPath(); g.moveTo(0, y0 - h[0]);
  for (let i = 1; i < N; i++) g.lineTo(i * CW, y0 - h[i]);
  g.lineTo(G.W, y0 + 3); g.lineTo(0, y0 + 3); g.closePath();
  g.fillStyle = G.snowGrad; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.6; g.beginPath();
  let pen = false;
  for (let i = 0; i < N; i++) {
    if (h[i] > 0.8) { if (!pen) { g.moveTo(i * CW, y0 - h[i]); pen = true; } else g.lineTo(i * CW, y0 - h[i]); } else pen = false;
  }
  g.stroke();
}

function drawHud(g) {
  if (G.turbo > 0) {
    const w = 96, x = 10, y = 10;
    g.fillStyle = 'rgba(10,22,38,0.7)'; rr(g, x, y, w, 22, 11); g.fill();
    g.fillStyle = '#ffd24a'; rr(g, x + 3, y + 3, (w - 6) * (G.turbo / 8), 16, 8); g.fill();
    g.fillStyle = '#16314a'; g.font = "700 11px 'Atkinson Hyperlegible', system-ui, sans-serif"; g.textBaseline = 'middle'; g.fillText('TURBO', x + 28, y + 11);
  }
}

function draw() {
  const g = G.ctx; if (!G.bg) return;
  g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  g.drawImage(G.bg, 0, 0, G.W, G.H);
  drawFlakes(g, 0); drawFlakes(g, 1);
  drawGold(g);
  drawBank(g, -1, G.bankL); drawBank(g, 1, G.bankR);
  drawSnowman(g);
  drawFlakes(g, 2);
  drawSnow(g);
  drawBubble(g);
  drawHud(g);
}
