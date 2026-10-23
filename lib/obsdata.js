// Winterwacht — rekenwerk voor de waarnemingen (geen DOM, dus ook in Node te testen).
// Bronnen: KNMI-10-minutenbestanden via de Action (tak obs-data), KNMI-uurwaarden (daggegevens.knmi.nl),
// de live Buienradar-feed en de oude modelruns van Open-Meteo (previous runs).

export const TZ = 'Europe/Amsterdam';

// Meetstations rond Ommen. 'wmo' = KNMI-nummer in de archiefbestanden, 'knmi' = nummer bij uurgegevens, 'br' = Buienradar.
export const STATIONS = {
  '06278': { name: 'Heino', lat: 52.435, lon: 6.259, knmi: 278, br: 6278 },
  '06279': { name: 'Hoogeveen', lat: 52.750, lon: 6.574, knmi: 279, br: 6279 },
  '06273': { name: 'Marknesse', lat: 52.703, lon: 5.888, knmi: 273, br: 6273 },
  '06290': { name: 'Twenthe', lat: 52.274, lon: 6.891, knmi: 290, br: 6290 },
};
export const METHODS = {
  two: { label: 'Heino + Hoogeveen', ids: ['06278', '06279'] },
  four: { label: 'Vier stations', ids: ['06278', '06279', '06273', '06290'] },
};
export const MAX_STATION_KM = 45; // verder dan dit van het dichtstbijzijnde station: geen betrouwbare schatting

// ---------- tijd (Europe/Amsterdam) ----------
const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
export function tzOffsetSec(epochSec) {
  const p = dtf.formatToParts(new Date(epochSec * 1000));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) / 1000 - Math.floor(epochSec);
}
export function localParts(epochSec) {
  const p = dtf.formatToParts(new Date(epochSec * 1000));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  const y = g('year'), m = g('month'), d = g('day');
  return { y, m, d, hh: g('hour'), mm: g('minute'), key: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}
export function localToEpoch(y, m, d, hh = 0, mm = 0, ss = 0) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
  const first = guess - tzOffsetSec(guess);
  return guess - tzOffsetSec(first);
}
export const dayStart = (key) => { const [y, m, d] = key.split('-').map(Number); return localToEpoch(y, m, d, 0); };
export function addDayKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
// "2026-10-23T09:20:00" (lokale tijd, zoals Buienradar die geeft) -> epoch seconden
export function parseLocalIso(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?/.exec(s || '');
  if (!m) return null;
  return localToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}
export const isoUtc = (sec) => new Date(sec * 1000).toISOString().slice(0, 16);

// ---------- interpolatie naar de gekozen plek ----------
export function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function nearestStationKm(loc) {
  return Math.min(...Object.values(STATIONS).map((s) => distKm(loc, s)));
}
// Inverse-afstandsweging (macht 2): dichtbij weegt zwaar, ver weg nauwelijks.
export function idwWeights(loc, ids, power = 2) {
  const w = {};
  for (const id of ids) w[id] = 1 / Math.max(distKm(loc, STATIONS[id]), 1) ** power;
  return w;
}
// Gewogen gemiddelde van de stations die een waarde hebben (de gewichten worden opnieuw genormeerd).
export function blend(vals, w) {
  let s = 0, ws = 0;
  for (const id in w) {
    const v = vals[id];
    if (v == null || !Number.isFinite(v)) continue;
    s += v * w[id]; ws += w[id];
  }
  return ws > 0 ? s / ws : null;
}
// Windrichting: gemiddelde van windvectoren (nooit richtingen zelf middelen: 350° en 10° zijn buren).
export function blendDir(dd, ff, w) {
  let u = 0, v = 0, ws = 0;
  for (const id in w) {
    const d = dd[id], f = ff[id];
    if (d == null || f == null || d > 360 || f < 0.3) continue;
    const r = (d * Math.PI) / 180;
    u += -f * Math.sin(r) * w[id]; v += -f * Math.cos(r) * w[id]; ws += w[id];
  }
  if (!ws || Math.hypot(u, v) < 0.05 * ws) return null;
  return (((Math.atan2(-u, -v) * 180) / Math.PI) + 360) % 360;
}
const num = (x) => (x == null || !Number.isFinite(x) ? null : x);
const MS_TO_KMH = 3.6;

