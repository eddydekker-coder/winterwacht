// Weerkaarten: ECMWF en GFS. Tekent kaarten uit de velden die scripts/maps.py bewaart en
// schrijft per kaart drie regels uitleg, afgeleid uit die velden, voor de gekozen locatie.
//
// Velden (1 graad, noord boven): z500 (gpm), t850 (0,1 C), msl (0,1 hPa), pr6 (0,1 mm over 6 uur).
// Alles hier is rekenwerk en tekenwerk; geen weerdata wordt verzonnen of bijgesteld.

const TZ = 'Europe/Amsterdam';
const KM = 111.2; // km per graad breedte
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- data
export function prepare(json) {
  const F = {};
  for (const lead of json.leads) {
    const f = json.fields[lead];
    F[lead] = {
      z500: Float32Array.from(f.z500),
      t850: Float32Array.from(f.t850, (v) => v / 10),
      msl: Float32Array.from(f.msl, (v) => v / 10),
      pr6: Float32Array.from(f.pr6, (v) => v / 10),
    };
  }
  return { model: json.model, label: json.label, run: new Date(json.run), made: json.made, grid: json.grid, leads: json.leads, F };
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

// ---------------------------------------------------------------- klimatologie en vuistregels
const T850_NORMAL = [-0.5, 0, 1.5, 3.5, 7, 10.5, 13, 13, 10.5, 6.5, 3, 0.5]; // ca. 52N, 6E, midden van de maand
export function t850Normal(date) {
  const m = date.getUTCMonth(), d = date.getUTCDate();
  const a = T850_NORMAL[m], b = T850_NORMAL[(m + 1) % 12];
  const f = Math.max(0, Math.min(1, (d - 15) / 30));
  const prevM = T850_NORMAL[(m + 11) % 12];
  return d >= 15 ? a + (b - a) * f : prevM + (a - prevM) * ((d + 15) / 30);
}
// grofweg: dagmaximum ten opzichte van T850, afhankelijk van het seizoen
function maxRange(t850, date) {
  const m = date.getUTCMonth() + 1;
  const [lo, hi] = [10, 3].includes(m) ? [5, 9] : [11, 2].includes(m) ? [4, 8] : [12, 1].includes(m) ? [3, 7] : [6, 11];
  return [t850 + lo, t850 + hi];
}
const anomText = (a) => (Math.abs(a) < 1.5 ? 'ongeveer normaal voor de tijd van het jaar' : a > 0 ? `${fmt(Math.abs(a))}° zachter dan normaal` : `${fmt(Math.abs(a))}° kouder dan normaal`);

// ---------------------------------------------------------------- uitleg (3 regels per kaart)
export function analyze(data, lead, loc) {
  const g = data.grid, f = data.F[lead];
  const valid = new Date(data.run.getTime() + lead * 3600e3);
  const here = { lat: loc.lat, lon: loc.lon };
  const name = loc.name || 'je locatie';
  if (!inGrid(g, here.lat, here.lon)) {
    const msg = `${name} ligt buiten het kaartgebied (Atlantisch Europa). Kies een plaats in Europa om de uitleg te zien.`;
    return { A: [msg, '', ''], B: [msg, '', ''] };
  }
  const t = sample(g, f.t850, here.lat, here.lon);
  const norm = t850Normal(valid);
  const anom = t - norm;
  const [tx0, tx1] = maxRange(t, valid);
  const longRange = lead >= 120;
  const unsure = longRange ? ' Op 5 dagen of meer vooruit veranderen de details nog; let vooral op het patroon.' : '';

  // ---- kaart A: T850 + Z500
  const uw = upperWind(g, f.z500, here.lat, here.lon);
  const feats = zonalPattern(g, f.z500, here);
  const near = feats[0];
  let pattern, phaseTip;
  const kmLon = (dl) => roundTo(Math.abs(dl) * KM * Math.cos(rad(here.lat)), 50);
  if (!near) {
    pattern = 'De stroming boven West-Europa is vlak en loopt vrijwel recht van west naar oost';
    phaseTip = 'Bij een vlakke westenstroom komt zachte oceaanlucht binnen en blijft het wisselvallig; kou krijgt weinig kans.';
  } else if (near.kind === 'trog') {
    if (Math.abs(near.dl) <= 3) {
      pattern = `${name} ligt vrijwel onder een trog (een U-vormige uitbuiging van de lijnen naar het zuiden)`;
      phaseTip = 'Onder een trog is de lucht onstabiel: buien, wisselende bewolking en een wisselende wind.';
    } else if (near.dl < 0) {
      pattern = `Een trog (een U-vormige uitbuiging van de lijnen naar het zuiden) ligt ca. ${kmLon(near.dl)} km ten westen van ${name}`;
      phaseTip = 'Vóór een trog stroomt warmere lucht omhoog: de bewolking neemt toe en er komt regen aan.';
    } else {
      pattern = `Een trog (een U-vormige uitbuiging van de lijnen naar het zuiden) ligt ca. ${kmLon(near.dl)} km ten oosten van ${name}`;
      phaseTip = 'Achter een trog zakt koudere lucht zuidwaarts: buien, opklaringen en een frisse noordwestelijke wind.';
    }
  } else if (Math.abs(near.dl) <= 4) {
    pattern = `${name} ligt onder of vlak bij een rug (een bult in de lijnen naar het noorden)`;
    phaseTip = 'Onder een rug daalt de lucht: rustig en droog weer, met nachtelijke mist of vorst bij opklaringen.';
  } else {
    pattern = `Een rug (een bult in de lijnen naar het noorden) ligt ca. ${kmLon(near.dl)} km ten ${near.dl < 0 ? 'westen' : 'oosten'} van ${name}`;
    phaseTip = near.dl < 0
      ? 'Met een rug in het westen stroomt koelere lucht uit het noorden naar je toe: frisser, met opklaringen en weinig neerslag.'
      : 'Met een rug in het oosten stroomt zachte lucht uit het zuidwesten naar je toe: zacht en meestal droog.';
  }
  // koudste lucht in beeld
  let tmin = Infinity, tmp = null;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = f.t850[j * g.nx + i]; if (!onGreenland(g.lat0 - j * g.d, g.lon0 + i * g.d) && v < tmin) { tmin = v; tmp = { lat: g.lat0 - j * g.d, lon: g.lon0 + i * g.d }; } }
  const coldPlace = placeName(tmp.lat, tmp.lon);
  const coldBit = Math.abs(tmin - t) < 2 ? '' : ` De koudste lucht in beeld (${fmt(tmin)}°C) ligt ${coldPlace ? 'bij ' + coldPlace : `ca. ${roundTo(distKm(here, tmp), 100)} km ten ${dirName(bearing(here, tmp))}en van ${name}`}.`;
  // luchtmassa stroomopwaarts (600 km tegen de bovenstroming in)
  const up = moveKm(here, uw.from, 600);
  const tUp = inGrid(g, up.lat, up.lon) ? sample(g, f.t850, up.lat, up.lon) : NaN;
  let adv = '';
  if (!Number.isNaN(tUp)) {
    const d = tUp - t;
    adv = Math.abs(d) < 1.5
      ? ` Stroomopwaarts (600 km ${dirName(uw.from)}) is het even koud (${fmt(tUp)}°C), dus de luchtmassa verandert weinig.`
      : ` Stroomopwaarts (600 km ${dirName(uw.from)}) is het ${fmt(tUp)}°C: de luchtmassa wordt dus ${d < 0 ? 'kouder' : 'zachter'}.`;
  }
  let frost = '';
  if (t <= -8) frost = ' Dit is echte winterkou: een ijsdag (max. onder nul) en sneeuw zijn dan reële opties.';
  else if (t <= -4) frost = ' Bij neerslag is sneeuw een serieuze optie, en nachtvorst is waarschijnlijk.';
  else if (t <= 2) frost = ' Bij opklaringen en weinig wind is nachtvorst mogelijk.';
  const jetBit = uw.ms >= 30 ? ' (een stevige straalstroom)' : '';
  const A = [
    `${pattern}. Op ca. 1,5 km hoogte boven ${name} is het ${fmt(t)}°C (${anomText(anom)}).${coldBit}`,
    `Zwarte lijnen zijn de hoogte van 500 hPa (in dam) en werken als stroomlijnen: de lucht stroomt er langs, met lage hoogte links. De kleur is de luchtmassa (blauw koud, rood zacht), de paarse stippellijn is 0°C. Boven ${name} waait het uit ${dirName(uw.from)} met ca. ${roundTo(uw.ms * 3.6, 5)} km/u${jetBit}. ${phaseTip}`,
    `${name}: dagmaximum grofweg ${fmt(tx0)} tot ${fmt(tx1)}°C (vuistregel uit T850).${adv}${frost}${unsure}`,
  ];

  // ---- kaart B: MSLP + neerslag
  const p = sample(g, f.msl, here.lat, here.lon);
  const w = surfaceWind(g, f.msl, here.lat, here.lon);
  const bft = beaufort(w.ms);
  const lows = extrema(g, f.msl, 'min', here, { limit: 1008 });
  const highs = extrema(g, f.msl, 'max', here, { limit: 1022 });
  const where = (e) => {
    const pl = placeName(e.lat, e.lon);
    return `ca. ${roundTo(e.km, 50)} km ten ${dirName(bearing(here, e))}en van ${name}${pl ? ` (bij ${pl})` : ''}`;
  };
  const sys = [];
  if (lows[0]) sys.push(lows[0].km < 250 ? `Er ligt een lagedrukgebied (L) van ${fmt(lows[0].v)} hPa vlak bij ${name}` : `Het dichtstbijzijnde lagedrukgebied (L) is ${fmt(lows[0].v)} hPa en ligt ${where(lows[0])}`);
  if (highs[0]) sys.push(highs[0].km < 250 ? `er ligt een hogedrukgebied (H) van ${fmt(highs[0].v)} hPa vlak bij ${name}` : `het dichtstbijzijnde hogedrukgebied (H) is ${fmt(highs[0].v)} hPa en ligt ${where(highs[0])}`);
  const sysTxt = sys.length ? `${sys.join('; ')}.` : 'Er is geen uitgesproken lage of hoge druk in de buurt: een vlak drukveld met weinig wind.';
  const gr = w.hpa100;
  const spacing = gr < 1 ? 'ver uit elkaar (weinig wind)' : gr < 2.5 ? 'matig dicht op elkaar' : gr < 4.5 ? 'dicht op elkaar (stevige wind)' : 'zeer dicht op elkaar (storm)';
  const pHere = sample(g, f.pr6, here.lat, here.lon);
  let pMax = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = sample(g, f.pr6, here.lat + dj, here.lon + di); if (v > pMax) pMax = v; }
  const cold = t <= -4, mixy = t > -4 && t <= -1;
  const kind = cold ? 'sneeuw' : mixy ? 'regen of natte sneeuw' : 'regen';
  let rain;
  if (pMax < 0.2) rain = 'Het is droog in de 6 uur voor dit moment.';
  else if (pHere < 0.2) rain = `Op ${name} zelf blijft het grotendeels droog; in de omgeving valt tot ${fmt(pMax, 1)} mm (${kind}).`;
  else {
    const strength = pHere < 1 ? 'licht' : pHere < 4 ? 'matig' : pHere < 10 ? 'flink' : 'zwaar';
    rain = `In de 6 uur voor dit moment valt ca. ${fmt(pHere, 1)} mm (${strength}, ${kind}).`;
  }
  const storm = bft >= 8 ? ' Stormachtig: houd rekening met zware windstoten.' : bft >= 6 ? ' Houd rekening met vlagen.' : '';
  const B = [
    `${sysTxt} Boven ${name} staat ${fmt(p)} hPa.`,
    `Isobaren zijn lijnen van gelijke luchtdruk (om de 4 hPa): hoe dichter op elkaar, hoe harder de wind. Rond ${name} liggen ze ${spacing}: ca. ${fmt(gr, 1)} hPa per 100 km. Buys Ballot: met de wind in de rug ligt de lage druk links. De kleur is de neerslag over de 6 uur ervoor (paars: sneeuw).`,
    `${name}: wind uit ${dirName(w.from)}, windkracht ca. ${bft} (${roundTo(w.ms * 3.6, 5)} km/u).${storm} ${rain}${unsure}`,
  ];
  return { A, B, valid, facts: { t850: t, anom, msl: p, bft, windFrom: w.from, pr6: pHere } };
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
  const upMain = upsample(g, isA ? f.t850 : f.pr6, K, !isA);
  const upT = isA ? upMain : upsample(g, f.t850, 1, false);

  // --- vlakken
  const wd = canvas.width, hd = Math.round(Hm * dpr);
  const img = ctx.createImageData(wd, hd);
  const px32 = img.data;
  const sx = ((upMain.nx - 1) / wd), sy = ((upMain.ny - 1) / hd);
  const t0 = f.t850, gx = g.nx;
  for (let y = 0; y < hd; y++) {
    const fy = Math.min(y * sy, upMain.ny - 1.001), j0 = Math.floor(fy), ty = fy - j0;
    for (let x = 0; x < wd; x++) {
      const fx = Math.min(x * sx, upMain.nx - 1.001), i0 = Math.floor(fx), tx = fx - i0;
      const a = upMain.data[j0 * upMain.nx + i0], b = upMain.data[j0 * upMain.nx + i0 + 1];
      const c = upMain.data[(j0 + 1) * upMain.nx + i0], d = upMain.data[(j0 + 1) * upMain.nx + i0 + 1];
      const v = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
      let col;
      if (isA) {
        col = T850_LUT[Math.max(0, Math.min(40, Math.floor((v + 30) / 2)))];
      } else {
        col = null;
        if (v >= 0.2) {
          const gx0 = fx / K, gy0 = fy / K, ci = Math.min(Math.floor(gx0), gx - 2), cj = Math.min(Math.floor(gy0), g.ny - 2);
          const ux = gx0 - ci, uy = gy0 - cj;
          const tt = t0[cj * gx + ci] * (1 - ux) * (1 - uy) + t0[cj * gx + ci + 1] * ux * (1 - uy) + t0[(cj + 1) * gx + ci] * (1 - ux) * uy + t0[(cj + 1) * gx + ci + 1] * ux * uy;
          col = stepColor(tt <= -4 ? SNOW : RAIN, v);
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
  if (isA) {
    const zl = []; for (let v = 4800; v <= 6000; v += 60) zl.push(v);
    drawLines(f.z500, zl, { major: (v) => v % 300 === 0, w: 1, wMajor: 1.9, color: () => 'rgba(10,12,16,0.82)', label: () => true, text: (v) => String(v / 10) });
    drawLines(f.t850, [0], { major: () => true, w: 1.6, wMajor: 1.6, dash: () => [6, 4], color: () => '#a3157a', label: () => true, text: () => '0°', fontColor: '#a3157a' });
  } else {
    const pl = []; for (let v = 940; v <= 1064; v += 4) pl.push(v);
    drawLines(f.msl, pl, { major: (v) => v % 20 === 0, w: 0.9, wMajor: 1.7, color: () => 'rgba(18,34,58,0.85)', label: () => true, text: (v) => String(v) });
    // H en L
    const mark = (list, ch, color) => {
      for (const e of list.slice(0, 12)) {
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
    mark(extrema(g, f.msl, 'min', null, { limit: 1010, r: 8 }), 'L', '#b3202a');
    mark(extrema(g, f.msl, 'max', null, { limit: 1020, r: 8 }), 'H', '#1c4fa6');
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
  if (isA) {
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
const GUIDE = {
  A: ['Begin bij de kleur: dat is de luchtmassa op ca. 1,5 km hoogte. Blauw is koud, rood is zacht. Ligt de paarse 0°-lijn ten zuiden van je, dan zit je in koude lucht.',
    'Lees dan de zwarte lijnen als stroomlijnen. Een bocht naar het zuiden is een trog, een bocht naar het noorden een rug.',
    'Kijk waar de lucht vandaan komt (tegen de stroming in) en welke kleur daar ligt: dat is de luchtmassa die jou over een tijdje bereikt.',
    'Lijnen dicht bij elkaar betekent harde bovenwind (straalstroom).'],
  B: ['Zoek eerst de L (lage druk) en de H (hoge druk). Rond een L draait de wind linksom, rond een H rechtsom.',
    'Kijk dan naar de afstand tussen de isobaren bij jouw locatie: dicht op elkaar is veel wind, ver uit elkaar is rustig.',
    'Buys Ballot: met de wind in de rug ligt de lage druk links van je.',
    'De kleur laat zien waar neerslag viel in de 6 uur ervoor. Paars is sneeuw: dat verschijnt waar de lucht op 850 hPa kouder is dan ongeveer −4°C.'],
};
const fmtValid = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtRun = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function initMaps(els, getLoc) {
  const st = { model: 'ec', lead: 24, cache: {}, coast: null, vis: false };
  const MODELS = { ec: 'ECMWF', gfs: 'GFS' };

  async function load(m) {
    if (st.cache[m]) return st.cache[m];
    try {
      const res = await fetch(`data/maps/${m}.json?t=${Math.floor(Date.now() / 600000)}`);
      if (!res.ok) throw new Error(res.status);
      st.cache[m] = prepare(await res.json());
    } catch { st.cache[m] = null; }
    return st.cache[m];
  }
  async function loadCoast() {
    if (st.coast) return st.coast;
    try { st.coast = await (await fetch('lib/coast.json')).json(); } catch { st.coast = null; }
    return st.coast;
  }

  async function render() {
    if (!st.vis) return;
    const m = st.model;
    for (const b of els.models.querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.m === m);
    els.status.textContent = '';
    const [data, coast] = await Promise.all([load(m), loadCoast()]);
    if (m !== st.model) return;
    if (!data) {
      els.run.textContent = '';
      els.leads.innerHTML = '';
      els.cards.innerHTML = '';
      els.status.textContent = `De kaarten van ${MODELS[m]} staan nog niet klaar. Ze verschijnen na de eerstvolgende uurlijkse update zodra de modelrun binnen is.`;
      return;
    }
    if (!data.leads.includes(st.lead)) st.lead = data.leads[0];
    const runHour = String(data.run.getUTCHours()).padStart(2, '0');
    els.run.innerHTML = `<b>${esc(data.label)}</b> · run ${runHour}Z van ${esc(fmtRun.format(data.run))}`;
    els.leads.innerHTML = data.leads.map((l) => {
      const v = new Date(data.run.getTime() + l * 3600e3);
      const parts = fmtValid.formatToParts(v).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
      return `<button role="radio" aria-checked="${l === st.lead}" data-l="${l}"><span>${esc(parts.weekday)} ${esc(parts.hour)}:${esc(parts.minute)}</span><small>+${l} u</small></button>`;
    }).join('');
    const loc = getLoc();
    const an = analyze(data, st.lead, loc);
    const valid = new Date(data.run.getTime() + st.lead * 3600e3);
    els.cards.innerHTML = TYPES.map((t) => `
      <article class="mapcard">
        <h2 class="h2">${esc(t.title)}</h2>
        <p class="mapsub">${esc(t.sub)} <span>Geldig ${esc(fmtValid.format(valid))}.</span></p>
        <canvas class="mapcv" id="mapcv${t.id}" role="img" aria-label="${esc(t.title)}, ${esc(data.label)}, +${st.lead} uur"></canvas>
        <ol class="mapread">
          <li><b>Wat zie je</b>${esc(an[t.id][0])}</li>
          <li><b>Zo lees je het</b>${esc(an[t.id][1])}</li>
          <li><b>Voor ${esc(loc.name || 'je locatie')}</b>${esc(an[t.id][2])}</li>
        </ol>
        <details class="mapguide"><summary>Kaartlezen in vier stappen</summary><ol>${GUIDE[t.id].map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>
      </article>`).join('');
    for (const t of TYPES) drawMap(document.getElementById(`mapcv${t.id}`), data, st.lead, t.id, { coast, loc });
  }

  els.models.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.model = b.dataset.m; render(); });
  els.leads.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.lead = Number(b.dataset.l); render(); });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 250); });

  return {
    show(v) { st.vis = v; if (v) render(); },
    refresh() { st.cache = {}; if (st.vis) render(); },
    relocate() { if (st.vis) render(); },
  };
}
