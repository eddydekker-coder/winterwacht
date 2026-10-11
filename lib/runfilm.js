// Run-film: speelt de laatste runs van een ensemble rustig achter elkaar af.
// Per datum zie je hoe de pluim verschuift: rood waar de nieuwe run warmer is dan de vorige, blauw waar hij kouder is.
// Ingegeven door hoe modelkijkers op Weerwoord.be runs bespreken: "gemiddelde afgekoeld", "oper flink afgekoeld",
// "laatste 3 dagen toonden de trend", "duimen voor het koude cluster", "1 lid met zes dagen rond -10".

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const nl = (x) => String(x).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export const SPEEDS = { rustig: 2600, normaal: 1800, vlot: 1100 };
const MORPH_SHARE = 0.55;   // deel van de beeldtijd dat de overgang duurt
const LAST_HOLD = 3200;     // langer stilstaan op de nieuwste run

// Velden per modus: [hoofdlijnen], band, controle, 'koude leden'-rijen
const MODES = {
  t2: {
    lines: [['tx', 'max'], ['tn', 'min']],
    bands: [['txP10', 'txP90'], ['tnP10', 'tnP90']],
    ctl: ['ctx', 'ctn'],
    rows: [['pFrost', 'vorst', 'Kans op nachtvorst (Tmin < 0°)'], ['pIce', 'ijs', 'Kans op een ijsdag (Tmax < 0°)']],
  },
  t850: {
    lines: [['t850', 'T850']],
    bands: [['t850P10', 't850P90']],
    ctl: ['c850'],
    rows: [['p850m5', '−5°', 'Leden met T850 onder −5°'], ['p850m10', '−10°', 'Leden met T850 onder −10°']],
  },
};
const FIELDS = ['tx', 'tn', 'txP10', 'txP90', 'tnP10', 'tnP90', 'ctx', 'ctn', 't850', 't850P10', 't850P90', 'c850', 'pFrost', 'pIce', 'p850m5', 'p850m10'];

