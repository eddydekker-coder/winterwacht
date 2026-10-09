// Uurverwachting: rekenlogica zonder afhankelijkheden (testbaar in Node).
// Eerste 48 uur KNMI HARMONIE per uur, daarna ECMWF IFS per 3 uur tot en met dag 5.
// Neerslag- en sneeuwkansen uit het DWD ICON-ensemble (ICON-D2-EPS 2 km, daarna ICON-EU-EPS).

export const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'dew_point_2m', 'weather_code', 'is_day', 'cloud_cover',
  'precipitation', 'rain', 'snowfall', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'visibility', 'surface_temperature',
].join(',');
// Kleinere set als een model de volledige set weigert (HTTP 400)
export const HOURLY_VARS_MIN = [
  'temperature_2m', 'apparent_temperature', 'dew_point_2m', 'weather_code', 'is_day',
  'precipitation', 'rain', 'snowfall', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');

export const HOURLY_MODELS = {
  knmi: { label: 'KNMI HARMONIE', ids: ['knmi_seamless', 'knmi_harmonie_arome_netherlands'] },
  ecmwf: { label: 'ECMWF IFS', ids: ['ecmwf_ifs', 'ecmwf_ifs025'] },
};
export const HOURLY_ENS = { label: 'ICON-ensemble', ids: ['icon_seamless_eps', 'icon_eu_eps', 'icon_seamless'] };

export const SPLIT_HOURS = 48;   // tot hier KNMI per uur
export const COARSE_STEP = 3;    // daarna ECMWF per 3 uur

// ---------- wind ----------
const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]; // km/u ondergrenzen van Bft 1..12
export function beaufort(kmh) {
  if (kmh == null) return null;
  let b = 0;
  while (b < BFT.length && kmh >= BFT[b]) b++;
  return b;
}
const DIRS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
export function compass(deg) {
  if (deg == null) return '';
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Gevoelstemperatuur zoals het KNMI die gebruikt: JAG/TI-windchill bij kou en wind,
// daarboven de 'apparent temperature' van het model (houdt rekening met vocht en zon).
export function windChill(t, kmh) {
  if (t == null || kmh == null) return null;
  if (t > 10 || kmh < 4.8) return null;
  const v = kmh ** 0.16;
  return 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
}
export function feelsLike(t, kmh, apparent) {
  const wc = windChill(t, kmh);
  if (wc != null) return Math.min(wc, t);
  return apparent ?? t;
}

// ---------- neerslagtype ----------
// sneeuw / natte sneeuw / ijzel / regen / null
export function precipType(s) {
  if (!s.precip || s.precip < 0.05) return null;
  const snowMm = (s.snow ?? 0) / 0.7; // sneeuw in cm → mm water (ca. 7 mm sneeuw per mm water)
  const code = s.code;
  if ([56, 57, 66, 67].includes(code) || (s.ts != null && s.ts < 0 && s.t != null && s.t > 0.5 && snowMm < 0.3 * s.precip)) return 'ijzel';
  if (snowMm >= 0.8 * s.precip || [71, 73, 75, 77, 85, 86].includes(code)) return 'sneeuw';
  if (snowMm >= 0.15 * s.precip) return 'natte sneeuw';
  return 'regen';
}

// ---------- tijd ----------
const pad = (n) => String(n).padStart(2, '0');
// Lokale tijd van de locatie als 'YYYY-MM-DDTHH:00', op basis van de offset uit de API-respons
export function localHourKey(nowMs, utcOffsetSec) {
  const d = new Date(nowMs + utcOffsetSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`;
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- ensemble-kansen ----------
function membersOf(hourly, name) {
  const out = [];
  if (!hourly) return out;
  if (Array.isArray(hourly[name])) out.push(hourly[name]);
  for (let i = 1; i <= 100; i++) {
    const k = `${name}_member${pad(i)}`;
    if (Array.isArray(hourly[k])) out.push(hourly[k]);
  }
  return out;
}
// Kans (%) dat het in het venster (uren tot en met tijdstip) neerslag/sneeuw geeft
export function ensProb(ens, time, dur) {
  if (!ens?.time) return { pop: null, pSnow: null };
  const j = ens.time.indexOf(time);
  if (j < 0) return { pop: null, pSnow: null };
  const pr = membersOf(ens, 'precipitation'), sn = membersOf(ens, 'snowfall');
  const sumWin = (m) => {
    let s = 0, any = false;
    for (let k = j - dur + 1; k <= j; k++) { const v = m[k]; if (v != null) { s += v; any = true; } }
    return any ? s : null;
  };
  const prob = (list, thr) => {
    const v = list.map(sumWin).filter((x) => x != null);
    return v.length >= 5 ? Math.round((100 * v.filter((x) => x >= thr).length) / v.length) : null;
  };
  return { pop: prob(pr, dur > 1 ? 0.3 : 0.1), pSnow: sn.length ? prob(sn, 0.1) : null };
}

// ---------- stappen opbouwen ----------
function at(src, name, j) { const a = src?.[name]; return a && j >= 0 && j < a.length ? a[j] : null; }
function windowVals(src, name, j, dur) { const out = []; for (let k = j - dur + 1; k <= j; k++) out.push(at(src, name, k)); return out; }
const sumN = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; };
const maxN = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.max(...v) : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
// Meest 'gewichtige' weercode in een venster (neerslag/mist boven bewolking)
function worstCode(codes) {
  const v = codes.filter((c) => c != null);
  if (!v.length) return null;
  const rank = (c) => (c >= 51 ? 100 + c : c === 45 || c === 48 ? 50 + c : c);
  return v.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

function makeStep(src, j, dur, srcKey) {
  const t = at(src, 'temperature_2m', j);
  const wind = at(src, 'wind_speed_10m', j);
  const precip = dur === 1 ? at(src, 'precipitation', j) : sumN(windowVals(src, 'precipitation', j, dur));
  const rain = dur === 1 ? at(src, 'rain', j) : sumN(windowVals(src, 'rain', j, dur));
  const snow = dur === 1 ? at(src, 'snowfall', j) : sumN(windowVals(src, 'snowfall', j, dur));
  const s = {
    time: src.time[j], date: src.time[j].slice(0, 10), hour: Number(src.time[j].slice(11, 13)), dur, src: srcKey,
    t: r1(t),
    apparent: r1(at(src, 'apparent_temperature', j)),
    td: r1(at(src, 'dew_point_2m', j)),
    code: dur === 1 ? at(src, 'weather_code', j) : worstCode(windowVals(src, 'weather_code', j, dur)),
    isDay: at(src, 'is_day', j),
    cloud: at(src, 'cloud_cover', j),
    precip: r1(precip ?? 0), rain: r1(rain ?? 0), snow: r1(snow ?? 0),
    wind: wind == null ? null : Math.round(wind),
    dir: at(src, 'wind_direction_10m', j),
    gust: (() => { const g = dur === 1 ? at(src, 'wind_gusts_10m', j) : maxN(windowVals(src, 'wind_gusts_10m', j, dur)); return g == null ? null : Math.round(g); })(),
    vis: at(src, 'visibility', j),
    ts: r1(at(src, 'surface_temperature', j)),
  };
  s.feel = r1(feelsLike(s.t, s.wind, s.apparent));
  s.bft = beaufort(s.wind);
  s.ptype = precipType(s);
  return s;
}

// Recente neerslag (mm) in de 3 uur vóór index j, voor opvriezing van natte wegen
function recentWet(src, j) { return sumN(windowVals(src, 'precipitation', j - 1, 3)) ?? 0; }

// Gladheid, rijp en mist. Wegdek benaderd met de oppervlaktetemperatuur van het model;
// ontbreekt die, dan de 2 m-temperatuur min een marge bij heldere, windstille nachten.
export function hazards(s, wetBefore = 0) {
  const out = { glad: null, rijp: false, mist: null };
  let ts = s.ts;
  if (ts == null && s.t != null) {
    const clearCalm = !s.isDay && (s.cloud ?? 100) < 40 && (s.wind ?? 99) < 10;
    ts = s.t - (clearCalm ? 2 : 0.5);
  }
  const wet = s.precip >= 0.1;
  if (s.ptype === 'ijzel') out.glad = 'ijzel';
  else if (wet && (s.ptype === 'sneeuw' || s.ptype === 'natte sneeuw') && ((ts != null && ts <= 0.5) || (s.t != null && s.t <= 1))) out.glad = 'sneeuw';
  else if (!wet && ts != null && ts <= 0 && wetBefore >= 0.2) out.glad = 'opvriezing';
  // Rijp: oppervlak onder nul én onder het dauwpunt (waterdamp zet direct af als ijs)
  if (!wet && ts != null && ts <= 0 && s.td != null && s.td >= ts - 0.3) out.rijp = true;
  if (out.rijp && !out.glad) out.glad = 'rijp';
  // Mist uit zicht; zonder zicht uit dauwpuntspreiding en weinig wind
  if (s.vis != null) {
    if (s.vis < 200) out.mist = 'dichte mist';
    else if (s.vis < 1000) out.mist = 'mist';
  } else if (s.t != null && s.td != null && s.t - s.td <= 0.5 && (s.wind ?? 99) < 8 && !wet) out.mist = 'mist';
  if (!out.mist && (s.code === 45 || s.code === 48)) out.mist = 'mist';
  if (out.mist && s.t != null && s.t <= 0) out.mist = out.mist === 'dichte mist' ? 'dichte aanvriezende mist' : 'aanvriezende mist';
  return out;
}

// Bouw de reeks stappen vanaf het huidige uur tot en met het eind van dag 5.
// knmi/ecmwf/ens: 'hourly'-objecten van Open-Meteo (mogen ontbreken).
export function buildSteps({ knmi, ecmwf, ens, nowKey, days = 5, split = SPLIT_HOURS, coarse = COARSE_STEP }) {
  const base = knmi || ecmwf;
  if (!base?.time?.length) return [];
  const endDate = addDays(nowKey.slice(0, 10), days - 1);
  const startMs = Date.parse(nowKey + ':00Z');
  const splitKey = new Date(startMs + split * 3600e3).toISOString().slice(0, 13) + ':00';
  const steps = [];
  // Deel 1: per uur uit KNMI (of ECMWF als KNMI ontbreekt)
  const fine = knmi || ecmwf, fineKey = knmi ? 'knmi' : 'ecmwf';
  for (let j = 0; j < fine.time.length; j++) {
    const tm = fine.time[j];
    if (tm < nowKey || tm >= splitKey || tm.slice(0, 10) > endDate) continue;
    if (at(fine, 'temperature_2m', j) == null) continue;
    const s = makeStep(fine, j, 1, fineKey);
    Object.assign(s, ensProb(ens, tm, 1));
    s.hz = hazards(s, recentWet(fine, j));
    steps.push(s);
  }
  // Deel 2: per 3 uur uit ECMWF (of KNMI-seamless als ECMWF ontbreekt — die is daar ook ECMWF)
  const crs = ecmwf || knmi, crsKey = ecmwf ? 'ecmwf' : 'knmi';
  for (let j = 0; j < crs.time.length; j++) {
    const tm = crs.time[j];
    if (tm < splitKey || tm.slice(0, 10) > endDate) continue;
    if (Number(tm.slice(11, 13)) % coarse !== 0) continue;
    if (at(crs, 'temperature_2m', j) == null) continue;
    const s = makeStep(crs, j, coarse, crsKey);
    Object.assign(s, ensProb(ens, tm, coarse));
    s.hz = hazards(s, recentWet(crs, j));
    steps.push(s);
  }
  return steps;
}

// Korte samenvatting van wat de komende uren opvalt (voor de kop boven de strook)
export function hourlyHeadline(steps) {
  if (!steps.length) return '';
  const first24 = steps.filter((s, i) => i < 24);
  const glad = first24.find((s) => s.hz.glad && s.hz.glad !== 'rijp');
  const rijp = first24.find((s) => s.hz.glad === 'rijp');
  const mist = first24.find((s) => s.hz.mist);
  const snow = first24.find((s) => s.ptype === 'sneeuw' || s.ptype === 'natte sneeuw');
  const rain = first24.find((s) => s.precip >= 0.2 || (s.pop ?? 0) >= 60);
  const hh = (s) => `${s.date === steps[0].date ? '' : 'morgen '}${pad(s.hour)}:00`;
  if (glad) return `Kans op gladheid door ${glad.hz.glad} vanaf ${hh(glad)}`;
  if (snow) return `${snow.ptype === 'sneeuw' ? 'Sneeuw' : 'Natte sneeuw'} vanaf ${hh(snow)}`;
  if (rijp) return `Rijp en kans op gladheid vanaf ${hh(rijp)}`;
  if (mist) return `${mist.hz.mist[0].toUpperCase() + mist.hz.mist.slice(1)} vanaf ${hh(mist)}`;
  if (rain) return steps[0].precip >= 0.1 ? 'Nu neerslag' : `Neerslag vanaf ${hh(rain)}`;
  return 'De komende 24 uur droog';
}