// ---------- archief van de Action (10 minuten) ----------
export function parseArchive(j) {
  if (!j || !j.data || !j.t0 || !j.step) return null;
  return { t0: j.t0, step: j.step, n: j.n, last: j.last ?? j.t0 + (j.n - 1) * j.step, updated: j.updated, data: j.data, note: j.note };
}
// Reeks van één station op het 10-minutenraster. mm = neerslag in het interval (rg is mm/u).
export function stationFine(arc, id) {
  const cols = arc?.data?.[id];
  if (!cols) return null;
  const n = arc.n;
  const g = (name, k) => num(cols[name]?.[k]);
  const f = { t0: arc.t0, step: arc.step, n, ta: [], ff: [], dd: [], fx: [], mm: [], r1h: [] };
  for (let k = 0; k < n; k++) {
    f.ta.push(g('ta', k)); f.ff.push(g('ff', k)); f.dd.push(g('dd', k)); f.fx.push(g('fx', k));
    const rg = g('rg', k);
    f.mm.push(rg == null ? null : (Math.max(0, rg) * arc.step) / 3600);
    f.r1h.push(g('r1h', k));
  }
  return f;
}
// Reeks voor de plek zelf: gewogen over de gekozen stations.
export function fineSeries(arc, loc, ids) {
  const st = {};
  for (const id of ids) { const f = stationFine(arc, id); if (f) st[id] = f; }
  const have = Object.keys(st);
  if (!have.length) return null;
  const w = idwWeights(loc, have);
  const out = { t0: arc.t0, step: arc.step, n: arc.n, ta: [], ff: [], dd: [], fx: [], mm: [], r1h: [] };
  for (let k = 0; k < arc.n; k++) {
    const pick = (name) => Object.fromEntries(have.map((id) => [id, st[id][name][k]]));
    const ff = pick('ff'), dd = pick('dd');
    out.ta.push(blend(pick('ta'), w));
    out.ff.push(blend(ff, w));
    out.dd.push(blendDir(dd, ff, w));
    out.fx.push(blend(pick('fx'), w));
    out.mm.push(blend(pick('mm'), w));
    out.r1h.push(blend(pick('r1h'), w));
  }
  return out;
}
// Uurwaarden (eind van het uur) uit een 10-minutenreeks: neerslag = som van de zes stappen.
export function hourlyFromFine(fine) {
  const h = new Map();
  if (!fine) return h;
  const per = 3600 / fine.step;
  for (let k = 0; k < fine.n; k++) {
    const t = fine.t0 + k * fine.step;
    if (t % 3600 !== 0 || k < per - 1) continue;
    let c = 0, s = 0, gust = null;
    for (let j = k - per + 1; j <= k; j++) {
      if (fine.mm[j] != null) { c++; s += fine.mm[j]; }
      if (fine.fx[j] != null) gust = gust == null ? fine.fx[j] : Math.max(gust, fine.fx[j]);
    }
    const rec = { ta: fine.ta[k], ff: fine.ff[k], dd: fine.dd[k], fx: gust, mm: c >= per - 1 ? s * (per / c) : null };
    if (rec.ta != null || rec.ff != null || rec.mm != null) h.set(t, rec);
  }
  return h;
}

