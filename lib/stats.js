// Gedeelde rekenlogica voor browser (app) en Node (GitHub Action).
// Geen afhankelijkheden, puur ES-module.

// ---------- Modellen ----------
// Per model meerdere kandidaat-namen: Open-Meteo hernoemt soms; de eerste die werkt wint.
export const ENSEMBLES = [
  { key: 'aifs', label: 'ECMWF AIFS', short: 'AIFS', ids: ['ecmwf_aifs025', 'ecmwf_aifs025_ensemble'], primary: true },
  { key: 'ifs',  label: 'ECMWF IFS ENS', short: 'IFS', ids: ['ecmwf_ifs025', 'ecmwf_ifs025_ensemble'] },
  { key: 'gefs', label: 'NOAA GEFS', short: 'GEFS', ids: ['gfs025', 'gfs_seamless'] },
  { key: 'gem',  label: 'CMC GEM ENS', short: 'GEM', ids: ['gem_global', 'gem_global_ensemble'] },
  { key: 'icon', label: 'DWD ICON-EPS', short: 'ICON', ids: ['icon_seamless_eps', 'icon_seamless', 'icon_global_eps'] },
];

export const DETERMINISTIC = [
  { key: 'knmi', label: 'KNMI HARMONIE', ids: ['knmi_seamless'] },
  { key: 'aifs', label: 'ECMWF AIFS', ids: ['ecmwf_aifs025_single'] },
  { key: 'ifs',  label: 'ECMWF IFS', ids: ['ecmwf_ifs025', 'ecmwf_ifs_025'] },
];

export const HOME = { id: 'ommen', name: 'Ommen', lat: 52.5214, lon: 6.4208 };

// Normaalwaarden (afgerond, ca. 1991-2020, Twenthe/De Bilt) – voor anomalie en sfeer.
export const NORMAL_TX = [5.9, 6.8, 10.3, 14.5, 18.4, 21.0, 23.1, 22.7, 19.1, 14.6, 9.6, 6.6];
export const NORMAL_TN = [0.4, 0.2, 2.0, 4.1, 7.6, 10.5, 12.7, 12.3, 9.8, 6.7, 3.6, 1.2];

// ---------- Hulpjes ----------
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export function pct(arr, p) {
  const v = arr.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
export const monthOf = (date) => Number(date.slice(5, 7));

// Haal leden uit een Open-Meteo ensemble-respons: control (var) + var_member01..NN
export function extractMembers(hourly, name) {
  if (!hourly) return [];
  const out = [];
  if (Array.isArray(hourly[name])) out.push(hourly[name]);
  for (let i = 1; i <= 100; i++) {
    const k = `${name}_member${String(i).padStart(2, '0')}`;
    if (Array.isArray(hourly[k])) out.push(hourly[k]);
  }
  return out;
}

// Groepeer uur-indices per lokale datum; alleen (bijna) volledige dagen.
export function dayIndex(times) {
  const map = new Map();
  times.forEach((t, i) => {
    const d = t.slice(0, 10);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(i);
  });
  return map;
}

function memberDaily(series, idx, fn) {
  const v = idx.map((i) => series[i]).filter((x) => x != null);
  return v.length ? fn(v) : null;
}
const max = (v) => Math.max(...v), min = (v) => Math.min(...v), sum = (v) => v.reduce((s, x) => s + x, 0);

// ---------- Samenvatting van één ensemble-run ----------
// Geeft per datum: gemiddelde + p10/p90 van Tmax/Tmin, T850, kansen op vorst/ijsdag/sneeuw.
export function summarizeEnsemble(resp) {
  const h = resp.hourly;
  const times = h.time;
  const t2 = extractMembers(h, 'temperature_2m');
  const t850 = extractMembers(h, 'temperature_850hPa');
  const snow = extractMembers(h, 'snowfall');
  const prec = extractMembers(h, 'precipitation');
  const days = dayIndex(times);
  const counts = [...days.values()].map((x) => x.length);
  const full = Math.max(...counts);
  const dates = {};
  for (const [d, idxAll] of days) {
    // 'volledige' dag: minstens 75% van de gebruikelijke tijdstappen met data
    const idx = idxAll.filter((i) => t2.some((m) => m[i] != null));
    if (idx.length < full * 0.75) continue;
    const tx = t2.map((m) => memberDaily(m, idx, max)).filter((x) => x != null);
    const tn = t2.map((m) => memberDaily(m, idx, min)).filter((x) => x != null);
    if (tx.length < 3) continue;
    const n = tx.length;
    const rec = {
      tx: r1(mean(tx)), txP10: r1(pct(tx, 0.1)), txP90: r1(pct(tx, 0.9)),
      tn: r1(mean(tn)), tnP10: r1(pct(tn, 0.1)), tnP90: r1(pct(tn, 0.9)),
      pFrost: Math.round((tn.filter((x) => x < 0).length / n) * 100),
      pIce: Math.round((tx.filter((x) => x < 0).length / n) * 100),
      pStrong: Math.round((tn.filter((x) => x < -10).length / n) * 100),
      n,
    };
    if (t850.length) {
      const m850 = t850.map((m) => memberDaily(m, idx, (v) => sum(v) / v.length)).filter((x) => x != null);
      if (m850.length) {
        rec.t850 = r1(mean(m850));
        rec.p850m5 = Math.round((m850.filter((x) => x < -5).length / m850.length) * 100);
        rec.p850m10 = Math.round((m850.filter((x) => x < -10).length / m850.length) * 100);
      }
    }
    // sneeuwkans: liefst snowfall (cm), anders neerslag bij T2m <= 0.5 °C
    let snowDay = null;
    if (snow.length && snow[0].some((x) => x != null)) {
      snowDay = snow.map((m) => memberDaily(m, idx, sum));
    } else if (prec.length && prec.length === t2.length) {
      snowDay = prec.map((m, k) => idx.reduce((s, i) => s + ((t2[k][i] ?? 9) <= 0.5 && m[i] ? m[i] * 0.7 : 0), 0));
    }
    if (snowDay) {
      const v = snowDay.filter((x) => x != null);
      if (v.length) {
        rec.pSnow = Math.round((v.filter((x) => x >= 0.3).length / v.length) * 100);
        rec.snowMean = r1(mean(v));
      }
    }
    dates[d] = rec;
  }
  return dates;
}

// Vingerafdruk van de ruwe data: verandert alleen als er echt een nieuwe run is.
export function fingerprint(resp) {
  const h = resp.hourly;
  const src = (h.temperature_2m || []).slice(0, 96).concat((h.temperature_2m_member10 || []).slice(24, 72));
  let hash = 2166136261;
  for (const x of src) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  }
  return (hash >>> 0).toString(36);
}

