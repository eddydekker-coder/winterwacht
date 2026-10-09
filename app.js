// Winterwacht — app-logica (laag 1: 5 dagen + uur voor uur, laag 2: 14-daagse pluimen, laag 3: lange termijn)
import {
  ENSEMBLES, DETERMINISTIC, HOME, summarizeEnsemble, fingerprint, compareRuns, windowMean,
  extractMembers, pct, winterScore, seasonMode, dayHighlights, monthOf, NORMAL_TX, NORMAL_TN,
} from './lib/stats.js?v=6';
import {
  LONG_MODELS, LONG_VARS, longUrl, summarizeLong, longFingerprint, compareLong, longScore, winterMean,
} from './lib/longrange.js?v=6';
import {
  HOURLY_VARS, HOURLY_VARS_MIN, HOURLY_MODELS, HOURLY_ENS, buildSteps, localHourKey, hourlyHeadline, compass,
} from './lib/hourly.js?v=6';
import { initRadar, radarLocation, radarRefresh } from './lib/radar.js?v=6';

const API = 'https://api.open-meteo.com/v1/forecast';
const ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const TZ = 'Europe/Amsterdam';
const $ = (id) => document.getElementById(id);

// ---------- opslag (veilig, werkt ook als het niet mag) ----------
const store = {
  get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* geen opslag */ } },
};

const state = {
  home: store.get('ww.home', { ...HOME }),
  loc: null,
  model: 'aifs',
  view: store.get('ww.view', '5'),
  config: { locations: [HOME] },
  history: null, // archief van de GitHub Action voor deze locatie
  ens: {},       // cache van live ensemble-data per model
};
state.loc = state.home;