// ---------- KNMI-uurwaarden (tekst van daggegevens.knmi.nl/klimatologie/uurgegevens) ----------
export function knmiHourlyBody(startKey, endKey, stationNums) {
  const f = (k, hh) => k.replace(/-/g, '') + hh;
  return `start=${f(startKey, '01')}&end=${f(endKey, '24')}&vars=T:FF:FX:DD:RH&stns=${stationNums.join(':')}`;
}
export function parseKnmiHourly(text) {
  const out = {}; // wmo -> Map(hourEnd -> rec)
  let cols = null;
  const byKnmi = Object.fromEntries(Object.entries(STATIONS).map(([wmo, s]) => [String(s.knmi), wmo]));
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith('#')) {
      if (/STN\s*,\s*YYYYMMDD/.test(raw)) cols = raw.replace(/^#/, '').split(',').map((s) => s.trim());
      continue;
    }
    if (!raw.trim() || !cols) continue;
    const p = raw.split(',').map((s) => s.trim());
    const row = Object.fromEntries(cols.map((c, i) => [c, p[i] === '' || p[i] == null ? null : Number(p[i])]));
    const wmo = byKnmi[String(row.STN)];
    if (!wmo || row.YYYYMMDD == null || row.HH == null) continue;
    const ymd = String(row.YYYYMMDD);
    const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 1000 + row.HH * 3600;
    const sc = (v, f) => (v == null ? null : v / f);
    const rec = {
      ta: sc(row.T, 10), ff: sc(row.FF, 10), fx: sc(row.FX, 10),
      dd: row.DD == null || row.DD > 360 ? null : row.DD,
      mm: row.RH == null ? null : row.RH < 0 ? 0 : row.RH / 10, // -1 = minder dan 0,05 mm
    };
    (out[wmo] ||= new Map()).set(t, rec);
  }
  return out;
}
// KNMI-uurwaarden gaan vóór (gevalideerd); het archief vult aan wat ontbreekt of nog niet binnen is.
export function mergeHourly(knmi, arc) {
  const m = new Map();
  for (const src of [arc, knmi]) {
    if (!src) continue;
    for (const [t, r] of src) {
      const cur = m.get(t) || {};
      for (const k of ['ta', 'ff', 'dd', 'fx', 'mm']) if (r[k] != null) cur[k] = r[k];
      m.set(t, cur);
    }
  }
  return m;
}
// Uurwaarden voor de plek: per uur gewogen over de stations die dat uur een waarde hebben.
export function placeHourly(hourlyById, loc, ids) {
  const have = ids.filter((id) => hourlyById[id]);
  if (!have.length) return new Map();
  const w = idwWeights(loc, have);
  const times = new Set();
  for (const id of have) for (const t of hourlyById[id].keys()) times.add(t);
  const out = new Map();
  for (const t of [...times].sort((a, b) => a - b)) {
    const pick = (k) => Object.fromEntries(have.map((id) => [id, hourlyById[id].get(t)?.[k] ?? null]));
    const ff = pick('ff');
    const rec = { ta: blend(pick('ta'), w), ff: blend(ff, w), dd: blendDir(pick('dd'), ff, w), fx: blend(pick('fx'), w), mm: blend(pick('mm'), w) };
    out.set(t, rec);
  }
  return out;
}

// ---------- live (Buienradar) ----------
export function parseBuienradar(feed, ids = Object.keys(STATIONS)) {
  const list = feed?.actual?.stationmeasurements || [];
  const out = {};
  for (const id of ids) {
    const br = STATIONS[id].br;
    const s = list.find((x) => x.stationid === br);
    if (!s) continue;
    out[id] = {
      ts: parseLocalIso(s.timestamp), ta: num(s.temperature), feel: num(s.feeltemperature), ff: num(s.windspeed), dd: num(s.winddirectiondegrees),
      fx: num(s.windgusts), rg: num(s.precipitation), r1h: num(s.rainFallLastHour), r24h: num(s.rainFallLast24Hour), rh: num(s.humidity),
      desc: s.weatherdescription || '',
    };
  }
  return out;
}
export function liveForPlace(live, loc, ids) {
  const have = ids.filter((id) => live[id] && live[id].ts != null);
  if (!have.length) return null;
  const w = idwWeights(loc, have);
  const pick = (k) => Object.fromEntries(have.map((id) => [id, live[id][k]]));
  const ff = pick('ff');
  const ts = Math.max(...have.map((id) => live[id].ts));
  return {
    ts, ta: blend(pick('ta'), w), feel: blend(pick('feel'), w), ff: blend(ff, w), dd: blendDir(pick('dd'), ff, w), fx: blend(pick('fx'), w),
    rg: blend(pick('rg'), w), r1h: blend(pick('r1h'), w), r24h: blend(pick('r24h'), w), rh: blend(pick('rh'), w), stations: have,
  };
}