// Schat run-tijdstip als de officiële metadata niet beschikbaar is.
export function estimateRun(nowMs, latencyH = 7) {
  const t = new Date(nowMs - latencyH * 3600e3);
  t.setUTCMinutes(0, 0, 0);
  t.setUTCHours(Math.floor(t.getUTCHours() / 6) * 6);
  return t.toISOString().replace(':00.000Z', 'Z');
}

// ---------- Run-vergelijking ----------
export function compareRuns(cur, prev) {
  const out = {};
  if (!cur || !prev) return out;
  for (const d of Object.keys(cur)) {
    const a = cur[d], b = prev[d];
    if (!b) continue;
    out[d] = {
      dTx: a.tx != null && b.tx != null ? r1(a.tx - b.tx) : null,
      dTn: a.tn != null && b.tn != null ? r1(a.tn - b.tn) : null,
      d850: a.t850 != null && b.t850 != null ? r1(a.t850 - b.t850) : null,
    };
  }
  return out;
}

// Gemiddelde (Tx+Tn)/2 over dag-offset [from,to] t.o.v. eerste datum in de run.
export function windowMean(dates, from, to, refDate) {
  const keys = Object.keys(dates).sort();
  const start = refDate || keys[0];
  const s = new Date(start + 'T12:00:00Z').getTime();
  const vals = keys.filter((d) => {
    const off = Math.round((new Date(d + 'T12:00:00Z').getTime() - s) / 864e5);
    return off >= from && off <= to;
  }).map((d) => (dates[d].tx + dates[d].tn) / 2);
  return vals.length >= Math.min(3, to - from + 1) ? r1(mean(vals)) : null;
}

// Gemiddelde anomalie t.o.v. normaal over een reeks dagen (dag-temperatuur).
export function anomaly(dates) {
  const v = Object.entries(dates).map(([d, r]) => {
    const m = monthOf(d) - 1;
    return ((r.tx - NORMAL_TX[m]) + (r.tn - NORMAL_TN[m])) / 2;
  });
  return r1(mean(v));
}