// ---------- data ophalen ----------
async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) { const e = new Error(body.reason || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return body;
}

async function fetchDeterministic(loc) {
  const daily = 'temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,weather_code';
  const out = {};
  await Promise.all(DETERMINISTIC.map(async (m) => {
    for (const id of m.ids) {
      try {
        const d = await getJSON(`${API}?latitude=${loc.lat}&longitude=${loc.lon}&daily=${daily}&models=${id}&forecast_days=6&timezone=${encodeURIComponent(TZ)}`);
        out[m.key] = d.daily; return;
      } catch (e) { if (e.status !== 400) return; }
    }
  }));
  return out;
}

async function fetchEnsemble(loc, key) {
  const model = ENSEMBLES.find((m) => m.key === key);
  const cacheKey = `${key}@${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  const hit = state.ens[cacheKey];
  if (hit && Date.now() - hit.t < 20 * 60e3) return hit.v;
  const varSets = [
    'temperature_2m,temperature_850hPa,snowfall,precipitation',
    'temperature_2m,temperature_850hPa,precipitation',
    'temperature_2m,snowfall,precipitation',
    'temperature_2m,precipitation',
  ];
  let last;
  for (const id of model.ids) {
    for (const vars of varSets) {
      try {
        const data = await getJSON(`${ENS}?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${vars}&models=${id}&forecast_days=15&timezone=${encodeURIComponent(TZ)}`);
        const v = { data, id, dates: summarizeEnsemble(data), fp: fingerprint(data), fetched: new Date().toISOString() };
        state.ens[cacheKey] = { t: Date.now(), v };
        return v;
      } catch (e) { last = e; if (e.status !== 400) throw e; }
    }
  }
  throw last;
}

async function loadConfigAndHistory() {
  try { state.config = await getJSON(`config.json?t=${Date.now()}`); } catch { /* standaard blijft */ }
  const match = state.config.locations.find((l) => distKm(l, state.loc) < 10);
  state.history = null;
  if (match) {
    try { state.history = await getJSON(`data/history/${match.id}.json?t=${Date.now()}`); } catch { /* nog geen archief */ }
  }
  state.longArchive = null;
  if (match) {
    try { state.longArchive = await getJSON(`data/longrange/${match.id}.json?t=${Date.now()}`); } catch { /* nog geen archief */ }
  }
  try { state.status = await getJSON(`data/status.json?t=${Date.now()}`); } catch { state.status = null; }
}

function distKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Lokale run-geschiedenis voor plekken zonder archief (bijv. tijdelijke thuislocatie)
function localHistKey(key) { return `ww.hist.${state.loc.lat.toFixed(2)},${state.loc.lon.toFixed(2)}.${key}`; }
function runsFor(key, live) {
  let runs = [];
  if (state.history?.models?.[key]?.runs) runs = state.history.models[key].runs.slice();
  else {
    runs = store.get(localHistKey(key), []);
  }
  if (live) {
    const liveRun = { fp: live.fp, fetched: live.fetched, dates: live.dates, live: true };
    const keys = Object.keys(live.dates).sort();
    liveRun.w17 = windowMean(live.dates, 0, 6, keys[0]);
    liveRun.w814 = windowMean(live.dates, 7, 13, keys[0]);
    if (!runs.length || runs[0].fp !== live.fp) runs.unshift(liveRun);
    if (!state.history?.models?.[key]) store.set(localHistKey(key), runs.slice(0, 16));
  }
  return runs;
}

// ---------- kleur & sfeer ----------
const STOPS = [ // temperatuur → achtergrond dagkolom
  [-12, [10, 30, 62]], [-6, [24, 70, 122]], [-1, [46, 112, 170]], [3, [80, 128, 160]],
  [8, [96, 112, 122]], [14, [110, 112, 110]], [22, [126, 112, 96]],
];
function tempRGB(t) {
  if (t == null) return [90, 100, 110];
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function applyMood(score) {
  const f = score / 100;
  const root = document.documentElement.style;
  const top = mix(hex('#6a7378'), hex('#2c6aa2'), f);
  const bottom = mix(hex('#343c41'), hex('#0b2138'), f);
  root.setProperty('--sky-top', rgb(top));
  root.setProperty('--sky-bottom', rgb(bottom));
  root.setProperty('--rime', String(Math.max(0, (score - 50) / 50)));
  document.querySelector('meta[name=theme-color]').setAttribute('content', rgb(top));
  $('meterFill').style.left = `${score}%`;
  $('meterWord').textContent = score >= 80 ? 'ijzig' : score >= 60 ? 'winters' : score >= 45 ? 'fris' : score >= 30 ? 'normaal' : 'zacht';
}

// ---------- iconen ----------
function wxIcon(code, snow) {
  const s = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"';
  const cloud = `<path ${s} d="M8 18h9a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 8 18Z"/>`;
  if (snow || [71, 73, 75, 77, 85, 86].includes(code)) return `<svg class="wx" viewBox="0 0 24 24" aria-label="sneeuw"><path ${s} d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/></svg>`;
  if (code >= 51 && code <= 67 || (code >= 80 && code <= 82) || code >= 95) return `<svg class="wx" viewBox="0 0 24 24" aria-label="regen">${cloud}<path ${s} d="M9 20.5l-1 2M13 20.5l-1 2M17 20.5l-1 2"/></svg>`;
  if (code === 45 || code === 48) return `<svg class="wx" viewBox="0 0 24 24" aria-label="mist"><path ${s} d="M4 9h16M3 13h18M5 17h14"/></svg>`;
  if (code <= 1) return `<svg class="wx" viewBox="0 0 24 24" aria-label="zonnig"><circle ${s} cx="12" cy="12" r="4"/><path ${s} d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`;
  if (code === 2) return `<svg class="wx" viewBox="0 0 24 24" aria-label="half bewolkt"><circle ${s} cx="8" cy="8" r="3"/>${cloud}</svg>`;
  return `<svg class="wx" viewBox="0 0 24 24" aria-label="bewolkt">${cloud}</svg>`;
}

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const dLabel = (d, i) => (i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : DAYS[new Date(d + 'T12:00:00Z').getUTCDay()]);
const dShort = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dLong = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const nl = (x) => String(x).replace('.', ',');
const deg = (t) => (t == null ? '–' : `${Math.round(t)}°`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- LAAG 1 ----------
function blendDays(det, ens) {
  const base = det.knmi || det.aifs || det.ifs;
  if (!base) return [];
  return base.time.slice(0, 5).map((date, i) => {
    const order = i <= 2 ? ['knmi', 'aifs', 'ifs'] : ['aifs', 'ifs', 'knmi'];
    const pick = (field) => {
      for (const k of order) {
        const src = det[k]; if (!src) continue;
        const j = src.time.indexOf(date);
        if (j >= 0 && src[field]?.[j] != null) return { v: src[field][j], k };
      }
      return { v: null, k: null };
    };
    const tx = pick('temperature_2m_max'), tn = pick('temperature_2m_min');
    const e = ens?.[date] || {};
    return {
      date, tx: tx.v, tn: tn.v, src: tx.k,
      snow: Math.round((pick('snowfall_sum').v ?? 0) * 10) / 10,
      code: pick('weather_code').v,
      pSnow: e.pSnow, pFrost: e.pFrost, pIce: e.pIce,
    };
  });
}

function verdict(days) {
  const mode = seasonMode(monthOf(days[0].date));
  const snowDay = days.find((d) => d.snow >= 0.3 || (d.pSnow ?? 0) >= 40);
  const ice = days.find((d) => d.tx != null && d.tx < 0);
  const frost = days.filter((d) => d.tn != null && d.tn < 0);
  const first = days[0], last = days[days.length - 1];
  const dTx = last.tx - first.tx;
  let h;
  if (snowDay) { const dag = dLong(snowDay.date).split(' ')[0]; h = snowDay.snow >= 0.3 ? `${dag[0].toUpperCase() + dag.slice(1)} sneeuw in ${state.loc.name}: ${nl(snowDay.snow)} cm` : `Kans op sneeuw op ${dag}`; }
  else if (ice) h = `IJsdag in zicht op ${dLong(ice.date).split(' ')[0]}`;
  else if (frost.length) h = mode === 'winter' ? `${frost.length} ${frost.length === 1 ? 'nacht' : 'nachten'} met vorst` : `Nachtvorst op ${dLong(frost[0].date).split(' ')[0]}`;
  else if (dTx <= -3) h = 'Ja, het wordt frisser';
  else if (dTx >= 3) h = 'Nee, het wordt zachter';
  else h = 'Weinig verandering de komende dagen';

  const coldest = Math.min(...days.map((d) => d.tn ?? 99));
  const anom = days.reduce((s, d) => { const m = monthOf(d.date) - 1; return s + ((d.tx - NORMAL_TX[m]) + (d.tn - NORMAL_TN[m])) / 2; }, 0) / days.length;
  const anomTxt = Math.abs(anom) < 0.7 ? 'rond normaal voor de tijd van het jaar' : `${Math.abs(anom).toFixed(1).replace('.', ',')}° ${anom < 0 ? 'kouder' : 'warmer'} dan normaal`;
  const sub = `Overdag van ${deg(first.tx)} naar ${deg(last.tx)}, koudste nacht ${deg(coldest)}. Gemiddeld ${anomTxt}.`;
  return { h, sub };
}

function renderDay5(det, ens) {
  const days = blendDays(det, ens);
  if (!days.length) { $('verdict').textContent = 'Geen verwachting beschikbaar'; return; }
  const mode = seasonMode(monthOf(days[0].date));
  const v = verdict(days);
  $('verdict').textContent = v.h;
  $('verdictSub').textContent = v.sub;
  const score = winterScore(days.filter((d) => d.tx != null && d.tn != null));
  applyMood(score);

  $('ribbon').innerHTML = days.map((d, i) => {
    const c = tempRGB(d.tx != null && d.tn != null ? (d.tx + d.tn) / 2 : null);
    const chips = dayHighlights(d, mode).slice(0, 3).map((x) => `<span class="chip ${x.k}">${esc(x.t)}</span>`).join('');
    const probs = [];
    if (d.pFrost != null && d.pFrost >= 10) probs.push(`vorst ${d.pFrost}%`);
    if (d.pSnow != null && d.pSnow >= 10) probs.push(`sneeuw ${d.pSnow}%`);
    return `<li class="day" data-date="${d.date}" title="Tik voor de uurverwachting" style="--day-bg:${rgb(c, 0.55)}">
      <span class="dname">${dLabel(d.date, i)}</span>
      <span class="ddate">${dShort(d.date)}</span>
      ${wxIcon(d.code, d.snow >= 0.3)}
      <span class="tx" aria-label="maximum">${deg(d.tx)}</span>
      <span class="tn" aria-label="minimum">${deg(d.tn)}</span>
      <span class="chips">${chips}</span>
      ${probs.length ? `<span class="prob">${probs.join('<br>')}</span>` : ''}
    </li>`;
  }).join('');

  // modeltabel
  const rows = [['knmi', 'KNMI'], ['aifs', 'AIFS'], ['ifs', 'IFS']].filter(([k]) => det[k]);
  $('modelTable').innerHTML = `<thead><tr><th>Max / min</th>${days.map((d, i) => `<th>${dLabel(d.date, i)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([k, name]) => `<tr><td>${name}</td>${days.map((d) => {
      const j = det[k].time.indexOf(d.date);
      if (j < 0 || det[k].temperature_2m_max[j] == null) return '<td>–</td>';
      const sn = det[k].snowfall_sum?.[j];
      return `<td><span class="num">${deg(det[k].temperature_2m_max[j])}/${deg(det[k].temperature_2m_min[j])}</span>${sn >= 0.3 ? `<br><small>${nl(Math.round(sn * 10) / 10)} cm</small>` : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;

  startSnow(days.some((d) => d.snow >= 0.3 || (d.pSnow ?? 0) >= 30));
}

// ---------- LAAG 1b: uur voor uur ----------
async function fetchHourly(loc) {
  const base = `latitude=${loc.lat}&longitude=${loc.lon}&forecast_days=6&timezone=${encodeURIComponent(TZ)}`;
  const tryModel = async (ids, url) => {
    for (const id of ids) {
      for (const vars of [HOURLY_VARS, HOURLY_VARS_MIN]) {
        try { return await getJSON(`${url}?${base}&hourly=${vars}&models=${id}`); } catch (e) { if (e.status !== 400) return null; }
      }
    }
    return null;
  };
  const tryEns = async () => {
    for (const id of HOURLY_ENS.ids) {
      try { return await getJSON(`${ENS}?${base}&hourly=precipitation,snowfall&models=${id}`); } catch (e) { if (e.status !== 400) return null; }
    }
    return null;
  };
  const [knmi, ecmwf, ens] = await Promise.all([tryModel(HOURLY_MODELS.knmi.ids, API), tryModel(HOURLY_MODELS.ecmwf.ids, API), tryEns()]);
  const ref = knmi || ecmwf;
  if (!ref) return null;
  const nowKey = localHourKey(Date.now(), ref.utc_offset_seconds ?? 0);
  return { steps: buildSteps({ knmi: knmi?.hourly, ecmwf: ecmwf?.hourly, ens: ens?.hourly, nowKey }), hasEns: !!ens, hasKnmi: !!knmi, hasEcmwf: !!ecmwf };
}

// Weericoon per uur, met maan 's nachts en natte sneeuw/ijzel apart
function hourIcon(s, cx, cy) {
  const st = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const cloud = `<path ${st} d="M8 17h9a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 8 17Z"/>`;
  const moon = (x, y, r) => `<path ${st} d="M${x + r * 0.35},${y - r} a${r},${r} 0 1 0 ${r * 0.65},${r * 1.55} a${r * 0.8},${r * 0.8} 0 0 1 -${r * 0.65},-${r * 1.55}Z"/>`;
  const sun = (x, y, r) => `<circle ${st} cx="${x}" cy="${y}" r="${r}"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180); return `<path ${st} d="M${x + c * (r + 2)},${y + sn * (r + 2)}L${x + c * (r + 3.6)},${y + sn * (r + 3.6)}"/>`; }).join('');
  const flake = (x, y) => `<path ${st} d="M${x},${y - 2.6}v5.2M${x - 2.3},${y - 1.3}l4.6,2.6M${x - 2.3},${y + 1.3}l4.6,-2.6"/>`;
  const drop = (x, y) => `<path ${st} d="M${x},${y}l-1,2"/>`;
  const night = s.isDay === 0;
  const cover = s.cloud ?? (s.code <= 1 ? 10 : s.code === 2 ? 50 : 90);
  let g;
  if (s.hz.mist) g = `<path ${st} d="M4 9h16M3 13h18M5 17h14"/>`;
  else if (s.ptype === 'sneeuw') g = `${cloud}${flake(9, 21)}${flake(16, 21)}`;
  else if (s.ptype === 'natte sneeuw') g = `${cloud}${flake(9, 21)}${drop(16, 19.5)}`;
  else if (s.ptype === 'ijzel') g = `${cloud}${drop(9, 19.5)}${drop(13, 19.5)}<path ${st} d="M15.5 21.5h4" stroke="var(--warmer)"/>`;
  else if (s.ptype === 'regen') g = `${cloud}${drop(9, 19.5)}${drop(13, 19.5)}${s.precip >= 1 * s.dur ? drop(17, 19.5) : ''}`;
  else if (cover < 25) g = night ? moon(12, 12, 6) : sun(12, 12, 4.2);
  else if (cover < 70) g = `${night ? moon(8, 8, 3.6) : sun(8, 8, 2.6)}${cloud}`;
  else g = cloud;
  return `<g transform="translate(${cx - 12},${cy - 12})" class="hicon">${g}</g>`;
}

const PCOL = { regen: '#7cc8ff', 'natte sneeuw': '#c7c3ff', sneeuw: '#ffffff', ijzel: '#ff8a6b' };
const HZ_TXT = { ijzel: 'ijzel', sneeuw: 'gladheid door sneeuw', opvriezing: 'opvriezing natte weg', rijp: 'rijp' };

function hourlySVG(steps) {
  const CW = 46, W = steps.length * CW;
  const Y = { day: 13, hour: 32, icon: 54, tTop: 84, tBot: 172, pTop: 186, pBot: 232, pop: 246, hz: 266, arrow: 290, bft: 314, kmh: 330, gust: 346 };
  const H = 356;
  const x = (i) => i * CW + CW / 2;
  const temps = steps.flatMap((s) => [s.t, s.feel]).filter((v) => v != null);
  let lo = Math.floor(Math.min(...temps)), hi = Math.ceil(Math.max(...temps));
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = Math.floor(m - 3); hi = Math.ceil(m + 3); }
  const ty = (t) => Y.tTop + (1 - (t - lo) / (hi - lo)) * (Y.tBot - Y.tTop);
  const intens = steps.map((s) => (s.precip || 0) / s.dur);
  const pMax = Math.max(1.5, ...intens);
  const py = (mmh) => Math.max(mmh > 0 ? 2 : 0, (Math.sqrt(mmh) / Math.sqrt(pMax)) * (Y.pBot - Y.pTop));

  let bg = '', g = '';
  steps.forEach((s, i) => {
    const x0 = i * CW;
    if (s.isDay === 0) bg += `<rect x="${x0}" y="${Y.hour - 14}" width="${CW}" height="${H - Y.hour + 14}" fill="rgba(4,12,24,.16)"/>`;
    if (s.t != null && s.t <= 0) bg += `<rect x="${x0}" y="${Y.tTop - 8}" width="${CW}" height="${Y.tBot - Y.tTop + 16}" fill="rgba(169,220,255,${s.t <= -5 ? 0.24 : 0.13})"/>`;
    // dag- en modelscheiding
    const newDay = i === 0 || s.date !== steps[i - 1].date;
    const newSrc = i > 0 && s.dur !== steps[i - 1].dur;
    if (newDay || newSrc) {
      if (i > 0) g += `<line x1="${x0}" x2="${x0}" y1="${Y.day + 6}" y2="${H}" stroke="var(--ink)" stroke-opacity="${newDay ? 0.35 : 0.2}" ${newSrc && !newDay ? 'stroke-dasharray="3 3"' : ''}/>`;
    }
    if (newDay) {
      const wd = DAYS[new Date(s.date + 'T12:00:00Z').getUTCDay()];
      g += `<text x="${x0 + 5}" y="${Y.day}" font-size="11.5" font-weight="700" fill="var(--ink)">${i === 0 ? 'Nu' : `${wd} ${Number(s.date.slice(8))}`}</text>`;
    }
    if (newSrc) g += `<text x="${x0 + (newDay ? 52 : 5)}" y="${Y.day}" font-size="10" fill="var(--frost)">${s.src === 'ecmwf' ? 'ECMWF' : 'KNMI'} · per ${s.dur} uur →</text>`;
    // uur
    g += `<text x="${x(i)}" y="${Y.hour}" text-anchor="middle" font-size="11" fill="var(--ink-soft)">${String(s.hour).padStart(2, '0')}</text>`;
    g += hourIcon(s, x(i), Y.icon);
    // temperatuurlabel
    if (s.t != null) g += `<text x="${x(i)}" y="${ty(s.t) - 9}" text-anchor="middle" font-size="13" font-weight="600" class="hnum" fill="${s.t <= 0 ? 'var(--frost)' : 'var(--ink)'}">${Math.round(s.t)}°</text>`;
    // neerslagstaaf
    if (s.precip >= 0.05) {
      const h = py(intens[i]), col = PCOL[s.ptype] || PCOL.regen;
      const op = s.pop == null ? 0.85 : 0.35 + 0.6 * (s.pop / 100);
      g += `<rect x="${x0 + 9}" y="${Y.pBot - h}" width="${CW - 18}" height="${h}" rx="2" fill="${col}" fill-opacity="${op.toFixed(2)}"/>`;
      g += `<text x="${x(i)}" y="${Y.pBot - h - 4}" text-anchor="middle" font-size="10" fill="var(--ink)">${nl(s.precip >= 10 ? Math.round(s.precip) : s.precip.toFixed(1))}</text>`;
    }
    // kans
    if (s.pop != null) g += `<text x="${x(i)}" y="${Y.pop}" text-anchor="middle" font-size="10" fill="${s.pop >= 50 ? 'var(--ink)' : 'var(--ink-soft)'}" ${s.pop >= 50 ? 'font-weight="700"' : ''}>${s.pop}%</text>`;
    // gladheid / mist
    const marks = [];
    if (s.hz.glad) marks.push(`<g transform="translate(${x(i) - 7},${Y.hz - 10})" class="hz ${s.hz.glad === 'rijp' ? 'soft' : 'hard'}"><path d="M7 1v12M1.8 4l10.4 6M1.8 10l10.4-6M5 2.3 7 3.6l2-1.3M5 11.7 7 10.4l2 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></g>`);
    if (s.hz.mist) marks.push(`<g transform="translate(${x(i) - 7},${Y.hz - 9})" class="hz mist"><path d="M1 3h12M0 7h14M2 11h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></g>`);
    if (marks.length === 2) { g += marks[0].replace(`translate(${x(i) - 7},`, `translate(${x(i) - 15},`) + marks[1].replace(`translate(${x(i) - 7},`, `translate(${x(i) + 1},`); }
    else g += marks.join('');
    // wind: pijl wijst de stroomrichting aan
    if (s.dir != null) g += `<g transform="translate(${x(i)},${Y.arrow}) rotate(${(s.dir + 180) % 360})"><path d="M0 -8 L4.5 5 L0 2.4 L-4.5 5 Z" fill="var(--ink)" fill-opacity="${s.bft >= 6 ? 1 : 0.8}"/></g>`;
    if (s.bft != null) g += `<text x="${x(i)}" y="${Y.bft}" text-anchor="middle" font-size="15" class="hnum" font-weight="${s.bft >= 6 ? 700 : 500}" fill="${s.bft >= 7 ? 'var(--warmer)' : 'var(--ink)'}">${s.bft}</text>`;
    if (s.wind != null) g += `<text x="${x(i)}" y="${Y.kmh}" text-anchor="middle" font-size="9.5" fill="var(--ink-soft)">${s.wind}</text>`;
    if (s.gust != null) g += `<text x="${x(i)}" y="${Y.gust}" text-anchor="middle" font-size="9.5" fill="${s.gust >= 60 ? 'var(--warmer)' : 'var(--ink-soft)'}" ${s.gust >= 60 ? 'font-weight="700"' : ''}>${s.gust}</text>`;
  });
  // 0-graden lijn
  if (lo < 0 && hi > 0) g = `<line x1="0" x2="${W}" y1="${ty(0)}" y2="${ty(0)}" stroke="var(--frost)" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity=".8"/>` + g;
  // lijnen
  const path = (k) => { let d = '', pen = false; steps.forEach((s, i) => { if (s[k] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${ty(s[k]).toFixed(1)}`; pen = true; }); return d; };
  const lines = `<path d="${path('feel')}" fill="none" stroke="var(--frost)" stroke-width="1.6" stroke-dasharray="4 3" stroke-opacity=".9"/>
    <path d="${path('t')}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/>
    ${steps.map((s, i) => (s.t == null ? '' : `<circle cx="${x(i)}" cy="${ty(s.t).toFixed(1)}" r="2.6" fill="var(--ink)"/>`)).join('')}`;
  // bodemlijn neerslag
  const base = `<line x1="0" x2="${W}" y1="${Y.pBot}" y2="${Y.pBot}" stroke="var(--line)"/>`;
  const sel = `<rect id="hsel" x="0" y="${Y.hour - 15}" width="${CW}" height="${H - Y.hour + 15}" rx="6" fill="rgba(255,255,255,.08)" stroke="var(--ink)" stroke-opacity=".45"/>`;
  return { svg: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Uurverwachting: temperatuur, neerslag en wind">${bg}${sel}${base}${g}${lines}</svg>`, CW };
}

function hourDetail(s) {
  const time = `${dLong(s.date)} ${String(s.hour).padStart(2, '0')}:00`;
  const src = s.src === 'knmi' ? 'KNMI HARMONIE' : 'ECMWF IFS';
  const period = s.dur > 1 ? `in de ${s.dur} uur tot dit tijdstip` : 'in het uur tot dit tijdstip';
  const rows = [];
  rows.push(['Temperatuur', `${deg(s.t)} <small>gevoel ${deg(s.feel)} · dauwpunt ${deg(s.td)}</small>`]);
  const pr = s.precip >= 0.05 ? `${nl(s.precip.toFixed(1))} mm ${s.ptype || ''}` : 'droog';
  const probs = [s.pop != null ? `kans ${s.pop}%` : null, s.pSnow != null && s.pSnow >= 10 ? `sneeuwkans ${s.pSnow}%` : null].filter(Boolean).join(' · ');
  rows.push(['Neerslag', `${pr}${s.ptype === 'sneeuw' && s.snow >= 0.1 ? ` (${nl(s.snow.toFixed(1))} cm)` : ''} <small>${period}${probs ? ` · ${probs}` : ''}</small>`]);
  rows.push(['Wind', `${compass(s.dir)} ${s.bft ?? '–'} Bft <small>${s.wind ?? '–'} km/u${s.gust != null ? ` · stoten ${s.gust} km/u` : ''}</small>`]);
  const extra = [];
  if (s.vis != null) extra.push(`zicht ${s.vis >= 10000 ? `${Math.round(s.vis / 1000)} km` : s.vis >= 1000 ? `${nl((s.vis / 1000).toFixed(1))} km` : `${Math.round(s.vis / 10) * 10} m`}`);
  if (s.ts != null) extra.push(`oppervlak ${deg(s.ts)}`);
  if (s.cloud != null) extra.push(`bewolking ${s.cloud}%`);
  if (extra.length) rows.push(['Verder', extra.join(' · ')]);
  const warn = [s.hz.glad ? HZ_TXT[s.hz.glad] : null, s.hz.mist].filter(Boolean);
  return `<p class="htime"><b>${time[0].toUpperCase() + time.slice(1)}</b> <span>${src}</span></p>
    ${warn.length ? `<p class="hwarn">${warn.map((w) => `<span>${esc(w[0].toUpperCase() + w.slice(1))}</span>`).join('')}</p>` : ''}
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

const hstate = { steps: [], CW: 46, sel: 0 };
function selectHour(i, scroll = false) {
  const s = hstate.steps[i]; if (!s) return;
  hstate.sel = i;
  const r = document.getElementById('hsel');
  if (r) r.setAttribute('x', i * hstate.CW);
  $('hourDetail').innerHTML = hourDetail(s);
  if (scroll) $('hscroll').scrollTo({ left: Math.max(0, i * hstate.CW - 60), behavior: 'smooth' });
  markDayChip();
}
function scrollToDate(date) {
  const i = hstate.steps.findIndex((s) => s.date === date);
  if (i < 0) return;
  // kies het middaguur van die dag (of 'nu' bij vandaag)
  const noon = hstate.steps.findIndex((s) => s.date === date && s.hour >= 12);
  selectHour(i === 0 ? 0 : noon >= 0 ? noon : i);
  $('hscroll').scrollTo({ left: Math.max(0, i * hstate.CW - 2), behavior: 'smooth' });
  $('hourly').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function markDayChip() {
  const sc = $('hscroll');
  const i = Math.min(hstate.steps.length - 1, Math.max(0, Math.round((sc.scrollLeft + 80) / hstate.CW)));
  const d = hstate.steps[i]?.date;
  for (const b of $('hdays').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.d === d);
}

function renderHourly(res) {
  if (!res || !res.steps.length) {
    $('hourHead').textContent = 'Uurverwachting niet beschikbaar';
    $('hscroll').innerHTML = '';
    $('hourDetail').innerHTML = '';
    return;
  }
  const steps = res.steps;
  hstate.steps = steps;
  $('hourHead').textContent = hourlyHeadline(steps);
  const { svg, CW } = hourlySVG(steps);
  hstate.CW = CW;
  $('hscroll').innerHTML = svg;
  const dates = [...new Set(steps.map((s) => s.date))];
  $('hdays').innerHTML = dates.map((d, i) => `<button type="button" data-d="${d}" aria-pressed="${i === 0}">${dLabel(d, i)}</button>`).join('');
  const src = [res.hasKnmi ? 'KNMI HARMONIE (2 km) per uur tot 48 uur vooruit' : null, res.hasEcmwf ? 'daarna ECMWF IFS per 3 uur' : null].filter(Boolean).join(', ');
  $('hourNote').textContent = `${src || 'Bron niet volledig beschikbaar'}. Neerslag per uur of per 3 uur; de kans komt uit het ${HOURLY_ENS.label}${res.hasEns ? '' : ' (nu niet beschikbaar)'}. Gevoelstemperatuur bij kou volgens de windchill-formule die ook het KNMI gebruikt. Gladheid op basis van de oppervlaktetemperatuur van het model; geen officiële waarschuwing.`;
  selectHour(Math.min(hstate.sel, steps.length - 1));
}

function initHourly() {
  $('hscroll').addEventListener('click', (e) => {
    const svg = $('hscroll').querySelector('svg');
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    selectHour(Math.floor((e.clientX - box.left) / hstate.CW));
  });
  let t;
  $('hscroll').addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(markDayChip, 60); }, { passive: true });
  $('hdays').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) scrollToDate(b.dataset.d); });
  $('ribbon').addEventListener('click', (e) => { const li = e.target.closest('.day'); if (li?.dataset.date) scrollToDate(li.dataset.date); });
}

// ---------- LAAG 2: pluim ----------
function plumeSVG(times, members, opts = {}) {
  const W = 420, H = opts.h || 250, L = 30, R = 8, T = 12, B = 28;
  const n = times.length;
  const means = [], lo = [], hi = [];
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    const col = members.map((m) => m[i]).filter((x) => x != null);
    if (!col.length) { means.push(null); lo.push(null); hi.push(null); continue; }
    means.push(col.reduce((s, x) => s + x, 0) / col.length);
    lo.push(pct(col, 0.1)); hi.push(pct(col, 0.9));
    ymin = Math.min(ymin, ...col); ymax = Math.max(ymax, ...col);
  }
  if (!Number.isFinite(ymin)) return '<p class="note">Geen data voor deze pluim.</p>';
  ymin = Math.floor((ymin - 1) / 5) * 5; ymax = Math.ceil((ymax + 1) / 5) * 5;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (t) => T + (1 - (t - ymin) / (ymax - ymin)) * (H - T - B);
  const path = (arr) => {
    let d = '', pen = false;
    arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  let g = '';
  for (let t = ymin; t <= ymax; t += 5) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? 'var(--frost)' : 'var(--line)'}" stroke-width="${t === 0 ? 1.5 : 1}"/>`;
    g += `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${t}°</text>`;
  }
  let dayNo = 0;
  times.forEach((t, i) => {
    if (t.slice(11, 13) !== '00' || i === 0) return;
    dayNo++;
    const d = t.slice(0, 10);
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="${wd === 1 ? '0' : '2 4'}"/>`;
    if (x(i) < W - 24 && dayNo % 2 === 1) g += `<text x="${x(i) + 3}" y="${H - B + 16}" font-size="10.5" fill="var(--ink-soft)">${DAYS[wd]} ${Number(d.slice(8))}</text>`;
  });
  const band = (() => {
    const up = [], dn = [];
    hi.forEach((v, i) => { if (v != null) up.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
    lo.forEach((v, i) => { if (v != null) dn.unshift(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
    return `<polygon points="${up.concat(dn).join(' ')}" fill="var(--frost)" opacity="0.16"/>`;
  })();
  const mem = members.map((m) => `<path d="${path(m)}" fill="none" stroke="var(--ink)" stroke-opacity="0.18" stroke-width="0.8"/>`).join('');
  const nowIdx = times.findIndex((t) => new Date(t) >= new Date());
  const now = nowIdx > 0 ? `<line x1="${x(nowIdx)}" x2="${x(nowIdx)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-opacity=".5"/><text x="${x(nowIdx) + 3}" y="${T + 10}" font-size="10" fill="var(--ink-soft)">nu</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Pluim')}">${g}${band}${mem}<path d="${path(means)}" fill="none" stroke="var(--ink)" stroke-width="2.6"/>${now}</svg>`;
}

function trendSVG(runs) {
  const pts = runs.slice(0, 16).reverse().filter((r) => r.w814 != null || r.w17 != null);
  if (pts.length < 2) return '<p class="note">De trend verschijnt zodra er minstens twee runs zijn bewaard.</p>';
  const W = 420, H = 170, L = 30, R = 10, T = 18, B = 24;
  const vals = pts.flatMap((p) => [p.w814, p.w17]).filter((v) => v != null);
  let ymin = Math.floor(Math.min(...vals) - 1), ymax = Math.ceil(Math.max(...vals) + 1);
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (t) => T + (1 - (t - ymin) / (ymax - ymin)) * (H - T - B);
  const line = (k, style) => {
    const d = pts.map((p, i) => (p[k] == null ? '' : `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`)).join('');
    return `<path d="${d}" fill="none" ${style}/>` + pts.map((p, i) => (p[k] == null ? '' : `<circle cx="${x(i)}" cy="${y(p[k])}" r="3" fill="${k === 'w814' ? 'var(--ink)' : 'var(--ink-soft)'}"/>`)).join('');
  };
  let g = '';
  const step = ymax - ymin > 8 ? 2 : 1;
  for (let t = ymin; t <= ymax; t += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${t}°</text>`;
  pts.forEach((p, i) => {
    if (i % Math.ceil(pts.length / 6) && i !== pts.length - 1) return;
    g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--ink-soft)">${runLabel(p, true)}</text>`;
  });
  const lastW = pts[pts.length - 1].w814, prevW = pts[pts.length - 2].w814;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend van dag 8 tot 14 over de laatste runs">${g}${line('w17', 'stroke="var(--ink-soft)" stroke-dasharray="4 4" stroke-width="1.5"')}${line('w814', 'stroke="var(--ink)" stroke-width="2.5"')}
    <text x="${W - R}" y="11" text-anchor="end" font-size="10.5" fill="var(--ink-soft)">doorgetrokken: dag 8–14 · gestippeld: dag 1–7</text></svg>
    ${lastW != null && prevW != null ? `<p class="note">Laatste run: dag 8–14 gemiddeld ${String(lastW).replace('.', ',')}°, ${deltaHTML(lastW - prevW)} ten opzichte van de vorige run.</p>` : ''}`;
}

function runLabel(r, short = false) {
  if (r.run && !r.estimated) {
    const d = new Date(r.run);
    const txt = `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}z`;
    return short ? txt : `run ${txt}`;
  }
  const f = new Date(r.fetched);
  const t = f.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (r.live) return short ? `${f.getDate()}/${f.getMonth() + 1} ${t}` : `nieuwste data (${t} opgehaald)`;
  return short ? `${f.getDate()}/${f.getMonth() + 1} ${t}` : `run binnengekomen ${f.getDate()}/${f.getMonth() + 1} ${t}`;
}

function deltaHTML(d) {
  if (d == null || Number.isNaN(d)) return '';
  const r = Math.round(d * 10) / 10;
  if (Math.abs(r) < 0.3) return `<span class="delta z">±0</span>`;
  return `<span class="delta ${r < 0 ? 'c' : 'w'}">${r > 0 ? '+' : '−'}${String(Math.abs(r)).replace('.', ',')}</span>`;
}

async function renderDay14() {
  const pick = $('modelPick');
  pick.innerHTML = ENSEMBLES.map((m) => `<button role="radio" aria-checked="${m.key === state.model}" data-k="${m.key}">${m.short}</button>`).join('');
  const model = ENSEMBLES.find((m) => m.key === state.model);
  $('plumeTitle').textContent = `${model.label}, ${state.loc.name}`;
  $('plumeSummary').textContent = 'Pluim wordt geladen…';
  $('plumeT2').innerHTML = ''; $('plumeT850').innerHTML = '';
  let live;
  try {
    live = await fetchEnsemble(state.loc, state.model);
  } catch (e) {
    $('plumeSummary').innerHTML = `<span class="err">Kon ${esc(model.label)} niet ophalen (${esc(e.message)}). Probeer een ander model of later opnieuw.</span>`;
  }
  if (live) {
    const h = live.data.hourly;
    const t2 = extractMembers(h, 'temperature_2m');
    const t850 = extractMembers(h, 'temperature_850hPa');
    $('plumeT2').innerHTML = plumeSVG(h.time, t2, { label: `T2m-pluim ${model.label}` });
    $('plumeT850').innerHTML = t850.length ? plumeSVG(h.time, t850, { label: `T850-pluim ${model.label}`, h: 240 }) : '<p class="note">Dit model levert geen T850 via de bron.</p>';
    const keys = Object.keys(live.dates).sort();
    const w = windowMean(live.dates, 7, 13, keys[0]);
    const lastDay = keys[keys.length - 1];
    let anomTxt = '';
    if (w != null) {
      const later = keys.slice(7, 14);
      const norm = later.reduce((s, d) => { const m = monthOf(d) - 1; return s + (NORMAL_TX[m] + NORMAL_TN[m]) / 2; }, 0) / later.length;
      const a = w - norm;
      anomTxt = ` Dag 8–14 gemiddeld ${String(w).replace('.', ',')}° (${Math.abs(a) < 0.7 ? 'rond normaal' : `${Math.abs(a).toFixed(1).replace('.', ',')}° ${a < 0 ? 'kouder' : 'warmer'} dan normaal`}).`;
    }
    $('plumeSummary').textContent = `${t2.length} leden tot en met ${dShort(lastDay)}. Dikke lijn = gemiddelde, band = 10–90% van de leden.${anomTxt}`;
  }

  // run tegen run
  const runs = runsFor(state.model, live);
  const cur = runs[0], prev = runs[1];
  if (!cur) { $('runList').innerHTML = ''; $('runNote').textContent = 'Nog geen runs beschikbaar.'; }
  else {
    const delta = prev ? compareRuns(cur.dates, prev.dates) : {};
    $('runNote').innerHTML = prev
      ? `${esc(runLabel(cur))} tegen ${esc(runLabel(prev))}. <span class="delta c">blauw</span> = kouder, <span class="delta w">rood</span> = warmer dan de vorige run.`
      : `Dit is de eerste run die voor deze locatie is bewaard. Bij de volgende run zie je per datum of het kouder of warmer is geworden.`;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
    $('runList').innerHTML = `<li class="hdr"><span>Datum</span><span>Max (gem.)</span><span>Min (gem.)</span></li>` +
      Object.keys(cur.dates).sort().filter((d) => d >= today).map((d) => {
        const r = cur.dates[d], dd = delta[d] || {};
        return `<li><span class="d">${DAYS[new Date(d + 'T12:00:00Z').getUTCDay()]} ${dShort(d)}</span>
          <span><span class="v">${deg(r.tx)}</span>${deltaHTML(dd.dTx)}</span>
          <span><span class="v">${deg(r.tn)}</span>${deltaHTML(dd.dTn)}</span></li>`;
      }).join('');
  }
  $('trend').innerHTML = trendSVG(runs);
  renderSignals();
}

function renderSignals() {
  const sig = state.history?.signals || state.signalsFallback;
  if (!sig?.days?.length) {
    $('openings').innerHTML = '<li>Signalen verschijnen na de eerste automatische update op GitHub.</li>';
    $('signals').innerHTML = '';
    return;
  }
  const prev = sig.prevOpenings?.[0];
  $('openings').innerHTML = sig.openings.map((o, i) => `<li class="l${o.level}">${esc(o.text)}${i === 0 && prev && prev.text !== o.text ? `<span class="was">Vorige update: ${esc(prev.text)}</span>` : ''}</li>`).join('');
  const days = sig.days.filter((d) => d.nao != null || d.pEast != null).slice(0, 15);
  const W = 420, L = 70, cw = (W - L - 6) / days.length, rh = 26;
  const rows = [
    ['NAO', (d) => d.nao, (v) => (v == null ? 'transparent' : v < 0 ? `rgba(108,196,255,${Math.min(1, 0.15 + Math.abs(v) / 2)})` : `rgba(255,138,107,${Math.min(1, 0.15 + v / 2)})`), (v) => (v == null ? '' : nl(v))],
    ['Oostenwind', (d) => d.pEast, (v) => `rgba(255,255,255,${v == null ? 0 : 0.05 + v / 110})`, (v) => (v == null ? '' : v)],
    ['Blokkade', (d) => d.pBlock, (v) => `rgba(169,220,255,${v == null ? 0 : 0.05 + v / 110})`, (v) => (v == null ? '' : v)],
  ];
  let g = '';
  rows.forEach(([name, get, col, txt], r) => {
    const y0 = 8 + r * (rh + 4);
    g += `<text x="0" y="${y0 + 17}" font-size="10.5" fill="var(--ink-soft)">${name}</text>`;
    days.forEach((d, i) => {
      const v = get(d);
      g += `<rect x="${L + i * cw}" y="${y0}" width="${cw - 2}" height="${rh}" rx="3" fill="${col(v)}"/>`;
      if (cw > 22) g += `<text x="${L + i * cw + cw / 2 - 1}" y="${y0 + 17}" text-anchor="middle" font-size="10" fill="${v != null && (r === 0 ? Math.abs(v) > 1.2 : v > 55) ? '#0d2a45' : 'var(--ink)'}">${txt(v)}</text>`;
    });
  });
  days.forEach((d, i) => { if (i % 2 === 0) g += `<text x="${L + i * cw + cw / 2}" y="${8 + 3 * (rh + 4) + 12}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${Number(d.date.slice(8))}</text>`; });
  $('signals').innerHTML = `<svg viewBox="0 0 ${W} ${8 + 3 * (rh + 4) + 18}" role="img" aria-label="Grootschalige signalen per dag">${g}</svg>`;
}

// ---------- footer ----------
function renderFoot() {
  const st = state.status?.models || {};
  const parts = ENSEMBLES.filter((m) => st[m.key]).map((m) => `${m.short} ${runLabel(st[m.key], true)}${st[m.key].estimated ? '*' : ''}`);
  $('foot').innerHTML = `
    ${parts.length ? `<p>Laatst bewaarde runs: ${parts.join(', ')}${parts.some((p) => p.endsWith('*')) ? ' (* tijdstip van binnenkomst, run-tijd onbekend)' : ''}.</p>` : '<p>Het archief wordt elk uur bijgewerkt door een GitHub Action.</p>'}
    <p>Data: <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0), met modellen van ECMWF, KNMI, NOAA, DWD en ECCC. Dagwaarden uit ensembles zijn gebaseerd op 6-uurlijkse of uurlijkse tijdstappen en kunnen extremen iets afvlakken. Radar: <a href="https://www.rainviewer.com/">RainViewer</a>; kaart: © OpenStreetMap, © CARTO.</p>
    <p class="owner">© ${new Date().getFullYear()} Winterwacht is eigendom van Eddy Dekker.</p>`;
}

// ---------- sneeuw (de enige animatie) ----------
let snowRAF = null;
function startSnow(on) {
  const cv = $('snow');
  cancelAnimationFrame(snowRAF);
  const ctx = cv.getContext('2d');
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  size(); addEventListener('resize', size, { once: true });
  const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2, s: 0.0006 + Math.random() * 0.0012, w: Math.random() * 6 }));
  const t0 = performance.now();
  const tick = (t) => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    // na 12 seconden laten we de sneeuw rustig uitsterven, zodat het niet blijft afleiden
    const fade = Math.max(0, 1 - Math.max(0, (t - t0) - 12000) / 4000);
    ctx.fillStyle = `rgba(255,255,255,${0.75 * fade})`;
    for (const f of flakes) {
      f.y += f.s; f.w += 0.01;
      if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
      ctx.beginPath();
      ctx.arc((f.x + Math.sin(f.w) * 0.01) * cv.width, f.y * cv.height, f.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (fade > 0) snowRAF = requestAnimationFrame(tick);
  };
  snowRAF = requestAnimationFrame(tick);
}

// ---------- locatie ----------
function setLocation(loc) {
  state.loc = loc;
  radarLocation(loc);
  $('placeName').textContent = loc.name;
  refresh();
}
function initPlaces() {
  const dlg = $('placeSheet');
  const homeLabel = () => { $('homeLabel').textContent = state.home.name; $('resetHome').hidden = distKm(state.home, HOME) < 1; };
  homeLabel();
  $('placeBtn').addEventListener('click', () => { homeLabel(); dlg.showModal(); $('q').focus(); });
  $('useHome').addEventListener('click', () => { dlg.close(); setLocation(state.home); });
  $('useGps').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Locatie wordt niet ondersteund door deze browser.'); return; }
    $('useGps').textContent = 'Locatie bepalen…';
    navigator.geolocation.getCurrentPosition((p) => {
      $('useGps').textContent = 'Mijn huidige locatie';
      dlg.close();
      setLocation({ name: 'Hier', lat: Math.round(p.coords.latitude * 1000) / 1000, lon: Math.round(p.coords.longitude * 1000) / 1000 });
    }, () => { $('useGps').textContent = 'Locatie niet beschikbaar — sta toegang toe in Instellingen'; }, { timeout: 12000, maximumAge: 600000 });
  });
  $('resetHome').addEventListener('click', () => { state.home = { ...HOME }; store.set('ww.home', state.home); homeLabel(); dlg.close(); setLocation(state.home); });
  let timer;
  $('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('results').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await getJSON(`${GEO}?name=${encodeURIComponent(q)}&count=6&language=nl&format=json`);
        const list = r.results || [];
        $('results').innerHTML = list.length ? list.map((p, i) => `<li><button type="button" data-i="${i}" class="go">${esc(p.name)}<small>${esc([p.admin1, p.country].filter(Boolean).join(', '))}</small></button><button type="button" data-i="${i}" class="sethome">Als thuis</button></li>`).join('') : '<li>Niets gevonden. Probeer een andere spelling.</li>';
        $('results').onclick = (ev) => {
          const b = ev.target.closest('button'); if (!b) return;
          const p = list[Number(b.dataset.i)];
          const loc = { name: p.name, lat: p.latitude, lon: p.longitude };
          if (b.classList.contains('sethome')) { state.home = loc; store.set('ww.home', loc); homeLabel(); }
          dlg.close(); setLocation(loc);
        };
      } catch { $('results').innerHTML = '<li>Zoeken lukt nu niet. Controleer je verbinding.</li>'; }
    }, 300);
  });
}

