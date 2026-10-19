// Weerkaarten: ECMWF en GFS. Tekent kaarten uit de velden die scripts/maps.py bewaart en
// schrijft per kaart drie regels uitleg, afgeleid uit die velden, voor de gekozen locatie.
//
// Velden (1 graad, noord boven): z500 (gpm), t850 (C), msl (hPa), pr6 (mm over 6 uur), t2m (C), u10 en v10 (m/s).
// De uitleg gebruikt de 2 m-temperatuur en 10 m-wind van het model zelf (geen vuistregel uit T850) en
// vergelijkt die met de pluim en met de vorige run.
// Alles hier is rekenwerk en tekenwerk; geen weerdata wordt verzonnen of bijgesteld.

import { linkTerms, termSheet } from './glossary.js?v=18';
import { NORMAL_TX, NORMAL_TN } from './stats.js?v=18';

const TZ = 'Europe/Amsterdam';
const KM = 111.2; // km per graad breedte
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- data
const SC = { z500: 1, t850: 10, msl: 10, pr6: 10, t2m: 10, u10: 10, v10: 10 };
// per rij delta-gecodeerd (eerste waarde absoluut), zie scripts/maps.py
function unpack(arr, k, g, delta) {
  const out = new Float32Array(arr.length), sc = SC[k] || 1;
  for (let j = 0; j < g.ny; j++) {
    let acc = 0;
    for (let i = 0; i < g.nx; i++) { const q = j * g.nx + i; acc = delta && i > 0 ? acc + arr[q] : arr[q]; out[q] = acc / sc; }
  }
  return out;
}
export function prepare(json) {
  const g = json.grid, delta = json.enc === 'd1';
  const F = {}, P = {};
  for (const lead of json.leads) {
    F[lead] = {};
    for (const k of Object.keys(json.fields[lead])) F[lead][k] = unpack(json.fields[lead][k], k, g, delta);
  }
  if (json.prev) for (const lead of Object.keys(json.prev.fields)) {
    P[lead] = {};
    for (const k of Object.keys(json.prev.fields[lead])) P[lead][k] = unpack(json.prev.fields[lead][k], k, g, delta);
  }
  return { model: json.model, label: json.label, run: new Date(json.run), prevRun: json.prev ? new Date(json.prev.run) : null, made: json.made, grid: g, leads: json.leads, F, P };
}

export function inGrid(g, lat, lon) {
  return lat <= g.lat0 && lat >= g.lat0 - (g.ny - 1) * g.d && lon >= g.lon0 && lon <= g.lon0 + (g.nx - 1) * g.d;
}

