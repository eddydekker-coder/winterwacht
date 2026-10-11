// Regenanimatie voor het tabblad 'Nu' (alleen bij een regenachtige dag).
// Opbouw, van achter naar voor: grijze lucht → lichtbundels → drijvend wolkendek → drie lagen regenstrepen
// (ver, midden, dichtbij) met parallax en een helling die de wind volgt. Alles op één canvas, sprites vooraf getekend.

const LAYERS = [
  // dichtheid per 100.000 px², lengte (px), dikte, dekking, snelheid (px/s) — bij intensiteit 1
  { dens: 170, len: [8, 15], w: 0.6, a: [0.10, 0.18], v: 780, sway: 0.5 },
  { dens: 75, len: [18, 30], w: 0.9, a: [0.16, 0.26], v: 1200, sway: 0.75 },
  { dens: 16, len: [44, 76], w: 1.4, a: [0.20, 0.30], v: 1850, sway: 1 },
];

const X = {
  cv: null, ctx: null, dpr: 1, W: 0, H: 0, on: false, visible: false, raf: null, last: 0, t: 0,
  intensity: 0.6, slant: 0.12, drops: [], sprites: [], bg: null, clouds: [], rays: null, fade: 0,
};

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- vooraf tekenen ----------
function makeSprite(len, w, alpha, slant) {
  const d = X.dpr;
  const L = len * d, dx = L * slant;
  const c = document.createElement('canvas');
  c.width = Math.ceil(Math.abs(dx) + w * d * 4 + 2);
  c.height = Math.ceil(L + w * d * 4);
  const g = c.getContext('2d');
  const x0 = dx < 0 ? c.width - w * d * 2 : w * d * 2, y0 = w * d * 2;
  const grad = g.createLinearGradient(x0, y0, x0 + dx, y0 + L);
  grad.addColorStop(0, 'rgba(235,242,250,0)');
  grad.addColorStop(0.55, `rgba(235,242,250,${alpha * 0.55})`);
  grad.addColorStop(1, `rgba(245,249,255,${alpha})`);
  g.lineCap = 'round';
  if (w >= 1.2) { // dichtbij: zachte, onscherpe rand
    const halo = g.createLinearGradient(x0, y0, x0 + dx, y0 + L);
    halo.addColorStop(0, 'rgba(235,242,250,0)'); halo.addColorStop(1, `rgba(235,242,250,${alpha * 0.35})`);
    g.strokeStyle = halo; g.lineWidth = w * d * 2.6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dx, y0 + L); g.stroke();
  }
  g.strokeStyle = grad; g.lineWidth = w * d;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dx, y0 + L); g.stroke();
  return c;
}

