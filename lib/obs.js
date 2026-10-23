// Winterwacht — tabblad 'Gemeten': waarnemingen, neerslagsommen en modelcheck voor de gekozen plek.
import {
  TZ, STATIONS, METHODS, MAX_STATION_KM, CHECK_MODELS, LEAD_GROUPS, WINDOWS_H,
  localParts, localToEpoch, dayStart, addDayKey, distKm, nearestStationKm, idwWeights,
  parseArchive, stationFine, fineSeries, hourlyFromFine, knmiHourlyBody, parseKnmiHourly, mergeHourly, placeHourly,
  parseBuienradar, liveForPlace, buildPieces, sumBetween, rainWindows, rainByDay, chartPoints, previousRunsUrl, scoreModel, pickWinners,
} from './obsdata.js?v=20';
import { beaufort, compass } from './hourly.js?v=20';

const ARCHIVE_URL = 'https://raw.githubusercontent.com/eddydekker-coder/winterwacht/obs-data/obs.json';
const LIVE_URL = 'https://data.buienradar.nl/2.0/feed/json';
const KNMI_URL = 'https://www.daggegevens.knmi.nl/klimatologie/uurgegevens';
const SVGNS = 'http://www.w3.org/2000/svg';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nlnum = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−'));
const fmtMm = (x) => (x == null ? '–' : x < 0.05 ? '0' : nlnum(x, x < 100 ? 1 : 0));
const tFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const wFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric' });
const hhmm = (t) => tFmt.format(new Date(t * 1000));
const dayName = (key) => dFmt.format(new Date(dayStart(key) * 1000 + 6 * 3600e3)).replace('.', '');
const ago = (sec) => (sec < 90 ? 'zojuist' : sec < 5400 ? `${Math.round(sec / 60)} min geleden` : sec < 172800 ? `${Math.round(sec / 3600)} uur geleden` : `${Math.round(sec / 86400)} dagen geleden`);
const nowSec = () => Math.floor(Date.now() / 1000);

const PERIODS = { '24h': { label: '24 uur', sec: 86400, fine: true }, '3d': { label: '3 dagen', sec: 3 * 86400, fine: true }, '7d': { label: '7 dagen', sec: 7 * 86400, fine: false }, '14d': { label: '14 dagen', sec: 14 * 86400, fine: false } };
const CHECK_PERIODS = { 7: '7 dagen', 14: '14 dagen', 30: '30 dagen' };
const CHECK_VARS_UI = {
  ta: { label: 'Temperatuur', unit: '°', fmt: (x) => nlnum(x, 1), what: 'gemiddelde afwijking per uur, in graden' },
  ff: { label: 'Wind', unit: ' km/u', fmt: (x) => nlnum(x, 1), what: 'gemiddelde afwijking per uur, in km/u' },
  rain: { label: 'Neerslag', unit: ' mm', fmt: (x) => nlnum(x, 2), what: 'gemiddelde afwijking per blok van 6 uur, in mm' },
};