// ---------- neerslag opbouwen en sommeren ----------
// Stukjes regen {a, b, mm} (a < b, epoch s). KNMI-uurwaarden gaan vóór; daarna 10-minutenwaarden uit het archief;
// tussen de laatste 10-minutenwaarde en 'nu' vult het uursom van de live-feed de rest (rainFallLastHour).
export function buildPieces({ knmiHourly, fine, now, liveR1h }) {
  const pieces = [];
  const hourCovered = new Set();
  if (knmiHourly) {
    for (const [H, r] of knmiHourly) {
      if (r.mm == null) continue;
      pieces.push({ a: H - 3600, b: H, mm: r.mm });
      hourCovered.add(H);
    }
  }
  let tEnd = null;
  if (fine) {
    for (let k = 0; k < fine.n; k++) {
      const mm = fine.mm[k];
      if (mm == null) continue;
      const t = fine.t0 + k * fine.step;
      tEnd = t;
      if (hourCovered.has(Math.ceil(t / 3600) * 3600)) continue;
      pieces.push({ a: t - fine.step, b: t, mm });
    }
  }
  let gap = null;
  if (now != null && liveR1h != null) {
    const from = tEnd == null ? now - 3600 : Math.max(tEnd, now - 3600);
    if (now - from > 90) {
      let overlap = 0;
      if (tEnd != null && tEnd > now - 3600) overlap = sumBetween(pieces, now - 3600, tEnd).mm;
      gap = { a: from, b: now, mm: Math.max(0, liveR1h - overlap), live: true };
      pieces.push(gap);
    }
  }
  pieces.sort((x, y) => x.a - y.a);
  return { pieces, tEnd, gap };
}
// Som over [a, b] met evenredige verdeling van stukjes die half in het venster vallen.
export function sumBetween(pieces, a, b) {
  let mm = 0, cov = 0;
  for (const p of pieces) {
    const lo = Math.max(a, p.a), hi = Math.min(b, p.b);
    if (hi <= lo) continue;
    const f = (hi - lo) / (p.b - p.a);
    mm += p.mm * f; cov += hi - lo;
  }
  return { mm, coverage: b > a ? Math.min(1, cov / (b - a)) : 1 };
}
export const WINDOWS_H = [1, 3, 6, 9, 12, 24];
export function rainWindows(pcs, now, liveR1h) {
  return WINDOWS_H.map((h) => {
    const r = sumBetween(pcs.pieces, now - h * 3600, now);
    // het laatste uur is rechtstreeks gemeten
    if (h === 1 && liveR1h != null) return { h, mm: liveR1h, coverage: 1 };
    return { h, mm: r.mm, coverage: r.coverage };
  });
}
// Neerslag per lokale datum, verdeeld over vier tijdsvakken van zes uur.
export const SLOTS = [[0, 6], [6, 12], [12, 18], [18, 24]];
export function rainByDay(pcs, now, days = 14) {
  const today = localParts(now).key;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDayKey(today, -i);
    const [y, m, d] = key.split('-').map(Number);
    const at = (h) => localToEpoch(y, m, d, h); // h = 24 geeft middernacht van de volgende dag
    const slots = SLOTS.map(([h0, h1]) => {
      const a = at(h0), b = at(h1);
      if (a >= now) return { mm: null, coverage: 0, future: true };
      const r = sumBetween(pcs.pieces, a, Math.min(b, now));
      return { mm: r.mm, coverage: r.coverage, partial: b > now };
    });
    const known = slots.filter((x) => x.mm != null);
    out.push({
      key, slots, partial: at(24) > now,
      mm: known.length ? known.reduce((x, c) => x + c.mm, 0) : null,
      coverage: known.length ? known.reduce((x, c) => x + c.coverage, 0) / known.length : 0,
    });
  }
  return out;
}