// ---------- LAAG 3: lange termijn ----------
const monthName = (k) => new Date(k + '-15T12:00:00Z').toLocaleDateString('nl-NL', { month: 'long', timeZone: 'UTC' });
const weekLabel = (k) => {
  const a = new Date(k + 'T12:00:00Z'), b = new Date(a.getTime() + 6 * 864e5);
  const m = (d) => d.toLocaleDateString('nl-NL', { month: 'short', timeZone: 'UTC' });
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${m(b)}` : `${a.getUTCDate()} ${m(a)}–${b.getUTCDate()} ${m(b)}`;
};
const anomTxt = (a) => (a == null ? '–' : `${a > 0 ? '+' : a < 0 ? '−' : ''}${nl(Math.abs(a).toFixed(1))}°`);

// Live ophalen voor plekken zonder archief (bijv. een tijdelijke thuislocatie).
async function fetchLongLive(key) {
  const m = LONG_MODELS[key];
  for (const ids of [m.members, m.mean]) {
    for (const id of ids) {
      for (const vars of LONG_VARS) {
        try {
          const data = await getJSON(longUrl(m.freq, id, vars, state.loc.lat, state.loc.lon));
          const periods = summarizeLong(data, m.freq);
          if (periods) return periods;
        } catch (e) { if (e.status !== 400) throw e; }
      }
    }
  }
  return null;
}

async function longIssues(key) {
  if (state.longArchive?.models?.[key]?.issues?.length) return state.longArchive.models[key].issues;
  const lk = `ww.long.${state.loc.lat.toFixed(2)},${state.loc.lon.toFixed(2)}.${key}`;
  const issues = store.get(lk, []);
  const periods = await fetchLongLive(key).catch(() => null);
  if (periods) {
    const fp = longFingerprint(periods);
    if (!issues.length || issues[0].fp !== fp) {
      issues.unshift({ issued: Object.keys(periods).sort()[0], fetched: new Date().toISOString(), fp, periods });
      store.set(lk, issues.slice(0, 20));
    }
  }
  return issues;
}

function dbar(rec) {
  const R = 3; // schaal: ±3 °C
  const pos = (v) => 50 + (Math.max(-R, Math.min(R, v)) / R) * 50;
  const a = rec.anom ?? 0;
  const left = Math.min(pos(0), pos(a)), width = Math.abs(pos(a) - pos(0));
  const spread = rec.p10 != null ? `<span class="spread" style="left:${pos(rec.p10)}%;width:${pos(rec.p90) - pos(rec.p10)}%"></span>` : '';
  const col = a < 0 ? `rgb(${mix([108, 196, 255], [235, 248, 255], Math.min(1, -a / 2.5)).join(',')})` : rgb(mix([150, 150, 145], [255, 138, 107], Math.min(1, a / 2.5)));
  return `<div class="dbar" aria-hidden="true">${spread}<span style="left:${left}%;width:${Math.max(width, 0.8)}%;background:${col}"></span></div>`;
}

function longRows(cur, prev, freq, labelFn, isPast) {
  const delta = compareLong(cur, prev, freq);
  return Object.keys(cur).sort().filter((k) => !isPast(k)).map((k) => {
    const r = cur[k];
    const probs = r.pCold != null ? `kans kouder ${r.pCold}%, warmer ${r.pWarm}%` : 'alleen ensemblegemiddelde beschikbaar';
    const d = delta[k] != null ? ` ${deltaHTML(delta[k])} t.o.v. vorige uitgave` : '';
    return `<li><span class="per">${labelFn(k)}</span>${dbar(r)}<span class="val">${anomTxt(r.anom)}</span>
      <span class="meta">${probs}${d}</span></li>`;
  }).join('');
}

function lineChart(series, xLabels, opts = {}) {
  const pts = series.flatMap((s) => s.vals).filter((v) => v != null);
  if (xLabels.length < 2 || pts.length < 2) return `<p class="note">${opts.empty || 'Er zijn nog te weinig uitgaven bewaard voor een ontwikkeling.'}</p>`;
  const W = 420, H = 180, L = 30, R = 64, T = 14, B = 24;
  let ymin = Math.floor(Math.min(0, ...pts) - 0.5), ymax = Math.ceil(Math.max(0, ...pts) + 0.5);
  const x = (i) => L + (i / (xLabels.length - 1)) * (W - L - R);
  const y = (t) => T + (1 - (t - ymin) / (ymax - ymin)) * (H - T - B);
  let g = '';
  for (let t = ymin; t <= ymax; t++) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? 'var(--ink-soft)' : 'var(--line)'}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${t > 0 ? '+' : ''}${t}°</text>`;
  xLabels.forEach((lab, i) => {
    if (xLabels.length > 6 && i % Math.ceil(xLabels.length / 6) && i !== xLabels.length - 1) return;
    g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--ink-soft)">${esc(lab)}</text>`;
  });
  const ends = [];
  series.forEach((s) => {
    let d = '', pen = false, lastI = -1;
    s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; lastI = i; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
    s.vals.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"/>`; });
    if (lastI >= 0) ends.push({ x: x(lastI) + 6, y: y(s.vals[lastI]) + 4, s });
  });
  // labels aan het eind niet over elkaar heen laten vallen
  ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].y < 13) e.y = arr[i - 1].y + 13; });
  ends.forEach((e) => { g += `<text x="${e.x}" y="${e.y}" font-size="11" fill="${e.s.color}">${esc(e.s.name)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Ontwikkeling')}">${g}</svg>`;
}

async function renderWinter() {
  $('seasHead').textContent = 'De winterverwachting wordt opgehaald…';
  const [seas, ec46] = await Promise.all([longIssues('seas').catch(() => []), longIssues('ec46').catch(() => [])]);
  const today = new Date().toISOString().slice(0, 10);

  // Seizoen (SEAS5)
  if (!seas.length) {
    $('seasHead').textContent = 'Nog geen seizoensverwachting beschikbaar';
    $('seasSub').textContent = 'De seizoensverwachting verschijnt na de volgende automatische update.';
    $('seasList').innerHTML = '';
  } else {
    const cur = seas[0], prev = seas[1];
    const wm = winterMean(cur.periods), wp = prev ? winterMean(prev.periods) : null;
    const issueTxt = monthName(cur.issued.slice(0, 7));
    if (wm) {
      const a = wm.anom;
      $('seasHead').textContent = Math.abs(a) < 0.3 ? 'De winter ziet er normaal uit'
        : a < 0 ? `De winter wordt ${nl(Math.abs(a).toFixed(1))}° kouder dan normaal`
        : `De winter wordt ${nl(a.toFixed(1))}° zachter dan normaal`;
      let sub = `Gemiddelde van ${wm.months.map(monthName).join(', ')} volgens ${LONG_MODELS.seas.label}, uitgave ${issueTxt}.`;
      if (wp) {
        const d = Math.round((a - wp.anom) * 10) / 10;
        sub += Math.abs(d) < 0.1 ? ' Gelijk aan de vorige uitgave.' : ` Dat is ${nl(Math.abs(d).toFixed(1))}° ${d < 0 ? 'kouder' : 'zachter'} dan de vorige uitgave.`;
      }
      $('seasSub').textContent = sub;
    } else {
      $('seasHead').textContent = 'Seizoensverwachting';
      $('seasSub').textContent = `Volgens ${LONG_MODELS.seas.label}, uitgave ${issueTxt}.`;
    }
    $('seasNote').innerHTML = `Afwijking per maand. De dunne lichte balk toont de spreiding (10–90% van de leden). ${prev ? `Vergeleken met de uitgave van ${monthName(prev.issued.slice(0, 7))}.` : 'Vanaf de volgende uitgave (de 5e van de maand) zie je hier ook het verschil.'}`;
    $('seasList').innerHTML = longRows(cur.periods, prev?.periods, 'monthly', (k) => `${monthName(k)}<small>${k.slice(0, 4)}</small>`, (k) => k < today.slice(0, 7));
  }

  // Weken (EC46)
  if (!ec46.length) {
    $('ec46Note').textContent = 'De weekverwachting verschijnt na de volgende automatische update.';
    $('ec46List').innerHTML = '';
  } else {
    const cur = ec46[0], prev = ec46[1];
    $('ec46Note').innerHTML = `Afwijking per week volgens ${LONG_MODELS.ec46.label} (elke dag nieuw). ${prev ? `Verschil met de uitgave van ${dShort(prev.issued)}: <span class="delta c">blauw</span> kouder, <span class="delta w">rood</span> warmer.` : ''}`;
    $('ec46List').innerHTML = longRows(cur.periods, prev?.periods, 'weekly', (k) => `${weekLabel(k)}`, (k) => {
      const end = new Date(new Date(k + 'T12:00:00Z').getTime() + 6 * 864e5).toISOString().slice(0, 10);
      return end < today;
    });
  }

  // Ontwikkeling over uitgaven
  const sOld = seas.slice(0, 12).reverse();
  const targets = [...new Set(sOld.flatMap((i) => Object.keys(i.periods)))].filter((k) => ['12', '01', '02'].includes(k.slice(5, 7)) && k >= today.slice(0, 7)).sort().slice(0, 3);
  const colors = ['#bfe6ff', '#ffffff', '#6cc4ff'];
  $('evoNote').textContent = 'Boven: de verwachte afwijking voor december, januari en februari, per seizoensuitgave. Onder: de verwachte afwijking voor week 3 en 4 vooruit, per dagelijkse EC46-uitgave. Een dalende lijn betekent dat de modellen steeds kouder worden.';
  $('evoSeas').innerHTML = lineChart(
    targets.map((t, i) => ({ name: monthName(t), color: colors[i], dash: i === 1 ? '' : i === 0 ? '5 3' : '2 3', vals: sOld.map((iss) => iss.periods[t]?.anom ?? null) })),
    sOld.map((iss) => monthName(iss.issued.slice(0, 7)).slice(0, 3)),
    { label: 'Ontwikkeling seizoensverwachting', empty: 'De ontwikkeling per wintermaand verschijnt vanaf de tweede seizoensuitgave (de 5e van volgende maand).' },
  );
  const eOld = ec46.slice(0, 30).reverse();
  $('evoEc46').innerHTML = lineChart(
    [{ name: 'week 3–4', color: '#ffffff', vals: eOld.map((iss) => {
      const ks = Object.keys(iss.periods).sort().slice(2, 4);
      const v = ks.map((k) => iss.periods[k].anom).filter((x) => x != null);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    }) }],
    eOld.map((iss) => dShort(iss.issued)),
    { label: 'Ontwikkeling week 3 en 4 volgens EC46', empty: 'De ontwikkeling van week 3–4 verschijnt vanaf de tweede EC46-uitgave (morgen).' },
  );
}

// ---------- tabs & verversen ----------
function showView(v) {
  state.view = v; store.set('ww.view', v);
  for (const k of ['5', '14', '90']) {
    $(`tab-${k}`).setAttribute('aria-selected', v === k);
    $(`view-${k}`).hidden = v !== k;
  }
  if (v === '14') renderDay14();
  if (v === '90') renderWinter();
}

async function refresh() {
  $('stamp').textContent = 'Bijwerken…';
  await loadConfigAndHistory();
  renderFoot();
  const [det, ens, hourly] = await Promise.all([
    fetchDeterministic(state.loc).catch(() => ({})),
    fetchEnsemble(state.loc, 'aifs').catch(() => null),
    fetchHourly(state.loc).catch(() => null),
  ]);
  renderDay5(det, ens?.dates);
  hstate.sel = 0;
  renderHourly(hourly);
  radarRefresh();
  if (state.view === '14') renderDay14();
  if (state.view === '90') renderWinter();
  $('stamp').textContent = `Bijgewerkt ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
  state.lastRefresh = Date.now();
}

function init() {
  $('placeName').textContent = state.loc.name;
  $('tab-5').addEventListener('click', () => showView('5'));
  $('tab-14').addEventListener('click', () => showView('14'));
  $('tab-90').addEventListener('click', () => showView('90'));
  $('modelPick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.model = b.dataset.k; renderDay14();
  });
  initPlaces();
  initHourly();
  initRadar({
    map: $('radarMap'), play: $('radarPlay'), prev: $('radarPrev'), next: $('radarNext'), slider: $('radarSlider'),
    time: $('radarTime'), ago: $('radarAgo'), center: $('radarCenter'), status: $('radarStatus'),
  }, () => state.loc);
  showView(state.view);
  refresh();
  // bij terugkeren naar de app (iPhone): verversen als het langer dan 15 min geleden is
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (state.lastRefresh || 0) > 15 * 60e3) refresh();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
