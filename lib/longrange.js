// Laag 3: lange termijn (ECMWF EC46 = 46 dagen, SEAS5 = 7 maanden) via Open-Meteo Seasonal API.
// Gedeeld door de GitHub Action (ophalen + archiveren) en de app (tonen).

export const SEASONAL_API = 'https://seasonal-api.open-meteo.com/v1/seasonal';

// Kandidaat-modelnamen: de eerste die werkt wint. Leden geven kansen, het ensemblegemiddelde is de terugval.
export const LONG_MODELS = {
  ec46: {
    label: 'ECMWF EC46', freq: 'weekly',
    members: ['ecmwf_ec46'],
    mean: ['ecmwf_ec46_ensemble_mean'],
  },
  seas: {
    label: 'ECMWF SEAS5', freq: 'monthly',
    members: ['ecmwf_seas6', 'ecmwf_seas5'],
    mean: ['ecmwf_seas6_ensemble_mean', 'ecmwf_seas5_ensemble_mean'],
  },
};

// Variabelensets, van rijk naar minimaal (namen verschillen soms per model).
export const LONG_VARS = [
  'temperature_2m_mean,temperature_2m_anomaly,snowfall_mean,snowfall_anomaly',
  'temperature_2m_mean,temperature_2m_anomaly',
  'temperature_2m_anomaly',
];

export function longUrl(freq, model, vars, lat, lon) {
  return `${SEASONAL_API}?latitude=${lat}&longitude=${lon}&${freq}=${vars}&models=${model}&timezone=GMT`;
}

const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// Verzamel per basisvariabele alle reeksen: zonder achtervoegsel of als _member01.._member51.
function seriesByBase(block) {
  const out = {};
  for (const [k, v] of Object.entries(block || {})) {
    if (k === 'time' || !Array.isArray(v)) continue;
    const m = k.match(/^(.*?)(?:_member(\d+))?$/);
    const base = m[1];
    (out[base] ||= []).push(v);
  }
  return out;
}

// Samenvatting per periode (week of maand): gemiddelde afwijking + aandeel leden duidelijk kouder/warmer.
export function summarizeLong(resp, freq) {
  const block = resp[freq];
  if (!block?.time) return null;
  const s = seriesByBase(block);
  const anom = s.temperature_2m_anomaly || [];
  const tmean = s.temperature_2m_mean || [];
  const snowA = s.snowfall_anomaly || [];
  const periods = {};
  block.time.forEach((t, i) => {
    const key = freq === 'monthly' ? t.slice(0, 7) : t.slice(0, 10);
    const a = anom.map((m) => m[i]).filter((x) => x != null);
    if (!a.length) return;
    const rec = { anom: r1(mean(a)), n: a.length };
    if (a.length >= 5) {
      rec.pCold = Math.round((a.filter((x) => x < -0.5).length / a.length) * 100);
      rec.pWarm = Math.round((a.filter((x) => x > 0.5).length / a.length) * 100);
      const sorted = a.slice().sort((x, y) => x - y);
      rec.p10 = r1(sorted[Math.floor(0.1 * (sorted.length - 1))]);
      rec.p90 = r1(sorted[Math.ceil(0.9 * (sorted.length - 1))]);
    }
    const tm = tmean.map((m) => m[i]).filter((x) => x != null);
    if (tm.length) rec.mean = r1(mean(tm));
    const sa = snowA.map((m) => m[i]).filter((x) => x != null);
    if (sa.length) rec.snowAnom = r1(mean(sa));
    periods[key] = rec;
  });
  return Object.keys(periods).length ? periods : null;
}

export function longFingerprint(periods) {
  return Object.entries(periods || {}).map(([k, v]) => `${k}:${v.anom}`).join('|');
}

// Vergelijk met een eerdere uitgave. Weken van EC46 schuiven per dag op,
// dus we zoeken de vorige week die het midden van de huidige week bevat.
export function compareLong(cur, prev, freq) {
  const out = {};
  if (!cur || !prev) return out;
  if (freq === 'monthly') {
    for (const k of Object.keys(cur)) if (prev[k]?.anom != null) out[k] = r1(cur[k].anom - prev[k].anom);
    return out;
  }
  const prevKeys = Object.keys(prev).sort();
  for (const k of Object.keys(cur)) {
    const mid = new Date(k + 'T00:00:00Z').getTime() + 3.5 * 864e5;
    const pk = prevKeys.find((p) => { const s = new Date(p + 'T00:00:00Z').getTime(); return mid >= s && mid < s + 7 * 864e5; });
    if (pk && prev[pk].anom != null) out[k] = r1(cur[k].anom - prev[pk].anom);
  }
  return out;
}

// Winterscore per periode: 0 (zacht) .. 100 (ijzig), voor de kleur van de meter.
export function longScore(rec) {
  if (!rec || rec.anom == null) return 50;
  let s = 50 - rec.anom * 15;
  if (rec.pCold != null) s += (rec.pCold - rec.pWarm) * 0.15;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Gemiddelde afwijking van de echte wintermaanden (dec-feb) in een seizoensuitgave.
export function winterMean(periods) {
  const keys = Object.keys(periods || {}).filter((k) => ['12', '01', '02'].includes(k.slice(5, 7)));
  if (!keys.length) return null;
  return { anom: r1(mean(keys.map((k) => periods[k].anom))), months: keys };
}