// ---------- reeksen voor de grafieken ----------
// Punten {t, len, ta, ff, dd, fx, mm}; mm = neerslag in de tijd 'len' die op t eindigt.
export function chartPoints({ fine, hourly, from, to, useFine }) {
  const pts = [];
  if (useFine && fine) {
    // uren vóór het begin van het archief komen uit de uurwaarden, daarna het 10-minutenraster
    for (const [t, r] of hourly) if (t >= from && t <= to && t <= fine.t0 - fine.step) pts.push({ t, len: 3600, ...r });
    for (let k = 0; k < fine.n; k++) {
      const t = fine.t0 + k * fine.step;
      if (t < from || t > to) continue;
      pts.push({ t, len: fine.step, ta: fine.ta[k], ff: fine.ff[k], dd: fine.dd[k], fx: fine.fx[k], mm: fine.mm[k] });
    }
  } else {
    for (const [t, r] of hourly) if (t >= from && t <= to) pts.push({ t, len: 3600, ...r });
  }
  return pts.sort((x, y) => x.t - y.t);
}

// ---------- wind ----------
export const toKmh = (ms) => (ms == null ? null : ms * MS_TO_KMH);

// ---------- modelcheck ----------
export const CHECK_MODELS = [
  { key: 'ecmwf_ifs025', label: 'ECMWF IFS' },
  { key: 'ecmwf_aifs025_single', label: 'AIFS' },
  { key: 'gfs_seamless', label: 'GFS' },
  { key: 'icon_seamless', label: 'ICON' },
  { key: 'gem_seamless', label: 'GEM' },
  { key: 'meteofrance_seamless', label: 'Météo-France' },
  { key: 'ukmo_seamless', label: 'UK Met Office' },
  { key: 'knmi_harmonie_arome_europe', label: 'KNMI HARMONIE' },
];
export const LEAD_GROUPS = [
  { id: 'd1', label: 'Dag 1', sub: '24 u vooruit', leads: [1] },
  { id: 'd2', label: 'Dag 2', sub: '48 u', leads: [2] },
  { id: 'd3', label: 'Dag 3', sub: '72 u', leads: [3] },
  { id: 'd4', label: 'Dag 4', sub: '96 u', leads: [4] },
  { id: 'd5', label: 'Dag 5', sub: '120 u', leads: [5] },
  { id: 'lt', label: 'Lange termijn', sub: 'dag 6–7', leads: [6, 7] },
];
export const CHECK_VARS = ['temperature_2m', 'wind_speed_10m', 'precipitation'];
export function previousRunsUrl(model, loc, pastDays) {
  const vars = CHECK_VARS.flatMap((v) => Array.from({ length: 7 }, (_, i) => `${v}_previous_day${i + 1}`));
  return `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${vars.join(',')}&models=${model}&past_days=${pastDays}&forecast_days=1&timezone=UTC&wind_speed_unit=ms`;
}
const RAIN_WET_MM = 0.3; // een blok van 6 uur telt als 'nat' vanaf deze hoeveelheid