export function sample(g, arr, lat, lon) {
  const x = (lon - g.lon0) / g.d, y = (g.lat0 - lat) / g.d;
  if (x < 0 || y < 0 || x > g.nx - 1 || y > g.ny - 1) return NaN;
  const i = Math.min(Math.floor(x), g.nx - 2), j = Math.min(Math.floor(y), g.ny - 2);
  const fx = x - i, fy = y - j;
  const a = arr[j * g.nx + i], b = arr[j * g.nx + i + 1], c = arr[(j + 1) * g.nx + i], d = arr[(j + 1) * g.nx + i + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// Bicubisch (Catmull-Rom) verfijnen, zodat lijnen en kleurvlakken vloeiend zijn.
function upsample(g, arr, k, nonNeg) {
  const nx = (g.nx - 1) * k + 1, ny = (g.ny - 1) * k + 1;
  const out = new Float32Array(nx * ny);
  const at = (i, j) => arr[Math.max(0, Math.min(g.ny - 1, j)) * g.nx + Math.max(0, Math.min(g.nx - 1, i))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  for (let j = 0; j < ny; j++) {
    const y = j / k, j0 = Math.floor(y), ty = y - j0;
    for (let i = 0; i < nx; i++) {
      const x = i / k, i0 = Math.floor(x), tx = x - i0;
      const r = [0, 0, 0, 0];
      for (let m = 0; m < 4; m++) {
        const jj = j0 + m - 1;
        r[m] = cr(at(i0 - 1, jj), at(i0, jj), at(i0 + 1, jj), at(i0 + 2, jj), tx);
      }
      let v = cr(r[0], r[1], r[2], r[3], ty);
      if (nonNeg && v < 0) v = 0;
      out[j * nx + i] = v;
    }
  }
  return { nx, ny, data: out, k };
}

// ---------------------------------------------------------------- meetkundig
const rad = (x) => x * DEG;
function distKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function bearing(a, b) { // richting van a naar b, graden
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
function moveKm(p, deg, km) {
  return { lat: p.lat + (km * Math.cos(rad(deg))) / KM, lon: p.lon + (km * Math.sin(rad(deg))) / (KM * Math.cos(rad(p.lat))) };
}
const DIR8 = ['noord', 'noordoost', 'oost', 'zuidoost', 'zuid', 'zuidwest', 'west', 'noordwest'];
const dirName = (deg) => DIR8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const roundTo = (v, s) => Math.round(v / s) * s;
const fmt = (v, d = 0) => (d ? v.toFixed(d) : String(Math.round(v))).replace('.', ',').replace('-', '−');

// gradient van een veld op een plek, per meter (x = oost, y = noord)
function grad(g, arr, lat, lon) {
  const dLon = g.d, dLat = g.d;
  const e = sample(g, arr, lat, lon + dLon), w = sample(g, arr, lat, lon - dLon);
  const n = sample(g, arr, lat + dLat, lon), s = sample(g, arr, lat - dLat, lon);
  return {
    dx: (e - w) / (2 * dLon * KM * 1000 * Math.cos(rad(lat))),
    dy: (n - s) / (2 * dLat * KM * 1000),
  };
}
const coriolis = (lat) => 2 * 7.2921e-5 * Math.sin(rad(lat));

// windrichting (waar de wind vandaan komt) uit u, v
const fromDir = (u, v) => (270 - Math.atan2(v, u) / DEG + 360) % 360;
const BFT = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const beaufort = (ms) => BFT.filter((t) => ms >= t).length;

// Oppervlaktewind uit de isobaren (geostrofisch, over land ca. 65% en 20 graden naar links gedraaid)
export function surfaceWind(g, msl, lat, lon) {
  const { dx, dy } = grad(g, msl, lat, lon); // hPa per m
  const k = 1 / (1.25 * coriolis(lat));
  const u = -k * dy * 100, v = k * dx * 100;  // m/s
  const sp = Math.hypot(u, v);
  return { geo: sp, ms: sp * 0.65, from: (fromDir(u, v) - 20 + 360) % 360, hpa100: Math.hypot(dx, dy) * 1e5 };
}
// bovenwind op 500 hPa uit de hoogtelijnen
export function upperWind(g, z, lat, lon) {
  const { dx, dy } = grad(g, z, lat, lon); // gpm per m
  const k = 9.80665 / coriolis(lat);
  const u = -k * dy, v = k * dx;
  return { ms: Math.hypot(u, v), from: fromDir(u, v) };
}

// ---------------------------------------------------------------- plaatsnamen
const REGIONS = [
  ['IJsland', 62, 68, -26, -12], ['Zuid-Groenland', 58, 74, -42, -26], ['de Noorse Zee', 64, 74, -12, 15],
  ['Noord-Scandinavië', 66, 74, 10, 32], ['Scandinavië', 55, 66, 4, 32], ['de Noordzee', 52, 61, 0, 8],
  ['de Britse Eilanden', 50, 60, -11, 2], ['de Golf van Biskaje', 43, 48, -10, 0], ['het Iberisch schiereiland', 35, 43.5, -10, 4],
  ['West-Europa', 44, 52, -2, 9], ['Midden-Europa', 44, 56, 9, 24], ['Oost-Europa', 44, 62, 24, 33],
  ['de Middellandse Zee', 30, 44, 4, 33], ['de Noord-Atlantische Oceaan', 30, 64, -42, -11],
];
export function placeName(lat, lon) {
  for (const [n, la0, la1, lo0, lo1] of REGIONS) if (lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1) return n;
  return null;
}

// ---------------------------------------------------------------- extremen en patronen
// Boven het Groenlandse ijs ligt 850 hPa onder de grond en is druk herleid naar zeeniveau: daar zijn waarden niet echt.
const onGreenland = (lat, lon) => (lat >= 60 && lon <= -26) || (lat >= 68 && lon <= -18);
export function extrema(g, arr, kind, loc, { r = 5, limit = null, maxKm = 3800 } = {}) {
  const out = [];
  for (let j = 3; j < g.ny - 3; j++) {
    for (let i = 3; i < g.nx - 3; i++) {
      const v = arr[j * g.nx + i];
      if (limit != null && (kind === 'min' ? v > limit : v < limit)) continue;
      if (onGreenland(g.lat0 - j * g.d, g.lon0 + i * g.d)) continue;
      let best = true;
      for (let dj = -r; dj <= r && best; dj++) {
        for (let di = -r; di <= r; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= g.ny || ii < 0 || ii >= g.nx || (!dj && !di)) continue;
          const o = arr[jj * g.nx + ii];
          if (kind === 'min' ? o < v : o > v) { best = false; break; }
          if (o === v && (dj < 0 || (dj === 0 && di < 0))) { best = false; break; }
        }
      }
      if (best) {
        const p = { lat: g.lat0 - j * g.d, lon: g.lon0 + i * g.d, v };
        p.km = loc ? distKm(loc, p) : 0;
        if (!loc || p.km <= maxKm) out.push(p);
      }
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

// Waar zitten troggen en ruggen op de breedte van de locatie? (profiel van west naar oost)
export function zonalPattern(g, z, loc) {
  const pts = [];
  for (let dl = -32; dl <= 28; dl += 1) {
    const lon = loc.lon + dl;
    const v = sample(g, z, loc.lat, lon);
    if (!Number.isNaN(v)) pts.push({ dl, v });
  }
  const feats = [];
  for (let k = 3; k < pts.length - 3; k++) {
    const v = pts[k].v;
    const win = pts.slice(Math.max(0, k - 10), k + 11);
    const lo = Math.min(...win.map((p) => p.v)), hi = Math.max(...win.map((p) => p.v));
    if (v === lo && hi - v >= 35) feats.push({ kind: 'trog', dl: pts[k].dl, amp: hi - v });
    else if (v === hi && v - lo >= 35) feats.push({ kind: 'rug', dl: pts[k].dl, amp: v - lo });
  }
  feats.sort((a, b) => Math.abs(a.dl) - Math.abs(b.dl));
  return feats;
}

// ---------------------------------------------------------------- klimatologie
const T850_NORMAL = [-0.5, 0, 1.5, 3.5, 7, 10.5, 13, 13, 10.5, 6.5, 3, 0.5]; // ca. 52N, 6E, midden van de maand
export function t850Normal(date) {
  const m = date.getUTCMonth(), d = date.getUTCDate();
  const a = T850_NORMAL[m], b = T850_NORMAL[(m + 1) % 12];
  const f = Math.max(0, Math.min(1, (d - 15) / 30));
  const prevM = T850_NORMAL[(m + 11) % 12];
  return d >= 15 ? a + (b - a) * f : prevM + (a - prevM) * ((d + 15) / 30);
}
const sgn = (v, d = 1) => { const r = Number(v.toFixed(d)); return r === 0 ? '0' : (r > 0 ? '+' : '−') + fmt(Math.abs(r), d); };
const T = (id, text) => `[[${id}|${text}]]`;
const dateKey = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);
const hourOf = (d) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(d)) % 24;
const clockOf = (d) => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
const normalTemp = (valid) => { const m = valid.getUTCMonth(); return { tx: NORMAL_TX[m], tn: NORMAL_TN[m] }; };
const anomT850Text = (a) => (Math.abs(a) < 1.5 ? 'ongeveer normaal voor de tijd van het jaar' : a > 0 ? `${fmt(Math.abs(a))}° zachter dan normaal` : `${fmt(Math.abs(a))}° kouder dan normaal`);

// Wat ziet het model op een plek? Alles uit hetzelfde veld, hetzelfde tijdstip.
function pointFacts(data, f, loc) {
  const g = data.grid;
  const s = (k) => (f[k] ? sample(g, f[k], loc.lat, loc.lon) : NaN);
  const u = s('u10'), v = s('v10');
  return { t850: s('t850'), t2: s('t2m'), z: s('z500'), p: s('msl'), pr: s('pr6'), ms: Math.hypot(u, v), from: Number.isNaN(u) ? NaN : fromDir(u, v) };
}
const horizonText = (lead, deterministic = true) => {
  const n = Math.round(lead / 24), dagen = `${n} ${n === 1 ? 'dag' : 'dagen'}`;
  if (lead <= 72) return `Op ${dagen} vooruit is deze ${deterministic ? 'run' : 'kaart'} redelijk te vertrouwen, ook voor de plaats van fronten.`;
  if (lead <= 120) return `Op ${dagen} vooruit nadert de ${T('voorspelbaarheid', 'voorspelbaarheidshorizon')} van fronten en kleine lagedrukgebieden (ca. 4 à 5 dagen): vertrouw het grote patroon, niet de details.`;
  if (lead <= 168) return `Op ${dagen} vooruit zijn alleen de grote systemen en de ligging van troggen en ruggen nog bruikbaar; lees deze ${T('deterministisch', 'deterministische run')} samen met het ${T('ensemble', 'ensemble')}.`;
  return `Op ${dagen} vooruit is dit een scenario en geen verwachting: alleen de planetaire golven (de grote troggen en ruggen) hebben nog enige voorspelbaarheid.`;
};

// Vergelijking met de pluim (ensemble) voor dezelfde dag, als het archief die heeft.
function plumeLine(modelKey, valid, pt, ctx) {
  const r = ctx.ref && ctx.ref(modelKey, dateKey(valid));
  if (!r || !r.day) return '';
  const d = r.day, h = hourOf(valid), day = h >= 9 && h <= 18;
  const ens = { aifs: 'AIFS', ec: 'IFS', gfs: 'GEFS' }[modelKey];
  const runNote = r.run && ctx.mapRun && Math.abs(new Date(r.run) - ctx.mapRun) > 3 * 3600e3
    ? ` (pluimrun ${String(new Date(r.run).getUTCHours()).padStart(2, '0')}Z, kaartrun ${String(ctx.mapRun.getUTCHours()).padStart(2, '0')}Z: verschillende runs verklaren een deel van een verschil)` : '';
  let a = '';
  if (!Number.isNaN(pt.t2)) {
    if (day && d.tx != null) {
      const lo = d.txP10 ?? d.tx - 1, hi = d.txP90 ?? d.tx + 1;
      const v = pt.t2 > hi + 0.5 ? `warmer dan vrijwel alle leden: een uitschieter van deze run`
        : pt.t2 >= lo - 3 ? `in lijn met de pluim (een momentopname ligt overdag meestal 0 tot 2° onder het dagmaximum)`
        : `duidelijk lager dan het dagmaximum van de pluim: deze run is kouder of de dag warmt na dit tijdstip nog op`;
      a = `${ens}-${T('ensemble', 'pluim')} voor die dag: dagmaximum ${fmt(d.tx, 1)}° (P10–P90 ${fmt(lo, 1)}–${fmt(hi, 1)}°). Deze kaart: ${fmt(pt.t2, 1)}° om ${clockOf(valid)}, ${v}.`;
    } else if (!day && d.tn != null) {
      const lo = d.tnP10 ?? d.tn - 1, hi = d.tnP90 ?? d.tn + 1;
      const v = pt.t2 < lo - 0.5 ? `kouder dan vrijwel alle leden voor het nachtminimum: een uitschieter van deze run`
        : pt.t2 <= hi + 4 ? `in lijn met de pluim (de nacht is op dit tijdstip meestal nog niet op zijn koudst; het minimum volgt bij zonsopgang)`
        : `een stuk warmer dan het nachtminimum van de pluim: kan een bewolkt scenario zijn of een momentopname vóór de koudste uren`;
      a = `${ens}-${T('ensemble', 'pluim')} voor die nacht: minimum ${fmt(d.tn, 1)}° (P10–P90 ${fmt(lo, 1)}–${fmt(hi, 1)}°). Deze kaart: ${fmt(pt.t2, 1)}° om ${clockOf(valid)}, ${v}.`;
    }
  }
  let b = '';
  if (d.t850 != null && !Number.isNaN(pt.t850)) {
    const lo = d.t850P10 ?? d.t850 - 1, hi = d.t850P90 ?? d.t850 + 1;
    b = pt.t850 >= lo - 0.3 && pt.t850 <= hi + 0.3
      ? ` T850 ligt met ${fmt(pt.t850, 1)}° binnen de bandbreedte van het ensemble (${fmt(lo, 1)} tot ${fmt(hi, 1)}°).`
      : ` T850 is ${fmt(pt.t850, 1)}° en valt buiten de bandbreedte van het ensemble (${fmt(lo, 1)} tot ${fmt(hi, 1)}°): deze ${T('deterministisch', 'deterministische run')} zit aan de rand van het scenario.`;
  }
  return (a + b + runNote).trim();
}

function deltaLine(data, lead, loc, pt, kind) {
  const P = data.P && data.P[lead];
  if (!P) return '';
  const pp = pointFacts(data, P, loc);
  const h = data.prevRun ? `${String(data.prevRun.getUTCHours()).padStart(2, '0')}Z` : '12 u eerder';
  if (kind === 'A') {
    const dT = pt.t850 - pp.t850, dZ = (pt.z - pp.z) / 10;
    const dir = Math.abs(dT) < 0.8 ? 'vrijwel gelijk' : dT > 0 ? 'zachter' : 'kouder';
    let tip = '';
    if (Math.abs(dT) >= 3) tip = ` Een sprong van 3° of meer in één run is zelden de nieuwe waarheid: wacht tot de volgende run het bevestigt (${T('runvergelijking', 'run-tot-run vergelijking')}).`;
    else if (Math.abs(dT) < 0.8) tip = ' Een stabiel beeld in opeenvolgende runs vergroot het vertrouwen.';
    return `Ten opzichte van de run van ${h}: T850 ${sgn(dT)}° (${dir}), hoogte 500 hPa ${sgn(dZ, 0)} dam.${tip}`;
  }
  const dP = pt.p - pp.p;
  return `Ten opzichte van de run van ${h}: luchtdruk ${sgn(dP)} hPa. ${Math.abs(dP) >= 6 ? 'Dat is een groot verschil: het drukpatroon is in één run duidelijk verschoven.' : Math.abs(dP) < 2 ? 'Het drukpatroon is stabiel.' : 'Het drukpatroon verschuift matig.'}`;
}

// ---------------------------------------------------------------- uitleg per kaart (4 regels)
export function analyze(data, lead, loc, ctx = {}) {
  const g = data.grid, f = data.F[lead];
  const valid = new Date(data.run.getTime() + lead * 3600e3);
  const here = { lat: loc.lat, lon: loc.lon };
  const name = loc.name || 'je locatie';
  if (!inGrid(g, here.lat, here.lon)) {
    const msg = `${name} ligt buiten het kaartgebied (Atlantisch Europa). Kies een plaats in Europa om de uitleg te zien.`;
    return { A: [msg, '', '', ''], B: [msg, '', '', ''] };
  }
  const pt = pointFacts(data, f, here);
  const t = pt.t850;
  const norm = t850Normal(valid);
  const anom = t - norm;
  const hr = hourOf(valid), clock = clockOf(valid);
  const nrm = normalTemp(valid);
  const daySnap = hr >= 9 && hr <= 18;
  const modelKey = ctx.modelKey || data.model;

  // ---- kaart A: T850 + Z500
  const uw = upperWind(g, f.z500, here.lat, here.lon);
  const feats = zonalPattern(g, f.z500, here);
  const near = feats[0];
  let pattern, phaseTip;
  const kmLon = (dl) => roundTo(Math.abs(dl) * KM * Math.cos(rad(here.lat)), 50);
  const TR = T('trog', 'trog'), RU = T('rug', 'rug');
  if (!near) {
    pattern = `De stroming boven West-Europa is vlak en loopt vrijwel recht van west naar oost (zonale stroming)`;
    phaseTip = 'Bij een vlakke westenstroming komt zachte oceaanlucht binnen en blijft het wisselvallig; kou krijgt weinig kans.';
  } else if (near.kind === 'trog') {
    if (Math.abs(near.dl) <= 3) {
      pattern = `${name} ligt vrijwel onder een ${TR} (een U-vormige uitbuiging van de hoogtelijnen naar het zuiden)`;
      phaseTip = 'Onder een trog is de lucht onstabiel: buien, wisselende bewolking en een wisselende wind.';
    } else if (near.dl < 0) {
      pattern = `Een ${TR} (een U-vormige uitbuiging van de hoogtelijnen naar het zuiden) ligt ca. ${kmLon(near.dl)} km ten westen van ${name}`;
      phaseTip = 'Vóór een trog stroomt warmere lucht omhoog: de bewolking neemt toe en er komt regen aan.';
    } else {
      pattern = `Een ${TR} (een U-vormige uitbuiging van de hoogtelijnen naar het zuiden) ligt ca. ${kmLon(near.dl)} km ten oosten van ${name}`;
      phaseTip = 'Achter een trog zakt koudere lucht zuidwaarts: buien, opklaringen en een frisse noordwestelijke wind.';
    }
  } else if (Math.abs(near.dl) <= 4) {
    pattern = `${name} ligt onder of vlak bij een ${RU} (een bult in de hoogtelijnen naar het noorden)`;
    phaseTip = `Onder een rug daalt de lucht (subsidentie): rustig en droog weer, met bij opklaringen ${T('uitstraling', 'nachtvorst')} of mist, en laagbewolking onder een ${T('inversie', 'inversie')}.`;
  } else {
    pattern = `Een ${RU} (een bult in de hoogtelijnen naar het noorden) ligt ca. ${kmLon(near.dl)} km ten ${near.dl < 0 ? 'westen' : 'oosten'} van ${name}`;
    phaseTip = near.dl < 0
      ? 'Met een rug in het westen stroomt koelere lucht uit het noorden naar je toe: frisser, met opklaringen en weinig neerslag.'
      : 'Met een rug in het oosten stroomt zachte lucht uit het zuidwesten naar je toe: zacht en meestal droog.';
  }
  let tmin = Infinity, tmp = null;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = f.t850[j * g.nx + i]; if (!onGreenland(g.lat0 - j * g.d, g.lon0 + i * g.d) && v < tmin) { tmin = v; tmp = { lat: g.lat0 - j * g.d, lon: g.lon0 + i * g.d }; } }
  const coldPlace = placeName(tmp.lat, tmp.lon);
  const coldBit = Math.abs(tmin - t) < 2 ? '' : ` De koudste lucht in beeld (${fmt(tmin)}°C) ligt ${coldPlace ? 'bij ' + coldPlace : `ca. ${roundTo(distKm(here, tmp), 100)} km ten ${dirName(bearing(here, tmp))}en van ${name}`}.`;
  const up = moveKm(here, uw.from, 600);
  const tUp = inGrid(g, up.lat, up.lon) ? sample(g, f.t850, up.lat, up.lon) : NaN;
  let adv = '';
  if (!Number.isNaN(tUp)) {
    const d = tUp - t;
    adv = Math.abs(d) < 1.5
      ? ` Stroomopwaarts (600 km ${dirName(uw.from)}) is het even koud (${fmt(tUp)}°C): de ${T('advectie', 'advectie')} verandert de luchtmassa weinig.`
      : ` Stroomopwaarts (600 km ${dirName(uw.from)}) is het ${fmt(tUp)}°C: ${d < 0 ? 'koudeadvectie' : 'warmteadvectie'}, de luchtmassa wordt dus ${d < 0 ? 'kouder' : 'zachter'} (zie ${T('advectie', 'advectie')}).`;
  }
  const jetBit = uw.ms >= 30 ? ` (een stevige ${T('straalstroom', 'straalstroom')})` : '';
  // 2 m-temperatuur van het model zelf (momentopname)
  let local = '';
  if (!Number.isNaN(pt.t2)) {
    const ref = daySnap ? `normaal dagmaximum ${fmt(nrm.tx, 1)}°C` : `normaal dagminimum ${fmt(nrm.tn, 1)}°C`;
    const dev = daySnap ? pt.t2 - nrm.tx : null;
    const devTxt = dev == null ? '' : Math.abs(dev) < 1.5 ? ', ongeveer normaal' : dev > 0 ? `, ${fmt(Math.abs(dev))}° boven normaal` : `, ${fmt(Math.abs(dev))}° onder normaal`;
    local = `Het model geeft voor ${name} om ${clock} ${fmt(pt.t2, 1)}°C op 2 m (${T('t2m', 'momentopname')}; ${ref}${devTxt}; ${T('anomalie', 'anomalie')} van T850 ${sgn(anom, 0)}°).`;
  }
  let frost = '';
  if (pt.t2 <= 0 || t <= -4) frost = pt.t2 <= -5 ? ' Dit is echte vorst.' : ` Bij opklaringen en weinig wind kan het vriezen (${T('uitstraling', 'uitstraling')}).`;
  if (t <= -4) frost += ` Bij neerslag is sneeuw een serieuze optie (${T('sneeuwgrens', 'sneeuwgrens')}).`;
  const A = [
    `${pattern}. Op ca. 1,5 km hoogte (${T('t850', 'T850')}) is het boven ${name} ${fmt(t)}°C (${anomT850Text(anom)}).${coldBit}`,
    `De zwarte lijnen zijn de hoogte van 500 hPa (${T('z500', 'Z500')}, in dam) en werken als stroomlijnen: de lucht stroomt er langs, met lage hoogte links. De kleur is de luchtmassa (T850), de paarse stippellijn is 0°C. Boven ${name} waait het uit ${dirName(uw.from)} met ca. ${roundTo(uw.ms * 3.6, 5)} km/u${jetBit}. ${phaseTip}${adv}`,
    `${local}${frost} Het dagmaximum en dagminimum volgen uit de uurwaarden en pluimen; een kaart is een momentopname.`,
    [plumeLine(modelKey, valid, pt, ctx), deltaLine(data, lead, loc, pt, 'A'), horizonText(lead)].filter(Boolean).join(' '),
  ];

  // ---- kaart B: MSLP + neerslag
  const w = surfaceWind(g, f.msl, here.lat, here.lon);
  const hasWind = !Number.isNaN(pt.ms);
  const ms = hasWind ? pt.ms : w.ms, from = hasWind ? pt.from : w.from;
  const bft = beaufort(ms);
  const lows = extrema(g, f.msl, 'min', here, { limit: 1008 });
  const highs = extrema(g, f.msl, 'max', here, { limit: 1022 });
  const where = (e) => {
    const pl = placeName(e.lat, e.lon);
    return `ca. ${roundTo(e.km, 50)} km ten ${dirName(bearing(here, e))}en van ${name}${pl ? ` (bij ${pl})` : ''}`;
  };
  const sys = [];
  if (lows[0]) sys.push(lows[0].km < 250 ? `Er ligt een lagedrukgebied (L) van ${fmt(lows[0].v)} hPa vlak bij ${name}` : `Het dichtstbijzijnde lagedrukgebied (L) is ${fmt(lows[0].v)} hPa en ligt ${where(lows[0])}`);
  if (highs[0]) sys.push(highs[0].km < 250 ? `er ligt een hogedrukgebied (H) van ${fmt(highs[0].v)} hPa vlak bij ${name}` : `het dichtstbijzijnde hogedrukgebied (H) is ${fmt(highs[0].v)} hPa en ligt ${where(highs[0])}`);
  const sysTxt = sys.length ? `${sys.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : 'Er is geen uitgesproken lage of hoge druk in de buurt: een vlak drukveld met weinig wind.';
  const fringe = lows[0] && lows[0].km >= 600 && lows[0].v < 995 ? ` Die diepe depressie ligt ver weg, maar de ${T('uitlopers', 'uitlopers')} (fronten en regenbanden) kunnen ${name} wel bereiken.` : '';
  const gr = w.hpa100;
  const spacing = gr < 1 ? 'ver uit elkaar (weinig wind)' : gr < 2.5 ? 'matig dicht op elkaar' : gr < 4.5 ? 'dicht op elkaar (stevige wind)' : 'zeer dicht op elkaar (storm)';
  const pHere = pt.pr;
  let pMax = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = sample(g, f.pr6, here.lat + dj, here.lon + di); if (v > pMax) pMax = v; }
  const snow = (Number.isNaN(pt.t2) ? t <= -4 : t <= -3 && pt.t2 <= 2);
  const mixy = !snow && (Number.isNaN(pt.t2) ? t <= -1 : t <= 0 && pt.t2 <= 3);
  const kind = snow ? 'sneeuw' : mixy ? 'regen of natte sneeuw' : 'regen';
  let rain;
  if (pMax < 0.5) rain = 'Het is droog in de 6 uur voor dit moment.';
  else if (pHere < 0.2) rain = `Op ${name} zelf blijft het grotendeels droog; in de omgeving valt tot ${fmt(pMax, 1)} mm (${kind}).`;
  else {
    const strength = pHere < 1 ? 'licht' : pHere < 4 ? 'matig' : pHere < 10 ? 'flink' : 'zwaar';
    rain = `In de 6 uur voor dit moment valt ca. ${fmt(pHere, 1)} mm (${strength}, ${kind}; ${T('neerslag6', 'gemiddelde over ca. 100 km')}).`;
  }
  const storm = bft >= 8 ? ' Stormachtig: houd rekening met zware windstoten.' : bft >= 6 ? ' Houd rekening met vlagen.' : '';
  const geoKmh = roundTo(w.geo * 3.6, 5);
  const B = [
    `${sysTxt}${fringe} Boven ${name} staat ${fmt(pt.p)} hPa (${T('mslp', 'luchtdruk op zeeniveau')}).`,
    `${T('isobaren', 'Isobaren')} zijn lijnen van gelijke luchtdruk (om de 4 hPa): hoe dichter op elkaar, hoe groter het ${T('drukgradient', 'drukgradiënt')} en hoe harder de wind. Rond ${name} liggen ze ${spacing}: ca. ${fmt(gr, 1)} hPa per 100 km, goed voor ca. ${geoKmh} km/u ${T('geostrofisch', 'geostrofische wind')} op ca. 1 km hoogte. Door ${T('wrijving', 'wrijving')} is dat aan de grond minder. ${T('buysballot', 'Buys Ballot')}: met de wind in de rug ligt de lage druk links. De kleur is de neerslag over de 6 uur ervoor (paars: sneeuw).`,
    `${name}: ${hasWind ? 'het model geeft op 10 m' : 'wind'} uit ${dirName(from)}, ${T('beaufort', 'windkracht')} ca. ${bft} (${roundTo(ms * 3.6, 5)} km/u gemiddeld; vlagen niet in de kaart).${storm} ${rain}`,
    [deltaLine(data, lead, loc, pt, 'B'), horizonText(lead)].filter(Boolean).join(' '),
  ];
  return { A, B, valid, facts: { t850: t, t2: pt.t2, anom, msl: pt.p, bft, windFrom: from, pr6: pHere } };
}

// ---------------------------------------------------------------- uitleg bij verschilkaarten
function maxDiff(g, a, b, box) {
  let best = 0, at = null;
  for (let j = 0; j < g.ny; j++) {
    const lat = g.lat0 - j * g.d;
    if (lat < box[0] || lat > box[1]) continue;
    for (let i = 0; i < g.nx; i++) {
      const lon = g.lon0 + i * g.d;
      if (lon < box[2] || lon > box[3] || onGreenland(lat, lon)) continue;
      const d = a[j * g.nx + i] - b[j * g.nx + i];
      if (Math.abs(d) > Math.abs(best)) { best = d; at = { lat, lon }; }
    }
  }
  return { d: best, at };
}
export function analyzeDiff(dA, dB, lead, loc, labels, kind = 'models') {
  const g = dA.grid, fA = dA.F[lead], fB = dB.F ? dB.F[lead] : dB;
  const [la, lb] = labels;
  const name = loc.name || 'je locatie';
  if (!inGrid(g, loc.lat, loc.lon)) { const m = `${name} ligt buiten het kaartgebied.`; return { A: [m, '', '', ''], B: [m, '', '', ''] }; }
  const valid = new Date(dA.run.getTime() + lead * 3600e3);
  const pa = pointFacts(dA, fA, loc), pb = pointFacts(dA, fB, loc);
  const box = [45, 62, -12, 20];
  const mdT = maxDiff(g, fA.t850, fB.t850, box), mdP = maxDiff(g, fA.msl, fB.msl, box);
  const placeT = mdT.at ? placeName(mdT.at.lat, mdT.at.lon) : null, placeP = mdP.at ? placeName(mdP.at.lat, mdP.at.lon) : null;
  const dT = pa.t850 - pb.t850, dZ = (pa.z - pb.z) / 10, dP = pa.p - pb.p, dT2 = pa.t2 - pb.t2;
  const agree = Math.abs(dT) < 1.5 && Math.abs(dZ) < 3;
  const word = kind === 'prev' ? 'run' : 'model';
  const verdict = agree
    ? `De ${word === 'run' ? 'runs' : 'modellen'} zijn het hier eens: het scenario is robuust.`
    : `De ${word === 'run' ? 'runs' : 'modellen'} verschillen merkbaar: het scenario is onzeker, dus kijk ook naar de ${T('ensemble', 'pluim')}.`;
  const dirTxt = (d, warm, cold) => (Math.abs(d) < 0.8 ? 'vrijwel gelijk' : d > 0 ? warm : cold);
  const A = [
    `${la} min ${lb} voor T850 boven ${name}: ${sgn(dT)}° (${dirTxt(dT, `${la} is warmer`, `${la} is kouder`)}). Het grootste verschil in West-Europa is ${sgn(mdT.d)}° ${placeT ? 'bij ' + placeT : mdT.at ? `op ${fmt(mdT.at.lat)}°N, ${fmt(mdT.at.lon)}°` : ''}.`,
    `Dit is een ${T('verschilkaart', 'verschilkaart')}: de kleur toont ${la} min ${lb} (rood: ${la} is warmer, blauw: kouder). Doorgetrokken lijnen zijn de hoogte van 500 hPa (${T('z500', 'Z500')}) volgens ${la}, gestippelde volgens ${lb}. Boven ${name} is de hoogte ${sgn(dZ, 0)} dam anders: ${Math.abs(dZ) < 3 ? 'de golfpatronen liggen vrijwel over elkaar' : 'de troggen en ruggen zijn verschoven'}.`,
    Number.isNaN(dT2) ? '' : `Op 2 m geeft ${la} ${fmt(pa.t2, 1)}°C en ${lb} ${fmt(pb.t2, 1)}°C om ${clockOf(valid)} voor ${name} (verschil ${sgn(dT2)}°). ${Math.abs(dT2) <= 2 ? 'Een verschil van 1 à 2° is normaal tussen modellen.' : 'Dit is een groot verschil voor één plek: de pluim laat zien welke kant waarschijnlijker is.'} Het zegt niet dat één van beide fout zit.`,
    `${verdict} ${horizonText(lead, false)}`,
  ];
  const B = [
    `${la} min ${lb} voor de luchtdruk boven ${name}: ${sgn(dP)} hPa (${fmt(pa.p)} tegen ${fmt(pb.p)} hPa). Het grootste verschil in West-Europa is ${sgn(mdP.d)} hPa${placeP ? ' bij ' + placeP : ''}.`,
    `Kleur: verschil in ${T('mslp', 'luchtdruk')} (rood: ${la} heeft hogere druk, blauw: lagere). Doorgetrokken ${T('isobaren', 'isobaren')} zijn van ${la}, gestippeld van ${lb}. Een lagedrukgebied dat in één model ${dirTxt(dP, 'dieper', 'minder diep')} of verschoven is, geeft aan de rand van de verschuiving grote drukverschillen.`,
    `Wind op 10 m bij ${name}: ${la} uit ${Number.isNaN(pa.from) ? '?' : dirName(pa.from)} (${roundTo(pa.ms * 3.6, 5)} km/u), ${lb} uit ${Number.isNaN(pb.from) ? '?' : dirName(pb.from)} (${roundTo(pb.ms * 3.6, 5)} km/u). Neerslag over 6 uur: ${la} ${fmt(pa.pr, 1)} mm, ${lb} ${fmt(pb.pr, 1)} mm.`,
    `${Math.abs(dP) < 4 ? 'Drukpatronen komen goed overeen.' : 'Drukpatronen wijken af: het weerbeeld (wind en neerslag) is onzeker.'} ${horizonText(lead, false)}`,
  ];
  return { A, B, valid };
}

// ---------------------------------------------------------------- tekenen
const T850_STOPS = [[-30, '#27144f'], [-20, '#4b2a9a'], [-12, '#3a64d8'], [-6, '#5aa9f0'], [-2, '#bfe3fb'], [0, '#f2f7fa'], [2, '#fff0b8'], [6, '#ffd27a'], [10, '#ffa957'], [14, '#f2763d'], [20, '#cf3b2e'], [26, '#8f1d2b']];
const RAIN = [[0.2, '#d5f0c9'], [0.5, '#a7e0a0'], [1, '#6fcf7a'], [2, '#3fb58a'], [4, '#2a8fc0'], [8, '#2d5fd0'], [15, '#6a3fc7'], [30, '#a237b8']];
const SNOW = [[0.2, '#efe3fb'], [0.5, '#e1c6f5'], [1, '#cf9fee'], [2, '#b877e0'], [4, '#9b4fd0'], [8, '#7a2fb5']];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(stops, v) {
  if (v <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
      const a = hex(c0), b = hex(c1), f = (v - v0) / (v1 - v0);
      return a.map((x, k) => Math.round(x + (b[k] - x) * f));
    }
  }
  return hex(stops[stops.length - 1][1]);
}
function stepColor(stops, v) { // kleur per klasse
  let c = null;
  for (const [t, col] of stops) if (v >= t) c = col;
  return c ? hex(c) : null;
}
// verschilkaarten: diverging, per klasse; de middelste klasse (|v| < halve stap) is neutraal
const DIFF_STOPS = [[-1, '#1b46a0'], [-0.6, '#4f86d6'], [-0.25, '#a9cbef'], [-0.08, '#e3eef9'], [0.08, '#fbe6df'], [0.25, '#f3b09b'], [0.6, '#dd6347'], [1, '#a5162b']];
const DIFF_SCALE = { A: { step: 1, n: 8, unit: '°C', ticks: [-8, -4, 0, 4, 8] }, B: { step: 2, n: 8, unit: 'hPa', ticks: [-16, -8, 0, 8, 16] } };
const DIFF_LUT = Array.from({ length: 17 }, (_, i) => (i === 8 ? [236, 240, 243] : ramp(DIFF_STOPS, (i - 8) / 8)));
const T850_LUT = Array.from({ length: 41 }, (_, i) => ramp(T850_STOPS, -30 + i * 2 + 1)); // banden van 2 graden

const CITIES = [
  ['Londen', 51.5, -0.1], ['Parijs', 48.9, 2.35], ['Berlijn', 52.5, 13.4], ['Oslo', 59.9, 10.7], ['Stockholm', 59.3, 18.1],
  ['Reykjavik', 64.1, -21.9], ['Dublin', 53.3, -6.3], ['Madrid', 40.4, -3.7], ['Rome', 41.9, 12.5], ['Lissabon', 38.7, -9.1],
  ['Kopenhagen', 55.7, 12.6], ['Warschau', 52.2, 21], ['Wenen', 48.2, 16.4],
];

function contourChains(up, level) {
  const { nx, ny, data } = up;
  const adj = new Map(), pos = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  const seg = (a, b) => { link(a[0], b[0]); link(b[0], a[0]); pos.set(a[0], a[1]); pos.set(b[0], b[1]); };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const vtl = data[j * nx + i], vtr = data[j * nx + i + 1], vbl = data[(j + 1) * nx + i], vbr = data[(j + 1) * nx + i + 1];
      const idx = (vtl >= level ? 1 : 0) | (vtr >= level ? 2 : 0) | (vbr >= level ? 4 : 0) | (vbl >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => [`h${i},${j}`, [i + (level - vtl) / (vtr - vtl), j]];
      const R = () => [`v${i + 1},${j}`, [i + 1, j + (level - vtr) / (vbr - vtr)]];
      const B = () => [`h${i},${j + 1}`, [i + (level - vbl) / (vbr - vbl), j + 1]];
      const L = () => [`v${i},${j}`, [i, j + (level - vtl) / (vbl - vtl)]];
      switch (idx) {
        case 1: case 14: seg(L(), T()); break;
        case 2: case 13: seg(T(), R()); break;
        case 3: case 12: seg(L(), R()); break;
        case 4: case 11: seg(R(), B()); break;
        case 6: case 9: seg(T(), B()); break;
        case 7: case 8: seg(L(), B()); break;
        case 5: if ((vtl + vtr + vbl + vbr) / 4 >= level) { seg(T(), R()); seg(L(), B()); } else { seg(L(), T()); seg(R(), B()); } break;
        case 10: if ((vtl + vtr + vbl + vbr) / 4 >= level) { seg(L(), T()); seg(R(), B()); } else { seg(T(), R()); seg(L(), B()); } break;
        default: break;
      }
    }
  }
  const used = new Set(), chains = [];
  const walk = (start) => {
    const pts = []; let prev = null, cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur); pts.push(pos.get(cur));
      const nb = adj.get(cur).filter((n) => n !== prev && !used.has(n));
      prev = cur; cur = nb[0];
    }
    return pts;
  };
  for (const [id, nb] of adj) if (nb.length === 1 && !used.has(id)) { const c = walk(id); if (c.length > 1) chains.push(c); }
  for (const [id] of adj) if (!used.has(id)) { const c = walk(id); if (c.length > 2) { c.push(c[0]); chains.push(c); } }
  return chains;
}

export const MAP_ASPECT = (g) => ((g.ny - 1) * g.d) / (((g.nx - 1) * g.d) * Math.cos(rad(52)));
const LEGEND_H = 46;

export function drawMap(canvas, data, lead, type, opts = {}) {
  const { coast = null, loc = null } = opts;
  const g = data.grid, f = data.F[lead];
  const ref = opts.ref || null, isDiff = !!ref;
  const W = opts.width || canvas.clientWidth || 640;
  const Hm = Math.round(W * MAP_ASPECT(g));
  const H = Hm + LEGEND_H;
  const dpr = Math.min(opts.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  if (canvas.style) { canvas.style.aspectRatio = `${W} / ${H}`; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lonSpan = (g.nx - 1) * g.d, latSpan = (g.ny - 1) * g.d;
  const px = (lon) => ((lon - g.lon0) / lonSpan) * W;
  const py = (lat) => ((g.lat0 - lat) / latSpan) * Hm;
  const K = 4;
  const isA = type === 'A';
  const dsc = DIFF_SCALE[type];
  let fillArr = isA ? f.t850 : f.pr6;
  if (isDiff) { const a = isA ? f.t850 : f.msl, b = isA ? ref.t850 : ref.msl; fillArr = Float32Array.from(a, (v, i) => v - b[i]); }
  const upMain = upsample(g, fillArr, K, !isA && !isDiff);

  // --- vlakken
  const wd = canvas.width, hd = Math.round(Hm * dpr);
  const img = ctx.createImageData(wd, hd);
  const px32 = img.data;
  const sx = ((upMain.nx - 1) / wd), sy = ((upMain.ny - 1) / hd);
  const t0 = f.t850, t2 = f.t2m, gx = g.nx;
  for (let y = 0; y < hd; y++) {
    const fy = Math.min(y * sy, upMain.ny - 1.001), j0 = Math.floor(fy), ty = fy - j0;
    for (let x = 0; x < wd; x++) {
      const fx = Math.min(x * sx, upMain.nx - 1.001), i0 = Math.floor(fx), tx = fx - i0;
      const a = upMain.data[j0 * upMain.nx + i0], b = upMain.data[j0 * upMain.nx + i0 + 1];
      const c = upMain.data[(j0 + 1) * upMain.nx + i0], d = upMain.data[(j0 + 1) * upMain.nx + i0 + 1];
      const v = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
      let col;
      if (isDiff) {
        col = DIFF_LUT[Math.max(0, Math.min(16, Math.round(v / dsc.step) + 8))];
      } else if (isA) {
        col = T850_LUT[Math.max(0, Math.min(40, Math.floor((v + 30) / 2)))];
      } else {
        col = null;
        if (v >= 0.2) {
          const gx0 = fx / K, gy0 = fy / K, ci = Math.min(Math.floor(gx0), gx - 2), cj = Math.min(Math.floor(gy0), g.ny - 2);
          const ux = gx0 - ci, uy = gy0 - cj;
          const bl = (arr) => arr[cj * gx + ci] * (1 - ux) * (1 - uy) + arr[cj * gx + ci + 1] * ux * (1 - uy) + arr[(cj + 1) * gx + ci] * (1 - ux) * uy + arr[(cj + 1) * gx + ci + 1] * ux * uy;
          const tt = bl(t0);
          const snow = t2 ? tt <= -3 && bl(t2) <= 2 : tt <= -4; // sneeuw: koud op 850 hPa en bijna vorst aan de grond
          col = stepColor(snow ? SNOW : RAIN, v);
        }
        if (!col) col = [223, 231, 236];
      }
      const o = (y * wd + x) * 4;
      px32[o] = col[0]; px32[o + 1] = col[1]; px32[o + 2] = col[2]; px32[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // --- graticule
  ctx.save();
  ctx.strokeStyle = 'rgba(20,30,40,0.16)'; ctx.lineWidth = 0.6;
  for (let lo = Math.ceil(g.lon0 / 10) * 10; lo <= g.lon0 + lonSpan; lo += 10) { ctx.beginPath(); ctx.moveTo(px(lo), 0); ctx.lineTo(px(lo), Hm); ctx.stroke(); }
  for (let la = Math.ceil((g.lat0 - latSpan) / 10) * 10; la <= g.lat0; la += 10) { ctx.beginPath(); ctx.moveTo(0, py(la)); ctx.lineTo(W, py(la)); ctx.stroke(); }
  ctx.restore();

  // --- landgrenzen en kust
  if (coast) {
    const stroke = (lines, style, lw) => {
      ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineJoin = 'round';
      for (const l of lines) { ctx.beginPath(); for (let i = 0; i < l.length; i += 2) { const X = px(l[i]), Y = py(l[i + 1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); }
    };
    stroke(coast.borders, 'rgba(25,35,45,0.30)', 0.6);
    stroke(coast.coast, 'rgba(15,22,30,0.85)', 1.1);
  }

  // --- lijnen
  const labels = [];
  const toPx = (up, pt) => [pt[0] * (W / ((up.nx - 1))), pt[1] * (Hm / ((up.ny - 1)))];
  const drawLines = (arr, levels, o) => {
    const up = upsample(g, arr, K, false);
    for (const lv of levels) {
      const major = o.major(lv);
      for (const ch of contourChains(up, lv)) {
        const pts = ch.map((p) => toPx(up, p));
        ctx.save();
        ctx.beginPath(); pts.forEach(([X, Y], i) => (i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y)));
        ctx.strokeStyle = o.color(lv); ctx.lineWidth = major ? o.wMajor : o.w; ctx.lineJoin = 'round';
        if (o.dash && o.dash(lv)) ctx.setLineDash(o.dash(lv));
        ctx.stroke(); ctx.restore();
        if (o.label && o.label(lv)) placeLabels(ctx, pts, o.text(lv), labels, W, Hm, o.fontColor || '#111');
      }
    }
  };
  if (isDiff) {
    const zl = [], pl = [];
    for (let v = 4800; v <= 6000; v += 60) zl.push(v);
    for (let v = 940; v <= 1064; v += 4) pl.push(v);
    const lv = isA ? zl : pl, key = isA ? 'z500' : 'msl';
    drawLines(ref[key], lv, { major: (v) => (isA ? v % 300 === 0 : v % 20 === 0), w: 1.1, wMajor: 1.6, dash: () => [5, 4], color: () => 'rgba(20,20,20,0.7)', label: () => false });
    drawLines(f[key], lv, { major: (v) => (isA ? v % 300 === 0 : v % 20 === 0), w: 1.2, wMajor: 2, color: () => 'rgba(8,10,14,0.95)', label: () => true, text: (v) => String(isA ? v / 10 : v) });
  } else if (isA) {
    const zl = []; for (let v = 4800; v <= 6000; v += 60) zl.push(v);
    drawLines(f.z500, zl, { major: (v) => v % 300 === 0, w: 1, wMajor: 1.9, color: () => 'rgba(10,12,16,0.82)', label: () => true, text: (v) => String(v / 10) });
    drawLines(f.t850, [0], { major: () => true, w: 1.6, wMajor: 1.6, dash: () => [6, 4], color: () => '#a3157a', label: () => true, text: () => '0°', fontColor: '#a3157a' });
  } else {
    const lowsM = extrema(g, f.msl, 'min', null, { limit: 1010, r: 8 }).slice(0, 12);
    const highsM = extrema(g, f.msl, 'max', null, { limit: 1020, r: 8 }).slice(0, 12);
    for (const e of [...lowsM, ...highsM]) labels.push([px(e.lon), py(e.lat)]); // isobaarlabels ontwijken H en L
    const pl = []; for (let v = 940; v <= 1064; v += 4) pl.push(v);
    drawLines(f.msl, pl, { major: (v) => v % 20 === 0, w: 0.9, wMajor: 1.7, color: () => 'rgba(18,34,58,0.85)', label: () => true, text: (v) => String(v) });
    const mark = (list, ch, color) => {
      for (const e of list) {
        const X = px(e.lon), Y = py(e.lat);
        if (X < 14 || X > W - 14 || Y < 18 || Y > Hm - 18) continue;
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = "700 22px 'Atkinson Hyperlegible', system-ui, sans-serif";
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(ch, X, Y - 4); ctx.fillStyle = color; ctx.fillText(ch, X, Y - 4);
        ctx.font = "600 11px 'Atkinson Hyperlegible', system-ui, sans-serif";
        ctx.lineWidth = 3; ctx.strokeText(String(Math.round(e.v)), X, Y + 13); ctx.fillText(String(Math.round(e.v)), X, Y + 13);
        ctx.restore();
      }
    };
    mark(lowsM, 'L', '#b3202a');
    mark(highsM, 'H', '#1c4fa6');
  }

  // --- steden en locatie
  ctx.save();
  ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.textBaseline = 'middle';
  const here = loc && inGrid(g, loc.lat, loc.lon) ? { X: px(loc.lon), Y: py(loc.lat) } : null;
  for (const [n, la, lo] of CITIES) {
    const X = px(lo), Y = py(la);
    if (X < 8 || X > W - 8 || Y < 8 || Y > Hm - 8) continue;
    if (here && Math.hypot(here.X - X, here.Y - Y) < 46) continue;
    ctx.fillStyle = 'rgba(20,28,36,0.8)'; ctx.beginPath(); ctx.arc(X, Y, 2, 0, 7); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.strokeText(n, X + 5, Y); ctx.fillStyle = 'rgba(20,28,36,0.85)'; ctx.fillText(n, X + 5, Y);
  }
  if (here) {
    ctx.beginPath(); ctx.arc(here.X, here.Y, 7, 0, 7); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(here.X, here.Y, 4.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0d1b2a'; ctx.stroke();
    ctx.font = "700 12px 'Atkinson Hyperlegible', system-ui, sans-serif";
    const nm = loc.name || 'Ommen', left = here.X > W - 90;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(nm, here.X + (left ? -9 : 9), here.Y - 9);
    ctx.fillStyle = '#0d1b2a'; ctx.fillText(nm, here.X + (left ? -9 : 9), here.Y - 9);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(15,22,30,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, Hm - 1);

  // --- legenda
  ctx.fillStyle = '#16222c'; ctx.fillRect(0, Hm, W, LEGEND_H);
  ctx.textBaseline = 'middle';
  const lx = 10, bw = Math.min(W * 0.55, 300), by = Hm + 10, bh = 12;
  ctx.fillStyle = '#c9d4db'; ctx.font = "600 11px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.textAlign = 'left';
  if (isDiff) {
    const [la, lb] = opts.labels || ['A', 'B'];
    const n = 17, lo = -dsc.n * dsc.step, hi = dsc.n * dsc.step;
    for (let i = 0; i < n; i++) { ctx.fillStyle = `rgb(${DIFF_LUT[i]})`; ctx.fillRect(lx + (i * bw) / n, by, bw / n + 0.5, bh); }
    ctx.fillStyle = '#c9d4db'; ctx.textAlign = 'center'; ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif";
    for (const v of dsc.ticks) ctx.fillText(String(v).replace('-', '−'), lx + ((v - lo) / (hi - lo)) * bw, by + bh + 9);
    ctx.textAlign = 'left'; ctx.font = "600 11px 'Atkinson Hyperlegible', system-ui, sans-serif";
    ctx.fillText(`Verschil ${isA ? 'T850' : 'luchtdruk'} (${dsc.unit}): ${la} min ${lb}`, lx + bw + 12, by + 5);
    ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.fillStyle = '#9fb0bb';
    ctx.fillText(`lijnen: doorgetrokken ${la}, gestippeld ${lb}`, lx + bw + 12, by + 21);
  } else if (isA) {
    const lo = -24, hi = 24, n = (hi - lo) / 2;
    for (let i = 0; i < n; i++) { const c = T850_LUT[Math.max(0, Math.min(40, Math.floor((lo + i * 2 + 30) / 2)))]; ctx.fillStyle = `rgb(${c})`; ctx.fillRect(lx + (i * bw) / n, by, bw / n + 0.5, bh); }
    ctx.fillStyle = '#c9d4db'; ctx.textAlign = 'center'; ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif";
    for (const v of [-20, -10, 0, 10, 20]) ctx.fillText(String(v), lx + ((v - lo) / (hi - lo)) * bw, by + bh + 9);
    ctx.textAlign = 'left'; ctx.font = "600 11px 'Atkinson Hyperlegible', system-ui, sans-serif";
    ctx.fillText('Temperatuur 850 hPa (°C)', lx + bw + 12, by + 5);
    ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.fillStyle = '#9fb0bb';
    ctx.fillText('lijnen: hoogte 500 hPa (dam)', lx + bw + 12, by + 21);
  } else {
    const items = [...RAIN.slice(0, 6).map(([v, c]) => [v, c]), ...SNOW.slice(0, 4).map(([v, c]) => [v, c, 1])];
    const cw = Math.min(26, (W * 0.62) / items.length);
    items.forEach(([v, c, s], i) => { ctx.fillStyle = c; ctx.fillRect(lx + i * cw, by, cw - 1, bh); ctx.fillStyle = '#c9d4db'; ctx.textAlign = 'center'; ctx.font = "500 9px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.fillText(String(v).replace('.', ','), lx + i * cw + cw / 2, by + bh + 9); });
    ctx.textAlign = 'left'; ctx.font = "600 11px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.fillStyle = '#c9d4db';
    ctx.fillText('mm per 6 u: regen (groen/blauw), sneeuw (paars)', lx + items.length * cw + 8, by + 5);
    ctx.font = "500 10px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.fillStyle = '#9fb0bb';
    ctx.fillText('lijnen: luchtdruk (hPa)', lx + items.length * cw + 8, by + 21);
  }
}

function placeLabels(ctx, pts, text, placed, W, H, color) {
  if (pts.length < 14) return;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 90) return;
  const step = 300;
  for (let s = Math.min(total / 2, 120); s < total - 40; s += step) {
    let k = cum.findIndex((c) => c >= s);
    if (k < 2 || k > pts.length - 3) continue;
    const [X, Y] = pts[k];
    if (X < 22 || X > W - 22 || Y < 14 || Y > H - 14) continue;
    if (placed.some((p) => Math.hypot(p[0] - X, p[1] - Y) < 46)) continue;
    let ang = Math.atan2(pts[k + 2][1] - pts[k - 2][1], pts[k + 2][0] - pts[k - 2][0]);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    placed.push([X, Y]);
    ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
    ctx.font = "700 10.5px 'Atkinson Hyperlegible', system-ui, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- weergave in de app
const TYPES = [
  { id: 'A', title: 'Luchtmassa en stroming', sub: 'Kleur: temperatuur op 850 hPa. Lijnen: hoogte van 500 hPa.' },
  { id: 'B', title: 'Druk en neerslag aan de grond', sub: 'Kleur: neerslag over 6 uur. Lijnen: luchtdruk op zeeniveau.' },
];
const DIFF_TYPES = (la, lb) => [
  { id: 'A', title: `Luchtmassa: ${la} min ${lb}`, sub: `Kleur: verschil in T850. Doorgetrokken: hoogte 500 hPa van ${la}; gestippeld: van ${lb}.` },
  { id: 'B', title: `Druk: ${la} min ${lb}`, sub: `Kleur: verschil in luchtdruk. Doorgetrokken: isobaren van ${la}; gestippeld: van ${lb}.` },
];
const GUIDE = [
  `Zoek eerst de druksystemen op de drukkaart: de L (lage druk) en de H (hoge druk). Rond een L draait de wind linksom, rond een H rechtsom ([[buysballot|Buys Ballot]]). Dichte [[isobaren]] betekenen harde wind.`,
  `Lees dan de stroming op de luchtmassakaart. De lijnen van [[z500|500 hPa]] zijn stroomlijnen: een bocht naar het zuiden is een [[trog]], een bocht naar het noorden een [[rug]], lijnen dicht bij elkaar wijzen op de [[straalstroom]].`,
  `Kijk waar de lucht vandaan komt (tegen de stroming in) en welke kleur ([[t850|T850]]) daar ligt: dat is de luchtmassa die jou over een tijdje bereikt ([[advectie]]).`,
  `Vertaal het naar je plek en controleer: de tekst geeft de 2 m-temperatuur, wind en neerslag van het model zelf. Vergelijk die met de pluimen en uurwaarden, en met de vorige run of een ander model, want één [[deterministisch|deterministische run]] is slechts één scenario.`,
];
const fmtValid = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtRun = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const rich = (s) => linkTerms(esc(s));

// Kaartvelden staan op de tak maps-data (steeds één commit). Lokaal of bij problemen vallen we terug op ./data/maps.
const REMOTE = 'https://raw.githubusercontent.com/eddydekker-coder/winterwacht/maps-data';


// Modelvergelijking op één plek en moment: waar zijn de modellen het eens, waar niet (zoals in de modelbesprekingen op Weerwoord).
const MODEL_NAMES = { aifs: 'AIFS', ec: 'ECMWF', gfs: 'GFS' };
export function compareModels(sets, lead, loc) {
  const rows = [];
  for (const [k, d] of Object.entries(sets)) {
    if (!d || !d.F[lead] || !inGrid(d.grid, loc.lat, loc.lon)) continue;
    const p = pointFacts(d, d.F[lead], loc);
    rows.push({ key: k, name: MODEL_NAMES[k], run: `${String(d.run.getUTCHours()).padStart(2, '0')}Z`, runMs: d.run.getTime(), t850: p.t850, t2: p.t2, p: p.p, kmh: p.ms * 3.6, from: p.from, pr: p.pr });
  }
  if (rows.length < 2) return { rows, verdict: '' };
  const rng = (k) => Math.max(...rows.map((r) => r[k])) - Math.min(...rows.map((r) => r[k]));
  const diff = [];
  if (rng('p') >= 4) diff.push(`de luchtdruk boven ${loc.name || 'je locatie'} (${fmt(rng('p'))} hPa verschil: een verschoven of afwijkend lagedrukgebied)`);
  if (rng('t850') >= 2) diff.push(`de luchtmassa (${fmt(rng('t850'), 1)}° verschil op ${T('t850', 'T850')})`);
  if (rng('t2') >= 3) diff.push(`de temperatuur op 2 m (${fmt(rng('t2'), 1)}° verschil)`);
  if (rng('kmh') >= 15) diff.push(`de windsnelheid (${fmt(rng('kmh'))} km/u verschil)`);
  if (rng('pr') >= 1) diff.push(`de neerslag (${fmt(rng('pr'), 1)} mm verschil)`);
  const sameRun = rows.every((r) => r.runMs === rows[0].runMs);
  const lag = sameRun ? '' : ' Let op: de modellen hebben niet dezelfde run; een deel van het verschil komt daardoor.';
  const verdict = diff.length
    ? `Onzeker: de modellen verschillen over ${diff.join(', ')}. Weeg de ${T('ensemble', 'pluim')} mee en wacht op volgende runs (${T('runvergelijking', 'run-tot-run vergelijking')}).${lag}`
    : `De modellen zijn het hier eens over luchtmassa, druk, wind en neerslag: een robuust beeld.${lag}`;
  return { rows, verdict };
}

export function initMaps(els, getLoc, getRef) {
  const st = { view: 'ec', lead: 24, cmp: false, pair: 'ec-gfs', cache: {}, coast: null, vis: false };
  const MODELS = { aifs: 'AIFS', ec: 'ECMWF (IFS)', gfs: 'GFS' };
  const SHORT = { aifs: 'AIFS', ec: 'EC', gfs: 'GFS' };
  const PAIRS = { 'ec-gfs': ['ec', 'gfs'], 'aifs-ec': ['aifs', 'ec'], 'aifs-gfs': ['aifs', 'gfs'] };

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  async function load(m) {
    if (m in st.cache) return st.cache[m];
    const stamp = Math.floor(Date.now() / 300000);
    let json = null;
    for (const base of [REMOTE, 'data/maps']) {
      try { json = await fetchJSON(`${base}/${m}.json?t=${stamp}`); if (json && json.v === 2) break; json = null; } catch { /* volgende bron */ }
    }
    st.cache[m] = json ? prepare(json) : null;
    return st.cache[m];
  }
  async function loadCoast() {
    if (st.coast) return st.coast;
    try { st.coast = await fetchJSON('lib/coast.json'); } catch { st.coast = null; }
    return st.coast;
  }

  const runLabel = (d) => `${String(d.run.getUTCHours()).padStart(2, '0')}Z ${fmtRun.format(d.run)}`;
  function leadButtons(data) {
    els.leads.innerHTML = data.leads.map((l) => {
      const v = new Date(data.run.getTime() + l * 3600e3);
      const parts = fmtValid.formatToParts(v).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
      return `<button role="radio" aria-checked="${l === st.lead}" data-l="${l}"><span>${esc(parts.weekday)} ${esc(parts.hour)}:${esc(parts.minute)}</span><small>+${l} u</small></button>`;
    }).join('');
  }
  function optButtons() {
    if (st.view === 'diff') {
      els.opts.innerHTML = Object.entries(PAIRS).map(([k, [a, b]]) => `<button data-pair="${k}" aria-pressed="${k === st.pair}">${SHORT[a]} − ${SHORT[b]}</button>`).join('');
    } else {
      els.opts.innerHTML = `<button data-cmp="1" aria-pressed="${st.cmp}">Verschil met vorige run (12 u eerder)</button>`;
    }
  }
  function card(t, an, id, loc, aria) {
    return `
      <article class="mapcard">
        <h2 class="h2">${esc(t.title)}</h2>
        <p class="mapsub">${esc(t.sub)}</p>
        <canvas class="mapcv" id="mapcv${id}" role="img" aria-label="${esc(aria)}"></canvas>
        <ol class="mapread">
          <li><b>Wat zie je</b>${rich(an[0])}</li>
          <li><b>Zo lees je het</b>${rich(an[1])}</li>
          <li><b>Voor ${esc(loc.name || 'je locatie')}</b>${rich(an[2])}</li>
          <li class="chk"><b>Controle en betrouwbaarheid</b>${rich(an[3])}</li>
        </ol>
      </article>`;
  }
  function cmpHtml(c, loc) {
    if (!c.rows.length) return '';
    const f1 = (v) => (Number.isNaN(v) ? '–' : fmt(v, 1));
    const body = c.rows.map((r) => `<tr><th scope="row">${esc(r.name)} <small>${esc(r.run)}</small></th><td>${f1(r.t850)}°</td><td>${f1(r.t2)}°</td><td>${fmt(r.p)}</td><td>${Number.isNaN(r.from) ? '–' : esc(dirName(r.from)) + ' ' + fmt(r.kmh)}</td><td>${f1(r.pr)}</td></tr>`).join('');
    return `<h2 class="h2">Modellen naast elkaar voor ${esc(loc.name || 'je locatie')}</h2>
      ${c.verdict ? `<p class="cmpverdict">${rich(c.verdict)}</p>` : ''}
      <div class="cmpwrap"><table class="cmptab"><thead><tr><th></th><th>T850</th><th>2 m</th><th>hPa</th><th>Wind (km/u)</th><th>mm / 6 u</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function clear(msg) {
    els.cmp.innerHTML = '';
    els.run.textContent = ''; els.leads.innerHTML = ''; els.cards.innerHTML = '';
    els.status.textContent = msg;
  }

  async function render() {
    if (!st.vis) return;
    const view = st.view, my = `${view}|${st.pair}|${st.cmp}`;
    for (const b of els.models.querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.m === view);
    els.status.textContent = '';
    els.guide.innerHTML = `<summary>Kaartlezen in vier stappen</summary><ol>${GUIDE.map((x) => `<li>${rich(x)}</li>`).join('')}</ol>`;
    optButtons();
    const loc = getLoc();
    const coast = await loadCoast();
    const stale = () => my !== `${st.view}|${st.pair}|${st.cmp}`;

    if (view === 'diff') {
      els.cmp.innerHTML = '';
      const [ka, kb] = PAIRS[st.pair];
      const [A, Bd] = await Promise.all([load(ka), load(kb)]);
      if (stale()) return;
      if (!A || !Bd) return clear(`De kaarten van ${!A ? MODELS[ka] : MODELS[kb]} staan nog niet klaar, dus er is nog niets te vergelijken.`);
      if (A.run.getTime() !== Bd.run.getTime()) {
        return clear(`${MODELS[ka]} (${runLabel(A)}) en ${MODELS[kb]} (${runLabel(Bd)}) hebben nog niet dezelfde run. Een eerlijke vergelijking kan pas als beide modellen dezelfde run hebben; dat duurt meestal een paar uur.`);
      }
      const leads = A.leads.filter((l) => Bd.leads.includes(l));
      if (!leads.includes(st.lead)) st.lead = leads[0];
      els.run.innerHTML = `<b>${esc(MODELS[ka])} min ${esc(MODELS[kb])}</b> · run ${esc(runLabel(A))}`;
      leadButtons({ ...A, leads });
      const labels = [SHORT[ka], SHORT[kb]];
      const an = analyzeDiff(A, Bd, st.lead, loc, labels);
      const types = DIFF_TYPES(...labels);
      els.cards.innerHTML = types.map((t) => card(t, an[t.id], t.id, loc, `${t.title}, +${st.lead} uur`)).join('');
      for (const t of types) drawMap(document.getElementById(`mapcv${t.id}`), A, st.lead, t.id, { coast, loc, ref: Bd.F[st.lead], labels });
      return;
    }

    const data = await load(view);
    if (stale()) return;
    if (!data) return clear(`De kaarten van ${MODELS[view]} staan nog niet klaar. Ze verschijnen na de eerstvolgende uurlijkse update zodra de modelrun binnen is.`);
    if (!data.leads.includes(st.lead)) st.lead = data.leads[0];
    els.run.innerHTML = `<b>${esc(data.label)}</b> · run ${esc(runLabel(data))}`;
    leadButtons(data);
    if (st.cmp) {
      els.cmp.innerHTML = '';
      const P = data.P && data.P[st.lead];
      if (!P) { els.cards.innerHTML = ''; els.status.textContent = 'Voor dit moment is de run van 12 uur eerder niet beschikbaar. Kies een ander verwachtingsmoment.'; return; }
      const pd = { ...data, F: { [st.lead]: P } };
      const an = analyzeDiff(data, pd, st.lead, loc, ['nieuwe run', 'vorige run'], 'prev');
      const types = DIFF_TYPES('nieuwe run', 'vorige run');
      els.cards.innerHTML = types.map((t) => card(t, an[t.id], t.id, loc, `${t.title}, +${st.lead} uur`)).join('');
      for (const t of types) drawMap(document.getElementById(`mapcv${t.id}`), data, st.lead, t.id, { coast, loc, ref: P, labels: ['nieuw', 'vorige'] });
      return;
    }
    await Promise.all(['aifs', 'ec', 'gfs'].filter((k) => !(k in st.cache)).map(load));
    if (stale()) return;
    const cmp = compareModels({ aifs: st.cache.aifs, ec: st.cache.ec, gfs: st.cache.gfs }, st.lead, loc);
    els.cmp.innerHTML = cmpHtml(cmp, loc);
    const ctx = { modelKey: view, mapRun: data.run, ref: getRef };
    const an = analyze(data, st.lead, loc, ctx);
    const valid = new Date(data.run.getTime() + st.lead * 3600e3);
    els.cards.innerHTML = TYPES.map((t) => card({ ...t, sub: `${t.sub} Geldig ${fmtValid.format(valid)}.` }, an[t.id], t.id, loc, `${t.title}, ${data.label}, +${st.lead} uur`)).join('');
    for (const t of TYPES) drawMap(document.getElementById(`mapcv${t.id}`), data, st.lead, t.id, { coast, loc });
  }

  // begrippen: klik op een onderstreepte term opent de uitleg
  function openTerm(id) {
    const s = termSheet(id);
    if (!s || !els.sheet) return;
    els.sheet.querySelector('.termTitle').textContent = s.title;
    els.sheet.querySelector('.termBody').innerHTML = s.html;
    if (!els.sheet.open) { try { els.sheet.showModal(); } catch { els.sheet.setAttribute('open', ''); } }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button.term'); if (b) { e.preventDefault(); openTerm(b.dataset.t); } });

  els.models.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.view = b.dataset.m; render(); });
  els.leads.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.lead = Number(b.dataset.l); render(); });
  els.opts.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pair) st.pair = b.dataset.pair; else if (b.dataset.cmp) st.cmp = !st.cmp;
    render();
  });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 250); });

  return {
    show(v) { st.vis = v; if (v) render(); },
    refresh() { st.cache = {}; if (st.vis) render(); },
    relocate() { if (st.vis) render(); },
  };
}