function makeBackground() {
  const { W, H } = X;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // grijze regenlucht, onderin iets lichter door nevel
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#4b5869'); sky.addColorStop(0.45, '#5f6c7d'); sky.addColorStop(1, '#717d8b');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // zachte vignettering aan de zijkanten
  const vig = g.createRadialGradient(W / 2, H * 0.35, H * 0.2, W / 2, H * 0.4, H * 0.9);
  vig.addColorStop(0, 'rgba(255,255,255,0)'); vig.addColorStop(1, 'rgba(30,38,50,0.28)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);
  X.bg = c;
  // lichtbundels die door het wolkendek vallen
  const r = document.createElement('canvas'); r.width = W; r.height = H;
  const rg = r.getContext('2d');
  const beams = [[0.18, 0.10, 0.07], [0.34, 0.06, 0.05], [0.55, 0.12, 0.045], [0.78, 0.07, 0.035]];
  for (const [cx, wd, a] of beams) {
    const x = cx * W, w = wd * W;
    const grad = rg.createLinearGradient(0, 0, 0, H * 0.95);
    grad.addColorStop(0, `rgba(255,255,255,${a})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    rg.fillStyle = grad;
    rg.beginPath();
    rg.moveTo(x - w * 0.3, 0); rg.lineTo(x + w * 0.3, 0);
    rg.lineTo(x + w * 1.6 - W * 0.12, H * 0.95); rg.lineTo(x - w * 0.9 - W * 0.12, H * 0.95);
    rg.closePath(); rg.fill();
  }
  X.rays = r;
}

// Wolkendek: veel zachte 'puffen', naadloos herhaalbaar in de breedte
function makeCloudLayer(seedCount, light, dark, heightFrac, scale) {
  const { W, H, dpr } = X;
  const cw = Math.ceil(W * 1.5), ch = Math.ceil(H * heightFrac);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  const puff = (x, y, r, col) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col); grad.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (let i = 0; i < seedCount; i++) {
    const y = Math.pow(Math.random(), 1.6) * ch * 0.8;
    const r = rnd(40, 150) * dpr * scale * (1 - y / ch * 0.5);
    const x = Math.random() * cw;
    const isDark = Math.random() < 0.35;
    const col = isDark ? `rgba(${dark},${rnd(0.05, 0.12).toFixed(3)})` : `rgba(${light},${rnd(0.05, 0.16).toFixed(3)})`;
    for (const off of [-cw, 0, cw]) if (x + off + r > 0 && x + off - r < cw) puff(x + off, y, r, col);
  }
  // onderrand laten uitvloeien
  g.globalCompositeOperation = 'destination-in';
  const m = g.createLinearGradient(0, 0, 0, ch);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.55, 'rgba(0,0,0,0.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, cw, ch);
  return { c, x: Math.random() * cw };
}

function build() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  X.dpr = dpr;
  X.W = X.cv.width = Math.round(innerWidth * dpr);
  X.H = X.cv.height = Math.round(innerHeight * dpr);
  makeBackground();
  X.clouds = [
    { ...makeCloudLayer(70, '214,222,232', '62,72,88', 0.42, 1.25), v: 6 },
    { ...makeCloudLayer(90, '236,241,247', '82,92,108', 0.30, 0.85), v: 13 },
  ];
  buildDrops();
}

function buildDrops() {
  const { W, H, dpr } = X;
  const area = (W / dpr) * (H / dpr) / 100000;
  X.sprites = LAYERS.map((ly) => [0, 1, 2, 3].map((k) => {
    const len = ly.len[0] + (ly.len[1] - ly.len[0]) * (k / 3) * (0.75 + X.intensity * 0.25);
    const a = ly.a[0] + (ly.a[1] - ly.a[0]) * Math.random();
    return makeSprite(len, ly.w, a, X.slant * ly.sway);
  }));
  X.drops = [];
  LAYERS.forEach((ly, li) => {
    const n = Math.round(ly.dens * area * X.intensity);
    for (let i = 0; i < n; i++) X.drops.push({ l: li, s: (Math.random() * 4) | 0, x: Math.random() * W, y: Math.random() * H, v: ly.v * rnd(0.85, 1.15) * dpr });
  });
}

// ---------- tekenen ----------
function frame(now) {
  const dt = Math.min(0.05, (now - (X.last || now)) / 1000);
  X.last = now; X.t += dt;
  const { ctx, W, H } = X;
  // in- en uitfaden
  const target = X.on && X.visible ? 1 : 0;
  X.fade += (target - X.fade) * Math.min(1, dt * 2.2);
  X.cv.style.opacity = X.fade.toFixed(3);
  if (target === 0 && X.fade < 0.01) { X.cv.style.opacity = '0'; X.raf = null; return; }

  ctx.globalAlpha = 1;
  ctx.drawImage(X.bg, 0, 0);
  // lichtbundels ademen heel langzaam
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(X.t * 0.25);
  ctx.drawImage(X.rays, 0, 0);
  ctx.globalAlpha = 1;
  // wolken drijven met verschillende snelheden (parallax)
  for (const cl of X.clouds) {
    cl.x = (cl.x + cl.v * X.dpr * dt) % cl.c.width;
    const x = -cl.x;
    ctx.drawImage(cl.c, x, 0); ctx.drawImage(cl.c, x + cl.c.width, 0);
    if (x + 2 * cl.c.width < W) ctx.drawImage(cl.c, x + 2 * cl.c.width, 0);
  }
  // regen
  const slant = X.slant;
  for (const d of X.drops) {
    const ly = LAYERS[d.l], sp = X.sprites[d.l][d.s];
    d.y += d.v * dt;
    d.x += d.v * dt * slant * ly.sway;
    if (d.y > H) { d.y = -sp.height - Math.random() * H * 0.2; d.x = Math.random() * (W + sp.width * 2) - sp.width - slant * H * 0.5; }
    if (d.x > W + 40) d.x -= W + 80; else if (d.x < -80) d.x += W + 80;
    ctx.drawImage(sp, d.x, d.y);
  }
  X.raf = requestAnimationFrame(frame);
}

function kick() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // stilstaand beeld: één frame tekenen
    X.cv.style.opacity = X.on && X.visible ? '1' : '0';
    if (X.on && X.visible) { X.fade = 1; X.last = performance.now(); frame(X.last); cancelAnimationFrame(X.raf); X.raf = null; }
    return;
  }
  if (!X.raf && (X.on && X.visible || X.fade > 0.01)) { X.last = 0; X.raf = requestAnimationFrame(frame); }
}

// ---------- publiek ----------
export function initRain(canvas) {
  X.cv = canvas; X.ctx = canvas.getContext('2d');
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (X.bg) build(); }, 200); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(X.raf); X.raf = null; } else kick();
  });
}

// intensity: 0 (uit) .. ~1.5 (stortbui); windKmh en windDir (graden, waar de wind vandaan komt)
export function setRain(intensity, windKmh = 10, windDir = 225) {
  const on = intensity > 0;
  const toward = (((windDir ?? 225) + 180) % 360) * Math.PI / 180;
  const east = Math.sin(toward); // + = naar rechts op het scherm
  const slant = Math.max(-0.42, Math.min(0.42, east * (0.06 + (windKmh ?? 10) * 0.007)));
  const changed = Math.abs(intensity - X.intensity) > 0.05 || Math.abs(slant - X.slant) > 0.02;
  X.intensity = on ? intensity : X.intensity;
  X.slant = slant;
  X.on = on;
  document.body.classList.toggle('raining', on && X.visible);
  if (on && (!X.bg || changed)) { if (!X.bg) build(); else buildDrops(); }
  kick();
}

// Alleen zichtbaar op het tabblad 'Nu'
export function rainVisible(v) { X.visible = v; document.body.classList.toggle('raining', X.on && v); kick(); }

// Bepaal of het een regenachtige dag is uit de uurstappen (eerste stap = nu)
export function rainFromSteps(steps) {
  if (!steps?.length) return { intensity: 0 };
  const wetType = (s) => s.ptype === 'regen' || s.ptype === 'natte sneeuw' || s.ptype === 'ijzel';
  const next = steps.slice(0, 3);
  const rate = Math.max(0, ...next.filter(wetType).map((s) => (s.precip || 0) / (s.dur || 1)));
  const today = steps.filter((s) => s.date === steps[0].date);
  const wetHours = today.filter((s) => wetType(s) && s.precip >= 0.2).length;
  const sum = today.reduce((a, s) => a + (wetType(s) ? s.precip || 0 : 0), 0);
  let intensity = 0;
  if (rate >= 0.1) intensity = Math.min(1.5, 0.45 + Math.sqrt(rate) * 0.45);
  else if (wetHours >= 3 || sum >= 2) intensity = 0.4;
  return { intensity, wind: steps[0].wind, dir: steps[0].dir };
}