// obs: Map(hourEnd -> {ta, ff, mm}); resp: Open-Meteo-antwoord van één model.
export function scoreModel(obs, resp) {
  const times = (resp?.hourly?.time || []).map((s) => Date.parse(`${s}:00Z`) / 1000);
  const idx = new Map(times.map((t, i) => [t, i]));
  const res = {};
  for (const g of LEAD_GROUPS) {
    const acc = { ta: { s: 0, b: 0, n: 0 }, ff: { s: 0, b: 0, n: 0 }, rain: { s: 0, b: 0, n: 0, hit: 0, sumO: 0, sumM: 0 } };
    for (const lead of g.leads) {
      const get = (v) => resp.hourly?.[`${v}_previous_day${lead}`];
      const T = get('temperature_2m'), W = get('wind_speed_10m'), P = get('precipitation');
      for (let i = 0; i < times.length; i++) {
        const o = obs.get(times[i]);
        if (!o) continue;
        if (T && T[i] != null && o.ta != null) { const e = T[i] - o.ta; acc.ta.s += Math.abs(e); acc.ta.b += e; acc.ta.n++; }
        if (W && W[i] != null && o.ff != null) { const e = (W[i] - o.ff) * MS_TO_KMH; acc.ff.s += Math.abs(e); acc.ff.b += e; acc.ff.n++; }
      }
      // neerslag: blokken van zes uur (eindigend om 06, 12, 18, 00 UTC), want uur-op-uur straft elke kleine tijdsfout dubbel
      if (P) {
        for (let i = 0; i < times.length; i++) {
          if (times[i] % 21600 !== 0) continue;
          let mo = 0, mm = 0, ok = true;
          for (let j = 0; j < 6; j++) {
            const t = times[i] - j * 3600, o = obs.get(t), ix = idx.get(t);
            if (!o || o.mm == null || ix == null || P[ix] == null) { ok = false; break; }
            mo += o.mm; mm += P[ix];
          }
          if (!ok) continue;
          const e = mm - mo;
          acc.rain.s += Math.abs(e); acc.rain.b += e; acc.rain.n++;
          acc.rain.sumO += mo; acc.rain.sumM += mm;
          if ((mo >= RAIN_WET_MM) === (mm >= RAIN_WET_MM)) acc.rain.hit++;
        }
      }
    }
    const fin = (a) => (a.n ? { mae: a.s / a.n, bias: a.b / a.n, n: a.n } : { mae: null, bias: null, n: 0 });
    res[g.id] = { ta: fin(acc.ta), ff: fin(acc.ff), rain: { ...fin(acc.rain), hit: acc.rain.n ? acc.rain.hit / acc.rain.n : null, sumO: acc.rain.sumO, sumM: acc.rain.sumM } };
  }
  return res;
}
// Wie wint per leadgroep en grootheid? Een model telt pas mee met voldoende vergelijkingen (HARMONIE reikt maar ~2 dagen).
export function pickWinners(scores) {
  const keys = Object.keys(scores);
  const out = {};
  for (const g of LEAD_GROUPS) {
    out[g.id] = {};
    for (const v of ['ta', 'ff', 'rain']) {
      const nmax = Math.max(0, ...keys.map((k) => scores[k][g.id][v].n));
      const ok = keys.filter((k) => scores[k][g.id][v].mae != null && scores[k][g.id][v].n >= Math.max(8, nmax * 0.5));
      const ranked = ok.sort((a, b) => scores[a][g.id][v].mae - scores[b][g.id][v].mae);
      out[g.id][v] = ranked;
    }
    // totaal: gemiddelde rangorde over de drie grootheden (alleen modellen die overal meedoen)
    const common = keys.filter((k) => ['ta', 'ff', 'rain'].every((v) => out[g.id][v].includes(k)));
    const avg = common.map((k) => [k, ['ta', 'ff', 'rain'].reduce((s, v) => s + out[g.id][v].indexOf(k), 0) / 3]);
    avg.sort((a, b) => a[1] - b[1]);
    out[g.id].all = avg.map((x) => x[0]);
  }
  return out;
}