// ---------- Seizoensbewuste winterscore (0 = zacht/grauw, 100 = ijzig) ----------
export function seasonMode(month) {
  if ([12, 1, 2].includes(month)) return 'winter';
  if ([9, 10, 11].includes(month)) return 'herfst';
  if ([3, 4, 5].includes(month)) return 'voorjaar';
  return 'zomer';
}

export function winterScore(days) {
  // days: [{date, tx, tn, pSnow?, snow?}]
  if (!days.length) return 0;
  const mode = seasonMode(monthOf(days[0].date));
  let score = 35;
  const anom = mean(days.map((d) => {
    const m = monthOf(d.date) - 1;
    return ((d.tx - NORMAL_TX[m]) + (d.tn - NORMAL_TN[m])) / 2;
  }));
  score -= anom * 7; // 1 graad kouder dan normaal = +7
  for (const d of days) {
    if (mode === 'winter') {
      if (d.tx < 0) score += 8;
      if (d.tn < -10) score += 6;
      if ((d.pSnow ?? 0) >= 50 || (d.snow ?? 0) >= 1) score += 10;
    } else {
      if (d.tn < 0) score += 7;
      if (d.tn < 2) score += 2;
      if ((d.pSnow ?? 0) >= 30 || (d.snow ?? 0) >= 0.5) score += 12;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Hoogtepunten per dag, afhankelijk van seizoen (nachtvorst in herfst/voorjaar, ijsdagen in winter).
export function dayHighlights(d, mode) {
  const out = [];
  const snow = d.snow ?? 0, ps = d.pSnow ?? 0;
  if (snow >= 0.5 || ps >= 40) out.push({ k: 'snow', t: snow >= 0.5 ? `${String(snow).replace('.', ',')} cm sneeuw` : `Sneeuwkans ${ps}%` });
  if (d.tx != null && d.tx < 0) out.push({ k: 'ice', t: 'IJsdag' });
  if (d.tn != null && d.tn < -10) out.push({ k: 'strong', t: 'Strenge vorst' });
  else if (d.tn != null && d.tn < -5) out.push({ k: 'frost', t: 'Matige vorst' });
  else if (d.tn != null && d.tn < 0) out.push({ k: 'frost', t: mode === 'winter' ? 'Lichte vorst' : 'Nachtvorst!' });
  else if (d.tn != null && d.tn < 2.5 && mode !== 'winter') out.push({ k: 'ground', t: 'Kans op grondvorst' });
  if (mode === 'winter' && snow >= 0.5 && d.tx != null && d.tx < -1) out.push({ k: 'dry', t: 'Droge sneeuw' });
  return out;
}

// ---------- Grootschalige signalen ----------
// Benadering NAO: drukverschil Azoren (Ponta Delgada) – IJsland (Reykjavik), gestandaardiseerd.
// Indicatief: maandklimatologie afgerond, std ~ dagelijkse spreiding.
const AZ_CLIM = [1021, 1020, 1019, 1019, 1020, 1022, 1024, 1023, 1020, 1019, 1019, 1021];
const IC_CLIM = [1000, 1002, 1005, 1010, 1012, 1011, 1010, 1009, 1007, 1005, 1003, 1001];
const DIFF_SD = 9; // hPa, ruwe dagelijkse spreiding van het drukverschil

export const SIGNAL_POINTS = [
  { id: 'azores', lat: 37.74, lon: -25.67 },
  { id: 'iceland', lat: 64.13, lon: -21.9 },
  { id: 'scand', lat: 63.0, lon: 15.0 },
  { id: 'home', lat: HOME.lat, lon: HOME.lon },
];

function dailyMeanOfMembers(hourly, name) {
  const mem = extractMembers(hourly, name);
  if (!mem.length) return null;
  const days = dayIndex(hourly.time);
  const out = {};
  for (const [d, idx] of days) {
    const per = mem.map((m) => memberDaily(m, idx, (v) => sum(v) / v.length)).filter((x) => x != null);
    if (per.length) out[d] = per;
  }
  return out;
}

// respByPoint: { azores, iceland, scand, home } — Open-Meteo ensemble-responsen
export function computeSignals(respByPoint) {
  const az = dailyMeanOfMembers(respByPoint.azores?.hourly, 'pressure_msl');
  const ic = dailyMeanOfMembers(respByPoint.iceland?.hourly, 'pressure_msl');
  const sc = dailyMeanOfMembers(respByPoint.scand?.hourly, 'pressure_msl');
  const hm = dailyMeanOfMembers(respByPoint.home?.hourly, 'pressure_msl');
  const hh = respByPoint.home?.hourly;
  const wd = hh ? extractMembers(hh, 'wind_direction_850hPa') : [];
  const ws = hh ? extractMembers(hh, 'wind_speed_850hPa') : [];
  const days = hh ? dayIndex(hh.time) : new Map();
  const out = [];
  for (const [d] of days) {
    const m = monthOf(d) - 1;
    const rec = { date: d };
    if (az?.[d] && ic?.[d]) {
      const diffs = az[d].map((a, i) => (ic[d][i] != null ? a - ic[d][i] : null)).filter((x) => x != null);
      const clim = AZ_CLIM[m] - IC_CLIM[m];
      rec.nao = r1((mean(diffs) - clim) / DIFF_SD);
      rec.naoNeg = Math.round((diffs.filter((x) => (x - clim) / DIFF_SD < -0.5).length / diffs.length) * 100);
    }
    if (sc?.[d]) {
      rec.scand = Math.round(mean(sc[d]));
      if (hm?.[d]) {
        const g = sc[d].map((s, i) => (hm[d][i] != null ? s - hm[d][i] : null)).filter((x) => x != null);
        rec.scandGrad = r1(mean(g));
        rec.pBlock = Math.round((sc[d].filter((x) => x >= 1028).length / sc[d].length) * 100);
      }
    }
    if (wd.length) {
      const idx = days.get(d);
      let east = 0, tot = 0;
      wd.forEach((mem, k) => {
        // dominante richting per lid per dag via vectorgemiddelde
        let u = 0, v = 0;
        for (const i of idx) {
          const dir = mem[i], sp = ws[k]?.[i] ?? 1;
          if (dir == null) continue;
          const rad = (dir * Math.PI) / 180;
          u += -sp * Math.sin(rad); v += -sp * Math.cos(rad);
        }
        if (u === 0 && v === 0) return;
        let from = (Math.atan2(-u, -v) * 180) / Math.PI; if (from < 0) from += 360;
        tot++;
        if (from >= 30 && from <= 150) east++;
      });
      if (tot) rec.pEast = Math.round((east / tot) * 100);
    }
    out.push(rec);
  }
  return out;
}

// Zoek 'openingen' richting winterweer in signalen + temperatuurpluim; tekst in het Nederlands.
export function findOpenings(signals, ensDates) {
  const notes = [];
  const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const first = (pred) => signals.find(pred);
  const e = first((s) => (s.pEast ?? 0) >= 35);
  if (e) notes.push({ level: e.pEast >= 60 ? 2 : 1, text: `Oostelijke stroming op 850 hPa in ${e.pEast}% van de leden rond ${fmt(e.date)}: continentale lucht kan worden aangevoerd.` });
  const b = first((s) => (s.pBlock ?? 0) >= 40);
  if (b) notes.push({ level: b.pBlock >= 65 ? 2 : 1, text: `Hogedruk boven Scandinavië (≥1028 hPa) in ${b.pBlock}% van de leden rond ${fmt(b.date)}: klassieke blokkade-opzet.` });
  const n = first((s) => (s.nao ?? 0) <= -1);
  if (n) notes.push({ level: n.nao <= -1.8 ? 2 : 1, text: `NAO-benadering duikt naar ${String(n.nao).replace('.', ',').replace('-', '−')} rond ${fmt(n.date)}: zwakkere westcirculatie, meer ruimte voor kou uit noord of oost.` });
  const cold850 = Object.entries(ensDates || {}).find(([, r]) => (r.p850m5 ?? 0) >= 30);
  if (cold850) notes.push({ level: cold850[1].p850m10 >= 20 ? 2 : 1, text: `T850 onder −5 °C in ${cold850[1].p850m5}% van de leden op ${fmt(cold850[0])}${cold850[1].p850m10 ? ` (onder −10 °C: ${cold850[1].p850m10}%)` : ''}.` });
  const snow = Object.entries(ensDates || {}).find(([, r]) => (r.pSnow ?? 0) >= 15);
  if (snow) notes.push({ level: snow[1].pSnow >= 40 ? 2 : 1, text: `Sneeuwkans ${snow[1].pSnow}% op ${fmt(snow[0])} volgens het ensemble.` });
  if (!notes.length) {
    const zonal = signals.filter((s) => (s.nao ?? 0) >= 1).length;
    notes.push({ level: 0, text: zonal >= 5 ? 'Westcirculatie overheerst (positieve NAO-benadering): voorlopig geen winterse opening te zien.' : 'Nog geen duidelijke winterse opening in de grootschalige patronen.' });
  }
  return notes;
}