// ---------- data ----------
export function runLabel(r) {
  if (r.run && !r.estimated) {
    const d = new Date(r.run);
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}z`;
  }
  const f = new Date(r.fetched);
  return `${f.getDate()}/${f.getMonth() + 1} ${f.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })}`;
}

// runs: nieuwste eerst (zoals in het archief). Geeft frames van oud naar nieuw, uitgelijnd op geldige datum.
export function buildFrames(runs, today, count = 12, horizon = 14) {
  const pick = runs.filter((r) => r?.dates && Object.keys(r.dates).length).slice(0, count).reverse();
  const dates = [];
  for (let i = 0; i <= horizon; i++) {
    const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const frames = pick.map((r) => ({
    label: runLabel(r),
    live: !!r.live,
    w814: r.w814 ?? null,
    v: Object.fromEntries(FIELDS.map((f) => [f, dates.map((d) => r.dates[d]?.[f] ?? null)])),
  }));
  return { dates, frames };
}

// Interpoleer twee frames (t = 0..1). Ontbreekt een waarde aan één kant, dan de andere.
export function lerpFrame(a, b, t) {
  if (!a) return b;
  const v = {};
  for (const f of FIELDS) {
    v[f] = b.v[f].map((y, i) => {
      const x = a.v[f][i];
      if (x == null) return y;
      if (y == null) return t < 0.5 ? x : null;
      return x + (y - x) * t;
    });
  }
  return { ...b, v };
}

// Verschil met de vorige run per datum (gemiddelde van de hoofdlijnen)
export function deltas(prev, cur, mode) {
  const keys = MODES[mode].lines.map(([k]) => k);
  return cur.v[keys[0]].map((_, i) => {
    const d = keys.map((k) => (cur.v[k][i] != null && prev?.v[k][i] != null ? cur.v[k][i] - prev.v[k][i] : null)).filter((x) => x != null);
    return d.length ? d.reduce((s, x) => s + x, 0) / d.length : null;
  });
}

// Hoe consistent zijn de laatste runs voor dag 8-14? Telt kouder/warmer-stappen.
export function consistency(frames) {
  const w = frames.map((f) => f.w814).filter((x) => x != null);
  if (w.length < 3) return null;
  const last = w.slice(-7);
  let colder = 0, warmer = 0;
  for (let i = 1; i < last.length; i++) { const d = last[i] - last[i - 1]; if (d <= -0.3) colder++; else if (d >= 0.3) warmer++; }
  const steps = last.length - 1;
  const total = r1(last[last.length - 1] - last[0]);
  let word;
  if (colder >= steps * 0.65) word = 'Duidelijke trend: run na run kouder';
  else if (warmer >= steps * 0.65) word = 'Duidelijke trend: run na run zachter';
  else if (colder && warmer && Math.min(colder, warmer) >= steps * 0.3) word = 'Heen-en-weer: de runs schuiven nog flink';
  else if (total <= -0.8 && warmer <= 1) word = 'Geleidelijke trend: langzaam kouder';
  else if (total >= 0.8 && colder <= 1) word = 'Geleidelijke trend: langzaam zachter';
  else word = 'Vrij stabiel tussen de runs';
  return { colder, warmer, steps, total, word, series: last };
}

// ---------- tekenen ----------
const W = 420, L = 40, R = 10;
function scale(frames, mode) {
  const m = MODES[mode];
  const keys = [...m.lines.map(([k]) => k), ...m.bands.flat(), ...m.ctl];
  let lo = Infinity, hi = -Infinity;
  for (const f of frames) for (const k of keys) for (const v of f.v[k]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { lo = -5; hi = 10; }
  lo = Math.floor((lo - 1) / 2) * 2; hi = Math.ceil((hi + 1) / 2) * 2;
  if (hi - lo < 8) { const c = (hi + lo) / 2; lo = Math.floor(c - 4); hi = Math.ceil(c + 4); }
  return { lo, hi };
}

function pathOf(arr, x, y) {
  let d = '', pen = false;
  arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  return d;
}

// Vlak tussen vorige en huidige lijn, per segment rood (warmer) of blauw (kouder); splitst bij snijpunt.
function diffFill(prev, cur, x, y, strength) {
  let out = '';
  const col = (d) => (d > 0 ? 'var(--warmer)' : 'var(--colder)');
  const op = (d) => Math.min(0.85, 0.32 + Math.abs(d) * 0.15) * strength;
  for (let i = 0; i < cur.length - 1; i++) {
    const a0 = prev[i], a1 = prev[i + 1], b0 = cur[i], b1 = cur[i + 1];
    if ([a0, a1, b0, b1].some((v) => v == null)) continue;
    const d0 = b0 - a0, d1 = b1 - a1;
    const poly = (xs, ya, yb, d) => {
      if (Math.abs(d) < 0.05) return '';
      const pts = [[xs[0], ya[0]], [xs[1], ya[1]], [xs[1], yb[1]], [xs[0], yb[0]]].map(([px, py]) => `${px.toFixed(1)},${y(py).toFixed(1)}`).join(' ');
      return `<polygon points="${pts}" fill="${col(d)}" fill-opacity="${op(d).toFixed(2)}"/>`;
    };
    if (d0 * d1 >= 0) out += poly([x(i), x(i + 1)], [a0, a1], [b0, b1], (d0 + d1) / 2);
    else {
      const f = d0 / (d0 - d1), xm = x(i) + (x(i + 1) - x(i)) * f, ym = a0 + (a1 - a0) * f;
      out += poly([x(i), xm], [a0, ym], [b0, ym], d0) + poly([xm, x(i + 1)], [ym, a1], [ym, b1], d1);
    }
  }
  return out;
}

export function filmSVG({ dates, frame, ghost, mode, sc, strength = 1, today }) {
  const m = MODES[mode];
  const T = 16, plotB = 214, rowH = 20, rowsTop = plotB + 40;
  const H = rowsTop + m.rows.length * (rowH + 3) + 4;
  const n = dates.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (t) => T + (1 - (t - sc.lo) / (sc.hi - sc.lo)) * (plotB - T);
  let g = '';
  // raster
  const step = sc.hi - sc.lo > 16 ? 4 : 2;
  for (let t = sc.lo; t <= sc.hi; t += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? 'var(--frost)' : 'var(--line)'}" stroke-width="${t === 0 ? 1.4 : 1}" ${t === 0 ? 'stroke-dasharray="5 4"' : ''}/>`;
    g += `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${t}°</text>`;
  }
  // betrouwbaarheid: na dag 10 vervaagt het beeld (forum: "als je niet verder dan 10 dagen kijkt…")
  const i10 = Math.min(n - 1, 10);
  g += `<rect x="${x(i10)}" y="${T}" width="${W - R - x(i10)}" height="${plotB - T}" fill="rgba(0,0,0,.10)"/>`;
  g += `<text x="${W - R - 4}" y="${T + 11}" text-anchor="end" font-size="9.5" fill="var(--ink-soft)">na dag 10: onzeker</text>`;
  dates.forEach((d, i) => {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (i > 0) g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${plotB}" stroke="var(--line)" stroke-dasharray="${wd === 1 ? '0' : '2 5'}" stroke-opacity=".7"/>`;
    if (i % 2 === 0) g += `<text x="${x(i)}" y="${plotB + 14}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${i === 0 ? 'vand.' : `${DAYS[wd]} ${Number(d.slice(8))}`}</text>`;
  });
  // spreiding (10-90%)
  m.bands.forEach(([lo, hi]) => {
    const up = [], dn = [];
    frame.v[hi].forEach((v, i) => { if (v != null && frame.v[lo][i] != null) up.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
    frame.v[lo].forEach((v, i) => { if (v != null && frame.v[hi][i] != null) dn.unshift(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
    if (up.length > 1) g += `<polygon points="${up.concat(dn).join(' ')}" fill="var(--ink)" opacity="0.08"/>`;
  });
  // rood/blauw verschil met de vorige run + vorige run als spoor
  if (ghost) {
    m.lines.forEach(([k]) => { g += diffFill(ghost.v[k], frame.v[k], x, y, strength); });
    m.lines.forEach(([k]) => { g += `<path d="${pathOf(ghost.v[k], x, y)}" fill="none" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.3" stroke-dasharray="3 3"/>`; });
  }
  // controlerun
  m.ctl.forEach((k) => { g += `<path d="${pathOf(frame.v[k], x, y)}" fill="none" stroke="var(--frost)" stroke-width="1.2" stroke-opacity=".75" stroke-dasharray="1 3" stroke-linecap="round"/>`; });
  // hoofdlijnen
  m.lines.forEach(([k, lab], li) => {
    g += `<path d="${pathOf(frame.v[k], x, y)}" fill="none" stroke="var(--ink)" stroke-width="${li === 0 ? 2.6 : 2}" stroke-linejoin="round"/>`;
    frame.v[k].forEach((v, i) => { if (v != null) g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${li === 0 ? 2.6 : 2.2}" fill="var(--ink)"/>`; });
    const firstI = frame.v[k].findIndex((v) => v != null);
    if (firstI >= 0 && m.lines.length > 1) g += `<text x="${x(firstI) + 4}" y="${y(frame.v[k][firstI]) + (li === 0 ? -9 : 16)}" font-size="10" fill="var(--ink-soft)">${lab}</text>`;
  });
  // verschillabels per datum (alleen duidelijke verschuivingen)
  if (ghost && strength > 0.6) {
    const dl = deltas(ghost, frame, mode);
    dl.forEach((d, i) => {
      if (d == null || Math.abs(d) < 1) return;
      const top = Math.min(...m.lines.map(([k]) => frame.v[k][i]).filter((v) => v != null));
      const ty = Math.min(plotB - 4, y(top) + 16);
      g += `<text x="${x(i)}" y="${ty}" text-anchor="middle" font-size="10" font-weight="700" class="fnum" fill="${d > 0 ? 'var(--warmer)' : 'var(--colder)'}">${d > 0 ? '+' : '−'}${nl(Math.abs(d).toFixed(1))}</text>`;
    });
  }
  // 'koude leden': aandeel van het ensemble per datum
  m.rows.forEach(([k, lab], r) => {
    const y0 = rowsTop + r * (rowH + 3);
    const cw = (W - L - R) / (n - 1);
    g += `<text x="${(L - cw / 2 - 3).toFixed(1)}" y="${y0 + 14}" text-anchor="end" font-size="9.5" fill="var(--ink-soft)">${lab}</text>`;
    frame.v[k].forEach((v, i) => {
      const cx = x(i) - cw / 2;
      const a = v == null ? 0 : 0.06 + Math.min(1, v / 100) * 0.9;
      g += `<rect x="${(cx + 1).toFixed(1)}" y="${y0}" width="${(cw - 2).toFixed(1)}" height="${rowH}" rx="3" fill="rgba(191,230,255,${a.toFixed(2)})"/>`;
      if (v != null && v >= 5) g += `<text x="${(cx + cw / 2).toFixed(1)}" y="${y0 + 14}" text-anchor="middle" font-size="9.5" class="fnum" fill="${v >= 55 ? '#0d2a45' : 'var(--ink)'}">${Math.round(v)}</text>`;
    });
  });
  g += `<text x="${L}" y="${rowsTop - 6}" font-size="9.5" fill="var(--ink-soft)">Koude leden (% van het ensemble)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Run-film: pluim per run">${g}</svg>`;
}

// ---------- afspelen ----------
const F = { els: null, data: null, mode: 't2', idx: 0, playing: false, speed: 'normaal', timer: null, raf: null, sc: null, model: '', today: '' };

function reduced() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

function render(frame, ghost, strength) {
  F.els.svg.innerHTML = filmSVG({ dates: F.data.dates, frame, ghost, mode: F.mode, sc: F.sc, strength, today: F.today });
}

function caption(i) {
  const fr = F.data.frames, cur = fr[i], prev = fr[i - 1];
  const fromEnd = fr.length - 1 - i;
  F.els.run.textContent = cur.live ? 'nieuwste data' : `run ${cur.label}`;
  F.els.pos.textContent = fromEnd === 0 ? 'nieuwste run' : `${fromEnd} ${fromEnd === 1 ? 'run' : 'runs'} eerder`;
  F.els.slider.value = String(i);
  let txt = '';
  if (prev) {
    const dl = deltas(prev, cur, F.mode);
    const pick = (a, b) => { const v = dl.slice(a, b + 1).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const w1 = pick(1, 7), w2 = pick(8, 14);
    const part = (v, lab) => (v == null ? '' : Math.abs(v) < 0.3 ? `${lab} gelijk` : `${lab} <b class="${v < 0 ? 'c' : 'w'}">${nl(Math.abs(v).toFixed(1))}° ${v < 0 ? 'kouder' : 'warmer'}</b>`);
    const parts = [part(w1, 'dag 1–7'), part(w2, 'dag 8–14')].filter(Boolean);
    txt = parts.length ? `Tegen de vorige run: ${parts.join(', ')}.` : 'Geen overlap met de vorige run om te vergelijken.';
  } else txt = 'Oudste run in de film.';
  // opvallende koude leden (forum: "1 lid met zes dagen rond -10")
  const key = F.mode === 't2' ? 'pIce' : 'p850m10';
  const best = cur.v[key].reduce((a, v, j) => (v != null && (a == null || v > cur.v[key][a]) ? j : a), null);
  if (best != null && cur.v[key][best] >= 10) {
    const d = F.data.dates[best];
    txt += ` Koudste signaal: ${cur.v[key][best]}% ${F.mode === 't2' ? 'kans op een ijsdag' : 'van de leden onder −10° op 850 hPa'} op ${DAYS[new Date(d + 'T12:00:00Z').getUTCDay()]} ${Number(d.slice(8))}.`;
  }
  F.els.text.innerHTML = txt;
}

function stop() { clearTimeout(F.timer); cancelAnimationFrame(F.raf); }

function showStatic(i) {
  stop();
  F.idx = i;
  const fr = F.data.frames;
  render(fr[i], fr[i - 1] || null, 1);
  caption(i);
}

// Vloeiende overgang van frame i-1 naar i: lijnen schuiven, daarna kleurt het verschil op
function animateTo(i, done) {
  const fr = F.data.frames, from = fr[i - 1], to = fr[i];
  const dur = SPEEDS[F.speed] * MORPH_SHARE;
  const t0 = performance.now();
  caption(i);
  F.idx = i;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = ease(t);
    render(lerpFrame(from, to, e), from, Math.max(0, (t - 0.25) / 0.75));
    if (t < 1) F.raf = requestAnimationFrame(step); else done?.();
  };
  F.raf = requestAnimationFrame(step);
}

function loop() {
  stop();
  if (!F.playing) return;
  const fr = F.data.frames;
  const next = F.idx >= fr.length - 1 ? 0 : F.idx + 1;
  if (next === 0) { showStatic(0); F.timer = setTimeout(loop, SPEEDS[F.speed] * 0.6); return; }
  animateTo(next, () => {
    const hold = next === fr.length - 1 ? LAST_HOLD : SPEEDS[F.speed] * (1 - MORPH_SHARE);
    F.timer = setTimeout(loop, hold);
  });
}

function setPlaying(on) {
  F.playing = on;
  const b = F.els.play;
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Pauzeer run-film' : 'Speel run-film af');
  b.innerHTML = on
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7Z" fill="currentColor"/></svg>';
  if (on) {
    if (F.idx >= F.data.frames.length - 1) { showStatic(0); F.timer = setTimeout(loop, 700); } else loop();
  } else stop();
}

function sparkline(c) {
  if (!c) return '';
  const w = 120, h = 30, s = c.series, lo = Math.min(...s), hi = Math.max(...s), span = Math.max(1, hi - lo);
  const x = (i) => 3 + (i / (s.length - 1)) * (w - 6), y = (v) => 4 + (1 - (v - lo) / span) * (h - 8);
  let g = `<path d="${s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="1.8"/>`;
  s.forEach((v, i) => { if (i) { const d = v - s[i - 1]; g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${d <= -0.3 ? 'var(--colder)' : d >= 0.3 ? 'var(--warmer)' : 'var(--ink-soft)'}"/>`; } });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${g}</svg>`;
}

function renderMeta() {
  const c = consistency(F.data.frames);
  F.els.trend.innerHTML = c
    ? `${sparkline(c)}<p><b>${esc(c.word)}</b><span>Dag 8–14 over de laatste ${c.steps + 1} runs: ${c.colder}× kouder, ${c.warmer}× warmer${c.total != null ? `, samen ${c.total > 0 ? '+' : '−'}${nl(Math.abs(c.total).toFixed(1))}°` : ''}.</span></p>`
    : '';
}

export function setRunFilm(runs, { model, today, count }) {
  if (!F.els) return;
  stop();
  F.model = model; F.today = today;
  F.data = buildFrames(runs, today, count || Number(F.els.count.value) || 12);
  const n = F.data.frames.length;
  F.els.box.hidden = false;
  if (n < 2) {
    F.els.svg.innerHTML = '';
    F.els.text.textContent = 'De run-film verschijnt zodra er minstens twee runs van dit model zijn bewaard.';
    F.els.run.textContent = ''; F.els.pos.textContent = ''; F.els.trend.innerHTML = '';
    F.els.controls.hidden = true;
    return;
  }
  F.els.controls.hidden = false;
  // Niet elk model levert T850 (GEFS en ICON niet via de bron): knop uitschakelen en terugvallen op max/min
  const has850 = F.data.frames.some((f) => f.v.t850.some((v) => v != null));
  const b850 = F.els.modes.querySelector('button[data-mode=t850]');
  b850.disabled = !has850;
  b850.title = has850 ? '' : 'Dit model levert geen T850';
  if (!has850 && F.mode === 't850') {
    F.mode = 't2';
    for (const x of F.els.modes.querySelectorAll('button')) x.setAttribute('aria-checked', String(x.dataset.mode === 't2'));
  }
  F.sc = scale(F.data.frames, F.mode);
  F.els.slider.max = String(n - 1);
  renderMeta();
  showStatic(n - 1);
  if (F.playing && !reduced()) setPlaying(true);
}

export function initRunFilm(els, getRuns) {
  F.els = els;
  const rebuild = () => { const r = getRuns(); if (r) setRunFilm(r.runs, { model: r.model, today: r.today }); };
  setPlaying(false);
  els.play.addEventListener('click', () => setPlaying(!F.playing));
  els.slider.addEventListener('input', () => { setPlaying(false); showStatic(Number(els.slider.value)); });
  els.prev.addEventListener('click', () => { setPlaying(false); showStatic(Math.max(0, F.idx - 1)); });
  els.next.addEventListener('click', () => {
    setPlaying(false);
    if (F.idx < F.data.frames.length - 1) { if (reduced()) showStatic(F.idx + 1); else animateTo(F.idx + 1); }
  });
  els.modes.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    F.mode = b.dataset.mode;
    for (const x of els.modes.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    const was = F.playing; F.playing = false; rebuild(); if (was) setPlaying(true);
  });
  els.speed.addEventListener('change', () => { F.speed = els.speed.value; });
  els.count.addEventListener('change', () => { const was = F.playing; F.playing = false; rebuild(); if (was) setPlaying(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && F.playing) setPlaying(false); });
}

export function stopRunFilm() { if (F.els && F.playing) setPlaying(false); }