export function initObs(els, getLoc) {
  const S = {
    sub: 'trace', period: '24h', method: 'two', checkDays: 14, checkVar: 'ta',
    arc: null, arcErr: null, live: null, liveErr: null, knmi: null, knmiDays: 0, knmiErr: null,
    models: null, modelsDays: 0, modelsErr: null, modelsKey: '', visible: false, timer: null, loading: false,
    trace: null, lastRefresh: 0,
  };
  const loc = () => getLoc();
  const ids = () => METHODS[S.method].ids;

  // ---------- data ophalen ----------
  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function loadArchive() {
    try {
      const j = await getJSON(`${ARCHIVE_URL}?t=${Math.floor(Date.now() / 60000)}`);
      S.arc = parseArchive(j);
      S.arcErr = S.arc ? null : 'leeg archief';
    } catch (e) { S.arcErr = e.message; }
  }
  async function loadLive() {
    try {
      S.live = parseBuienradar(await getJSON(`${LIVE_URL}?t=${Math.floor(Date.now() / 60000)}`));
      S.liveErr = Object.keys(S.live).length ? null : 'geen stations in de feed';
    } catch (e) { S.liveErr = e.message; }
  }
  async function ensureKnmi(days) {
    if (S.knmi && S.knmiDays >= days && Date.now() - S.knmi.t < 30 * 60e3) return;
    const today = localParts(nowSec()).key;
    const body = knmiHourlyBody(addDayKey(today, -days), today, Object.values(STATIONS).map((s) => s.knmi));
    try {
      const res = await fetch(KNMI_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      S.knmi = { t: Date.now(), byId: parseKnmiHourly(await res.text()) };
      S.knmiDays = days; S.knmiErr = null;
    } catch (e) { S.knmiErr = e.message; }
  }
  async function ensureModels(days) {
    const key = `${loc().lat.toFixed(3)},${loc().lon.toFixed(3)}`;
    if (S.models && S.modelsDays >= days && S.modelsKey === key && Date.now() - S.models.t < 3 * 3600e3) return;
    const out = {};
    let fails = 0;
    await Promise.all(CHECK_MODELS.map(async (m) => {
      try { out[m.key] = await getJSON(previousRunsUrl(m.key, loc(), days)); } catch { fails++; }
    }));
    if (Object.keys(out).length) { S.models = { t: Date.now(), byModel: out }; S.modelsDays = days; S.modelsKey = key; S.modelsErr = fails ? `${fails} model(len) niet beschikbaar` : null; }
    else S.modelsErr = 'de modelarchieven zijn nu niet bereikbaar';
  }

  // ---------- afgeleide reeksen ----------
  function derived() {
    const L = loc();
    const use = ids();
    const d = { fine: null, hourly: new Map(), knmiHourly: new Map(), stFine: {}, stHourly: {}, stKnmi: {}, liveP: null };
    if (S.arc) {
      d.fine = fineSeries(S.arc, L, use);
      for (const id of Object.keys(STATIONS)) {
        const f = stationFine(S.arc, id);
        if (f) { d.stFine[id] = f; }
      }
    }
    const merged = {}, knmiOnly = {};
    for (const id of Object.keys(STATIONS)) {
      const k = S.knmi?.byId?.[id] || null;
      if (k) knmiOnly[id] = k;
      const a = d.stFine[id] ? hourlyFromFine(d.stFine[id]) : null;
      d.stHourly[id] = mergeHourly(k, a);
      merged[id] = d.stHourly[id];
      d.stKnmi[id] = k;
    }
    d.hourly = placeHourly(merged, L, use);
    d.knmiHourly = placeHourly(knmiOnly, L, use.filter((i) => knmiOnly[i]));
    d.liveP = S.live ? liveForPlace(S.live, L, use) : null;
    // 'nu': het live-tijdstip, anders de laatste archiefstap
    const lastFine = S.arc ? S.arc.last : null;
    d.now = d.liveP?.ts ?? lastFine ?? nowSec();
    d.pieces = buildPieces({ knmiHourly: d.knmiHourly, fine: d.fine, now: d.now, liveR1h: d.liveP?.r1h ?? null });
    return d;
  }

  // ---------- 'nu' ----------
  function nowBlock(d) {
    const L = loc();
    const lp = d.liveP;
    // zonder live-feed: laatste punt uit het archief
    let cur = lp;
    if (!cur && d.fine) {
      let k = d.fine.n - 1;
      while (k > 0 && d.fine.ta[k] == null) k--;
      cur = { ts: d.fine.t0 + k * d.fine.step, ta: d.fine.ta[k], feel: null, ff: d.fine.ff[k], dd: d.fine.dd[k], fx: d.fine.fx[k], rg: d.fine.mm[k] == null ? null : (d.fine.mm[k] * 3600) / d.fine.step, r1h: null, r24h: null, rh: null, stations: ids() };
    }
    if (!cur) {
      els.head.textContent = 'Geen waarnemingen beschikbaar';
      els.headSub.textContent = 'De live-feed en het archief zijn nu niet bereikbaar. Probeer het straks opnieuw.';
      els.tiles.innerHTML = ''; els.stations.innerHTML = '';
      return;
    }
    const kmh = cur.ff == null ? null : cur.ff * 3.6;
    const bft = kmh == null ? null : beaufort(kmh);
    const gustKmh = cur.fx == null ? null : cur.fx * 3.6;
    const wet = (cur.rg ?? 0) >= 0.1;
    els.head.textContent = `${nlnum(cur.ta, 1)}° ${wet ? 'met neerslag' : bft >= 6 ? 'en stevige wind' : 'en droog'}`;
    const age = nowSec() - cur.ts;
    const names = (cur.stations || ids()).map((i) => STATIONS[i].name);
    els.headSub.innerHTML = `Gemeten om ${hhmm(cur.ts)} (${ago(age)}). Geschat voor ${esc(L.name)} uit ${esc(names.join(' en '))}.${age > 3 * 3600 ? ' <span class="err">De live-feed loopt achter.</span>' : ''}`;
    // temperatuurverandering t.o.v. een uur eerder, uit het archief
    let trend = '';
    if (d.fine) {
      const k = Math.round((cur.ts - 3600 - d.fine.t0) / d.fine.step);
      const prev = d.fine.ta[k];
      if (prev != null && cur.ta != null) {
        const dlt = cur.ta - prev;
        trend = Math.abs(dlt) < 0.15 ? 'gelijk aan een uur geleden' : `${dlt > 0 ? '+' : '−'}${nlnum(Math.abs(dlt), 1)}° t.o.v. een uur geleden`;
      }
    }
    const arrow = cur.dd == null ? '' : `<svg class="warrow" viewBox="-8 -8 16 16" style="transform:rotate(${Math.round(cur.dd + 180)}deg)" aria-hidden="true"><path d="M0 -6 L4 5 L0 2.5 L-4 5 Z" fill="currentColor"/></svg>`;
    const rainNow = cur.rg;
    els.tiles.innerHTML = `
      <div class="otile"><span class="ol">Temperatuur</span><b class="onum">${nlnum(cur.ta, 1)}°</b><span class="os">${cur.feel != null ? `voelt als ${nlnum(cur.feel, 1)}°` : ''}${trend ? `${cur.feel != null ? ' · ' : ''}${trend}` : ''}</span></div>
      <div class="otile"><span class="ol">Wind</span><b class="onum">${bft == null ? '–' : bft}<small> Bft</small>${arrow}</b><span class="os">${kmh == null ? '' : `${nlnum(kmh, 0)} km/u`}${cur.dd != null ? ` uit ${compass(cur.dd)}` : ''}${gustKmh != null ? ` · stoten ${nlnum(gustKmh, 0)}` : ''}</span></div>
      <div class="otile"><span class="ol">Neerslag nu</span><b class="onum">${nlnum(rainNow, 1)}<small> mm/u</small></b><span class="os">${cur.r1h != null ? `laatste uur ${fmtMm(cur.r1h)} mm` : 'intensiteit van dit moment'}</span></div>
      <div class="otile"><span class="ol">Laatste 24 uur</span><b class="onum">${cur.r24h != null ? fmtMm(cur.r24h) : fmtMm(rainWindows(d.pieces, d.now, null).find((w) => w.h === 24)?.mm)}<small> mm</small></b><span class="os">${cur.rh != null ? `luchtvochtigheid ${nlnum(cur.rh, 0)}%` : 'gevallen neerslag'}</span></div>`;
    // per station
    const use = ids();
    const w = idwWeights(L, use);
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    const rows = use.map((id) => {
      const s = S.live?.[id];
      const km = distKm(L, STATIONS[id]);
      return `<tr><td>${esc(STATIONS[id].name)}</td><td>${nlnum(km, 0)} km</td><td>${nlnum((w[id] / tot) * 100, 0)}%</td>
        <td>${s ? `${nlnum(s.ta, 1)}°` : '–'}</td><td>${s && s.ff != null ? `${nlnum(s.ff * 3.6, 0)} km/u${s.dd != null ? ` ${compass(s.dd)}` : ''}` : '–'}</td><td>${s ? `${nlnum(s.rg, 1)} · ${fmtMm(s.r1h)}` : '–'}</td></tr>`;
    }).join('');
    els.stations.innerHTML = `<details class="ostat"><summary>Per meetstation <span>zo komt de schatting voor ${esc(L.name)} tot stand</span></summary>
      <div class="tablewrap"><table class="otable"><thead><tr><th>Station</th><th>Afstand</th><th>Gewicht</th><th>Temp</th><th>Wind</th><th>Regen mm/u · uur</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Het gewicht is omgekeerd evenredig met het kwadraat van de afstand: wat dichterbij ligt, telt zwaarder. Wind wordt als vector gemiddeld, dus 350° en 10° geven noord en niet zuid. Ontbreekt een waarde bij één station, dan tellen de overige stations voor 100%.</p></details>`;
  }

  // ---------- verloop (grafieken) ----------
  const COLD = [[-10, '#4c8dff'], [-2, '#7dc4ff'], [3, '#cfe9ff'], [9, '#f1efe6'], [15, '#ffd9a8'], [22, '#ff9a5a']];
  function niceTicks(lo, hi, want = 4) {
    const span = Math.max(hi - lo, 1e-6);
    const raw = span / want;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const t = [];
    for (let v = a; v <= b + step * 1e-6; v += step) t.push(Math.round(v * 1000) / 1000);
    return { ticks: t, lo: a, hi: b, step };
  }
  function xTicks(from, to, key) {
    const out = [];
    const k0 = localParts(from).key;
    for (let i = -1; i < 16; i++) {
      const dk = addDayKey(k0, i);
      const [y, m, d] = dk.split('-').map(Number);
      const hours = key === '24h' ? [0, 3, 6, 9, 12, 15, 18, 21] : key === '3d' ? [0, 12] : [0];
      for (const h of hours) {
        const t = localToEpoch(y, m, d, h);
        if (t < from || t > to) continue;
        const major = h === 0;
        let label;
        if (key === '24h') label = h === 0 ? wFmt.format(new Date(t * 1000)).replace('.', '') : `${String(h).padStart(2, '0')}`;
        else if (key === '3d') label = h === 0 ? wFmt.format(new Date(t * 1000)).replace('.', '') : '12';
        else if (key === '7d') label = wFmt.format(new Date(t * 1000)).replace('.', '');
        else label = String(d);
        out.push({ t, major, label });
      }
    }
    if (key === '14d') return out.filter((_, i) => i % 2 === 0);
    return out;
  }
  function segPath(pts, X, Y, key, maxGap) {
    let dstr = '', open = false, lastT = null;
    for (const p of pts) {
      const v = p[key];
      if (v == null || (open && p.t - lastT > maxGap)) { open = false; }
      if (v == null) continue;
      dstr += `${open ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(v).toFixed(1)}`;
      open = true; lastT = p.t;
    }
    return dstr;
  }
  function traceChart(d) {
    const per = PERIODS[S.period];
    const to = d.now ?? nowSec();
    const from = to - per.sec;
    const pts = chartPoints({ fine: d.fine, hourly: d.hourly, from, to, useFine: per.fine });
    S.trace = null;
    if (pts.length < 2) return '<p class="note">Voor deze periode zijn nog geen waarnemingen beschikbaar.</p>';
    const W = 360, Lm = 36, Rm = 10;
    const X = (t) => Lm + ((t - from) / (to - from)) * (W - Lm - Rm);
    const maxGap = Math.max(...pts.map((p) => p.len)) * 2.6;
    // temperatuur
    const tv = pts.map((p) => p.ta).filter((v) => v != null);
    const tk = niceTicks(Math.min(...tv, 0.5) - 0.3, Math.max(...tv) + 0.3, 4);
    const T0 = 8, TH = 100;
    const YT = (v) => T0 + TH - ((v - tk.lo) / (tk.hi - tk.lo)) * TH;
    // wind
    const wv = pts.flatMap((p) => [p.ff, p.fx]).filter((v) => v != null).map((v) => v * 3.6);
    const wk = niceTicks(0, Math.max(30, Math.max(...wv, 0) * 1.05), 4);
    const W0 = T0 + TH + 14, WH = 112, ARR = 16;
    const YW = (ms) => W0 + ARR + (WH - ARR) - (ms * 3.6 / wk.hi) * (WH - ARR);
    // neerslag
    const rate = (p) => (p.mm == null ? null : (p.mm * 3600) / p.len);
    const rv = pts.map(rate).filter((v) => v != null);
    const rk = niceTicks(0, Math.max(2, Math.max(...rv, 0) * 1.05), 3);
    const R0 = W0 + WH + 14, RH = 78;
    const YR = (v) => R0 + RH - (v / rk.hi) * RH;
    const H = R0 + RH + 22;
    const xt = xTicks(from, to, S.period);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verloop van temperatuur, wind en neerslag" class="ochartsvg">`;
    // kleurverloop op temperatuur
    const stops = COLD.map(([t, c]) => {
      const off = Math.min(1, Math.max(0, 1 - (t - tk.lo) / (tk.hi - tk.lo)));
      return `<stop offset="${off.toFixed(3)}" stop-color="${c}"/>`;
    }).sort((a, b) => parseFloat(a.match(/offset="([^"]+)"/)[1]) - parseFloat(b.match(/offset="([^"]+)"/)[1])).join('');
    s += `<defs><linearGradient id="otg" gradientUnits="userSpaceOnUse" x1="0" y1="${T0}" x2="0" y2="${T0 + TH}">${stops}</linearGradient></defs>`;
    // verticale rasterlijnen
    for (const t of xt) s += `<line x1="${X(t.t).toFixed(1)}" x2="${X(t.t).toFixed(1)}" y1="${T0}" y2="${R0 + RH}" class="${t.major ? 'ogrid maj' : 'ogrid'}"/>`;
    const panel = (y0, h, label, ticks, Y, fmt) => {
      let o = `<text x="${Lm + 2}" y="${y0 + 8}" class="olab">${label}</text>`;
      for (const v of ticks) { const y = Y(v); o += `<line x1="${Lm}" x2="${W - Rm}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="ohz"/><text x="${Lm - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="otick">${fmt(v)}</text>`; }
      return o;
    };
    s += panel(T0, TH, 'Temperatuur °C', tk.ticks, YT, (v) => nlnum(v, tk.step < 1 ? 1 : 0));
    if (tk.lo < 0 && tk.hi > 0) s += `<line x1="${Lm}" x2="${W - Rm}" y1="${YT(0).toFixed(1)}" y2="${YT(0).toFixed(1)}" class="ofreeze"/>`;
    s += `<path d="${segPath(pts, X, YT, 'ta', maxGap)}" class="otline"/>`;
    // wind: vlak voor gemiddelde, stippellijn voor stoten
    s += panel(W0, WH, 'Wind km/u', wk.ticks, (v) => YW(v / 3.6), (v) => nlnum(v, 0));
    for (const [kmh, b] of [[20, 4], [39, 6], [62, 8]]) if (kmh < wk.hi) s += `<line x1="${Lm}" x2="${W - Rm}" y1="${YW(kmh / 3.6).toFixed(1)}" y2="${YW(kmh / 3.6).toFixed(1)}" class="obft"/><text x="${W - Rm - 1}" y="${(YW(kmh / 3.6) - 2).toFixed(1)}" text-anchor="end" class="obfttxt">${b} Bft</text>`;
    const wp = segPath(pts, X, YW, 'ff', maxGap);
    if (wp) {
      const first = pts.find((p) => p.ff != null), last = [...pts].reverse().find((p) => p.ff != null);
      s += `<path d="${wp}L${X(last.t).toFixed(1)} ${YW(0)}L${X(first.t).toFixed(1)} ${YW(0)}Z" class="owarea"/><path d="${wp}" class="owline"/>`;
    }
    s += `<path d="${segPath(pts, X, YW, 'fx', maxGap)}" class="ogust"/>`;
    // pijltjes: de wind waait in de richting waarin ze wijzen
    const gap = 30;
    let lastX = -1e9;
    for (const p of pts) {
      if (p.dd == null || p.ff == null) continue;
      const x = X(p.t);
      if (x - lastX < gap || x < Lm + 52 || x > W - Rm - 4) continue;
      lastX = x;
      s += `<g transform="translate(${x.toFixed(1)} ${W0 + 8}) rotate(${Math.round(p.dd + 180)})" class="oarr"><path d="M0 -5 L3.2 4 L0 2 L-3.2 4 Z"/></g>`;
    }
    // neerslag
    s += panel(R0, RH, 'Neerslag mm/u', rk.ticks, YR, (v) => nlnum(v, rk.step < 1 ? 1 : 0));
    for (const p of pts) {
      const r = rate(p);
      if (r == null || r < 0.05) continue;
      const x2 = X(p.t), x1 = X(p.t - p.len);
      const cls = r >= 7.5 ? 'orb3' : r >= 2.5 ? 'orb2' : 'orb1';
      s += `<rect x="${x1.toFixed(1)}" y="${YR(r).toFixed(1)}" width="${Math.max(0.9, x2 - x1 - (p.len > 900 ? 0.6 : 0)).toFixed(1)}" height="${(R0 + RH - YR(r)).toFixed(1)}" class="${cls}"/>`;
    }
    // x-as
    for (const t of xt) s += `<text x="${X(t.t).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="${t.major ? 'otick maj' : 'otick'}">${esc(t.label)}</text>`;
    s += `<line id="ocross" x1="0" x2="0" y1="${T0}" y2="${R0 + RH}" class="ocross" visibility="hidden"/></svg>`;
    S.trace = { pts, from, to, W, Lm, Rm, X };
    return s;
  }
  function readoutAt(clientX) {
    const T = S.trace;
    const svg = els.chart.querySelector('svg');
    if (!T || !svg) return;
    const r = svg.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * T.W;
    const t = T.from + ((xv - T.Lm) / (T.W - T.Lm - T.Rm)) * (T.to - T.from);
    let best = null, bd = Infinity;
    for (const p of T.pts) { const dd = Math.abs(p.t - t); if (dd < bd) { bd = dd; best = p; } }
    if (!best) return;
    const cross = svg.querySelector('#ocross');
    cross.setAttribute('x1', T.X(best.t)); cross.setAttribute('x2', T.X(best.t)); cross.setAttribute('visibility', 'visible');
    const rate = best.mm == null ? null : (best.mm * 3600) / best.len;
    const lp = localParts(best.t);
    els.read.innerHTML = `<b>${esc(dayName(lp.key))} ${hhmm(best.t)}</b> · ${nlnum(best.ta, 1)}° · ${best.ff == null ? '–' : nlnum(best.ff * 3.6, 0)} km/u${best.dd != null ? ` ${compass(best.dd)}` : ''}${best.fx != null ? ` (stoot ${nlnum(best.fx * 3.6, 0)})` : ''} · ${rate == null ? '–' : nlnum(rate, 1)} mm/u`;
  }

  // ---------- neerslag ----------
  function rainBlock(d) {
    const L = loc();
    const now = d.now;
    const live = d.liveP;
    const wins = rainWindows(d.pieces, now, live?.r1h ?? null);
    // per station
    const cols = ['06278', '06279', ...(S.method === 'four' ? ['06273', '06290'] : [])];
    const stWins = {};
    for (const id of cols) {
      const f = d.stFine[id] || null;
      const p = buildPieces({ knmiHourly: d.stKnmi[id], fine: f, now, liveR1h: S.live?.[id]?.r1h ?? null });
      stWins[id] = rainWindows(p, now, S.live?.[id]?.r1h ?? null);
    }
    const max24 = Math.max(0.5, ...wins.map((w) => w.mm));
    const wlabel = (h) => (h === 1 ? 'Laatste uur' : `Laatste ${h} uur`);
    const rows = wins.map((w, i) => {
      const flag = w.coverage < 0.9 ? ` <span class="oflag" title="Niet de hele periode is gemeten (${Math.round(w.coverage * 100)}%)">~</span>` : '';
      return `<tr><td>${wlabel(w.h)}</td><td class="oplace"><b>${fmtMm(w.mm)}</b>${flag}<i class="obar" style="width:${Math.max(2, (w.mm / max24) * 100).toFixed(0)}%"></i></td>${cols.map((id) => `<td>${fmtMm(stWins[id][i].mm)}</td>`).join('')}</tr>`;
    }).join('');
    const head = `<tr><th>Periode (t/m ${hhmm(now)})</th><th>${esc(L.name)} (mm)</th>${cols.map((id) => `<th>${esc(STATIONS[id].name)}</th>`).join('')}</tr>`;
    els.rainTable.innerHTML = `<div class="tablewrap"><table class="otable orain"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;

    // 'sinds'-curve: hoeveel is er sinds dat moment gevallen
    const W = 360, Lm = 34, Rm = 10, T0 = 14, H0 = 130, Hh = 24 * 3600;
    const step = 600;
    const series = [];
    for (let t = now - Hh; t <= now; t += step) series.push([t, sumBetween(d.pieces.pieces, t, now).mm]);
    const top = niceTicks(0, Math.max(1, ...series.map((x) => x[1])) * 1.08, 4);
    const X = (t) => Lm + ((t - (now - Hh)) / Hh) * (W - Lm - Rm);
    const Y = (v) => T0 + H0 - (v / top.hi) * H0;
    let s = `<svg viewBox="0 0 ${W} ${T0 + H0 + 28}" role="img" aria-label="Neerslag sinds een eerder moment" class="ochartsvg">`;
    for (const v of top.ticks) s += `<line x1="${Lm}" x2="${W - Rm}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ohz"/><text x="${Lm - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="otick">${nlnum(v, top.step < 1 ? 1 : 0)}</text>`;
    const path = series.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    s += `<path d="${path}L${X(now)} ${Y(0)}L${X(now - Hh)} ${Y(0)}Z" class="owarea rain"/><path d="${path}" class="orline"/>`;
    for (const h of [3, 6, 9, 12]) {
      const w = wins.find((x) => x.h === h);
      const x = X(now - h * 3600), y = Y(w.mm);
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T0}" y2="${T0 + H0}" class="obft"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" class="odot"/>`;
      s += `<text x="${x.toFixed(1)}" y="${Math.max(T0 + 8, y - 6).toFixed(1)}" text-anchor="middle" class="oval">${fmtMm(w.mm)}</text>`;
      s += `<text x="${x.toFixed(1)}" y="${T0 + H0 + 14}" text-anchor="middle" class="otick">−${h} u</text>`;
    }
    const w24 = wins.find((x) => x.h === 24);
    s += `<text x="${Lm + 2}" y="${Math.max(T0 + 8, Y(w24.mm) - 6).toFixed(1)}" class="oval">${fmtMm(w24.mm)}</text><text x="${Lm}" y="${T0 + H0 + 14}" class="otick">−24 u</text><text x="${W - Rm}" y="${T0 + H0 + 14}" text-anchor="end" class="otick">nu</text>`;
    s += '</svg>';
    els.rainCurve.innerHTML = s;

    // per datum en tijdsvak
    const days = rainByDay(d.pieces, now, 14);
    const maxDay = Math.max(1, ...days.map((x) => (x.coverage >= 0.5 && x.mm != null ? x.mm : 0)));
    const cell = (c) => {
      if (c.future) return '<span class="oc dim">·</span>';
      if (c.coverage < 0.5) return '<span class="oc dim">–</span>';
      const a = Math.min(0.85, c.mm / 8);
      return `<span class="oc" style="background:rgba(124,200,255,${(c.mm < 0.05 ? 0 : 0.12 + a).toFixed(2)})">${fmtMm(c.mm)}${c.coverage < 0.9 ? '<sup>~</sup>' : ''}</span>`;
    };
    const dl = days.slice().reverse().map((x) => {
      const ok = x.mm != null && x.coverage >= 0.5;
      return `<li><span class="od">${esc(dayName(x.key))}${x.partial ? `<small>t/m ${hhmm(now)}</small>` : ''}</span>${x.slots.map(cell).join('')}<span class="ot"><b>${ok ? fmtMm(x.mm) : '–'}</b><i class="obar" style="width:${ok ? Math.max(2, (x.mm / maxDay) * 100) : 0}%"></i></span></li>`;
    }).join('');
    els.rainDays.innerHTML = `<ol class="oday"><li class="ohdr"><span class="od">Datum</span><span class="oc">0–6</span><span class="oc">6–12</span><span class="oc">12–18</span><span class="oc">18–24</span><span class="ot">Totaal mm</span></li>${dl}</ol>`;
    const arcFirst = S.arc ? S.arc.t0 : null;
    const missing = days.some((x) => x.coverage < 0.5);
    els.rainNote.innerHTML = `Per datum en in tijdsvakken van zes uur (lokale tijd). Uren tot ruwweg twee dagen terug komen uit de KNMI-uurwaarden, het recente deel uit de 10-minutenwaarnemingen${arcFirst ? '' : ' (het 10-minutenarchief is nog niet bereikbaar)'}; tussen de laatste 10-minutenwaarde en nu vult de uursom van de live-feed aan. <b>~</b> = niet de hele periode gemeten. ${missing ? 'Een streepje betekent dat er voor die periode (nog) geen bruikbare data is.' : ''}`;
  }

  // ---------- modelcheck ----------
  function checkBlock(d) {
    const days = S.checkDays;
    if (!S.models) {
      els.checkBody.innerHTML = `<p class="note ${S.modelsErr ? 'err' : ''}">${S.modelsErr ? esc(`Modelcheck niet mogelijk: ${S.modelsErr}.`) : 'De oude modelvoorspellingen worden opgehaald…'}</p>`;
      return;
    }
    const cutoff = d.now - days * 86400;
    const obs = new Map();
    for (const [t, r] of d.hourly) if (t >= cutoff && t <= d.now) obs.set(t, r);
    const scores = {};
    for (const m of CHECK_MODELS) if (S.models.byModel[m.key]) scores[m.key] = scoreModel(obs, S.models.byModel[m.key]);
    const keys = Object.keys(scores);
    if (!keys.length || obs.size < 24) {
      els.checkBody.innerHTML = '<p class="note">Er zijn nog te weinig waarnemingen om de modellen mee te vergelijken.</p>';
      return;
    }
    const win = pickWinners(scores);
    const lab = Object.fromEntries(CHECK_MODELS.map((m) => [m.key, m.label]));
    const vUI = CHECK_VARS_UI;
    // samenvatting: winnaar per termijn
    const winCell = (g, v) => {
      const k = win[g.id][v][0];
      if (!k) return '<td class="dim">–</td>';
      const sc = scores[k][g.id][v];
      return `<td><b>${esc(lab[k])}</b><small>${vUI[v].fmt(sc.mae)}${vUI[v].unit}</small></td>`;
    };
    const tally = {};
    for (const g of LEAD_GROUPS) for (const v of ['ta', 'ff', 'rain']) { const k = win[g.id][v][0]; if (k) tally[k] = (tally[k] || 0) + 1; }
    const ranking = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const sumRows = LEAD_GROUPS.map((g) => {
      const best = win[g.id].all[0];
      return `<tr><th scope="row">${g.label}<small>${g.sub}</small></th>${winCell(g, 'ta')}${winCell(g, 'ff')}${winCell(g, 'rain')}<td class="otot">${best ? `<b>${esc(lab[best])}</b>` : '–'}</td></tr>`;
    }).join('');
    const nTot = Math.max(...keys.map((k) => scores[k].d1.ta.n));
    const lastObs = Math.max(...obs.keys());
    const summary = `<h3 class="h3">Wie zat er het dichtst bij?</h3>
      <p class="note">Vergeleken met wat er gemeten is in ${esc(loc().name)} (${CHECK_PERIODS[days].toLowerCase()} t/m ${esc(dayName(localParts(lastObs).key))} ${hhmm(lastObs)}). Per termijn: de winnaar en zijn gemiddelde afwijking.</p>
      <div class="tablewrap"><table class="otable ocheck"><thead><tr><th></th><th>Temperatuur</th><th>Wind</th><th>Neerslag</th><th>Totaal</th></tr></thead><tbody>${sumRows}</tbody></table></div>
      ${ranking.length ? `<p class="note">Meeste winsten (van ${LEAD_GROUPS.length * 3}): ${ranking.slice(0, 4).map(([k, n]) => `<b>${esc(lab[k])}</b> ${n}×`).join(' · ')}.</p>` : ''}`;
    // detail voor gekozen grootheid
    const v = S.checkVar;
    const head = `<tr><th>Model</th>${LEAD_GROUPS.map((g) => `<th>${g.label}<small>${g.sub}</small></th>`).join('')}</tr>`;
    const order = keys.slice().sort((a, b) => {
      const av = scores[a].d1[v].mae ?? 99, bv = scores[b].d1[v].mae ?? 99;
      return av - bv;
    });
    const rows = order.map((k) => `<tr><th scope="row">${esc(lab[k])}</th>${LEAD_GROUPS.map((g) => {
      const sc = scores[k][g.id][v];
      if (sc.mae == null || sc.n < 8) return '<td class="dim">–</td>';
      const best = win[g.id][v][0] === k;
      const second = v === 'ta' ? `${sc.bias >= 0 ? '+' : '−'}${nlnum(Math.abs(sc.bias), 1)}` : v === 'ff' ? `${sc.bias >= 0 ? '+' : '−'}${nlnum(Math.abs(sc.bias), 1)}` : `${nlnum(sc.hit * 100, 0)}% goed`;
      return `<td class="${best ? 'obest' : ''}"><b>${vUI[v].fmt(sc.mae)}</b><small>${second}</small></td>`;
    }).join('')}</tr>`).join('');
    const biasTxt = v === 'rain' ? 'Onder het getal: bij hoeveel procent van de blokken van 6 uur het model goed had of het nat (≥ 0,3 mm) of droog was.' : 'Onder het getal: gemiddeld te hoog (+) of te laag (−) ten opzichte van de meting.';
    const detail = `<h3 class="h3">Alle modellen</h3>
      <div class="modelpick small" role="radiogroup" aria-label="Grootheid" id="obsVarPick">${Object.entries(vUI).map(([k, o]) => `<button role="radio" aria-checked="${k === v}" data-v="${k}">${o.label}</button>`).join('')}</div>
      <p class="note">Gemiddelde afwijking (${vUI[v].what}); lager is beter. De beste per termijn is gemarkeerd. ${biasTxt}</p>
      <div class="tablewrap"><table class="otable ocheck"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    els.checkBody.innerHTML = summary + detail + `<p class="note">Uitleg: <b>Dag 1</b> is de voorspelling zoals die 24 uur van tevoren luidde, <b>dag 5</b> die van vijf dagen eerder. Het archief van Open-Meteo reikt tot zeven dagen terug, dus <b>lange termijn</b> betekent hier dag 6 en 7 (de pluimen van dag 8–14 zijn niet achteraf te toetsen). Een model telt pas mee met voldoende vergelijkingen: KNMI HARMONIE kijkt maar twee dagen vooruit. Er zijn ${nTot} uurvergelijkingen per model en termijn. De meting voor ${esc(loc().name)} is zelf een schatting uit ${esc(ids().map((i) => STATIONS[i].name).join(' en '))}; kleine verschillen zijn dus geen bewijs.</p>`;
  }

  // ---------- tekenen ----------
  let cache = null;
  function render() {
    const L = loc();
    const near = nearestStationKm(L);
    els.farMsg.hidden = near <= MAX_STATION_KM;
    els.main.hidden = near > MAX_STATION_KM;
    if (near > MAX_STATION_KM) {
      els.head.textContent = 'Geen meetstations in de buurt';
      els.headSub.textContent = '';
      els.farMsg.textContent = `De waarnemingen komen van de KNMI-stations Heino, Hoogeveen, Marknesse en Twenthe. ${L.name} ligt ${Math.round(near)} km van het dichtstbijzijnde station, te ver voor een betrouwbare schatting. Kies Ommen (of een plek in de buurt) als locatie.`;
      return;
    }
    cache = derived();
    nowBlock(cache);
    for (const b of els.methodBtns) b.setAttribute('aria-checked', b.dataset.m === S.method);
    for (const b of els.subBtns) b.setAttribute('aria-selected', b.dataset.s === S.sub);
    for (const [k, el] of Object.entries(els.panels)) el.hidden = k !== S.sub;
    if (S.sub === 'trace' && cache) {
      for (const b of els.periodBtns) b.setAttribute('aria-checked', b.dataset.p === S.period);
      els.chart.innerHTML = traceChart(cache);
      els.read.textContent = 'Tik of beweeg over de grafiek voor de waarden op dat moment.';
    } else if (S.sub === 'rain') rainBlock(cache);
    else if (S.sub === 'check') {
      for (const b of els.checkBtns) b.setAttribute('aria-checked', b.dataset.n === String(S.checkDays));
      checkBlock(cache);
    }
    // bronnen en storingen
    const msgs = [];
    if (S.arcErr) msgs.push('Het 10-minutenarchief is nog niet bereikbaar (de GitHub-taak moet eerst draaien); de grafieken gebruiken dan de KNMI-uurwaarden.');
    else if (S.arc) {
      const lag = nowSec() - S.arc.last;
      if (lag > 3 * 3600) msgs.push(`De laatste 10-minutenwaarneming in het archief is ${ago(lag)}: de ophaaltaak loopt achter (GitHub voert geplande taken soms met vertraging uit, of KNMI zit vol).`);
    }
    if (S.knmiErr) msgs.push('De KNMI-uurwaarden konden niet worden opgehaald.');
    if (S.liveErr) msgs.push('De live-feed van Buienradar is niet bereikbaar.');
    els.status.innerHTML = msgs.map((m) => `<p class="note err">${esc(m)}</p>`).join('');
    els.src.innerHTML = 'Bronnen: KNMI-meetstations via het KNMI Data Platform (10-minutenwaarnemingen, CC BY 4.0) en daggegevens.knmi.nl (uurwaarden), live-waarden van Buienradar, oude modelruns van Open-Meteo.';
  }

  async function refresh({ force = false } = {}) {
    if (S.loading) return;
    if (!force && Date.now() - S.lastRefresh < 60e3) { render(); return; }
    S.loading = true;
    try {
      await Promise.all([loadArchive(), loadLive(), ensureKnmi(Math.max(15, S.sub === 'check' ? S.checkDays + 2 : 0))]);
      S.lastRefresh = Date.now();
      render();
      if (S.sub === 'check') { await ensureModels(S.checkDays); render(); }
    } finally { S.loading = false; }
  }
  async function onSub(sub) {
    S.sub = sub;
    render();
    if (sub === 'check') {
      await ensureKnmi(S.checkDays + 2);
      render();
      await ensureModels(S.checkDays);
      render();
    }
  }

  // ---------- gebeurtenissen ----------
  for (const b of els.subBtns) b.addEventListener('click', () => onSub(b.dataset.s));
  for (const b of els.periodBtns) b.addEventListener('click', () => { S.period = b.dataset.p; render(); });
  for (const b of els.methodBtns) b.addEventListener('click', () => { S.method = b.dataset.m; render(); });
  for (const b of els.checkBtns) b.addEventListener('click', async () => { S.checkDays = Number(b.dataset.n); render(); await ensureKnmi(S.checkDays + 2); render(); await ensureModels(S.checkDays); render(); });
  els.checkBody.addEventListener('click', (e) => { const b = e.target.closest('#obsVarPick button'); if (b) { S.checkVar = b.dataset.v; render(); } });
  els.chart.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') readoutAt(e.clientX); });
  els.chart.addEventListener('pointerdown', (e) => readoutAt(e.clientX));

  return {
    refresh: () => refresh({ force: true }),
    rerender: () => { if (S.visible) render(); },
    show(on) {
      S.visible = on;
      clearInterval(S.timer);
      if (on) {
        refresh();
        S.timer = setInterval(() => { if (!document.hidden) refresh({ force: true }); }, 5 * 60e3);
      }
    },
  };
}
