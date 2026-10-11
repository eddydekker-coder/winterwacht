// Weerbeeld voor de komende dagen: een korte kop plus een paar zinnen detail.
// days: [{ date, tx, tn, rain, phours, gust, code, snow, pSnow }] — vandaag eerst.
// normals: (date) => { tx, tn } normaalwaarden voor die dag.

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const nl = (x) => String(x).replace('.', ',');
const deg = (t) => `${Math.round(t)}°`;

export function dayName(date, i) {
  if (i === 0) return 'vandaag';
  if (i === 1) return 'morgen';
  return WEEKDAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
}
export function list(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} en ${words[words.length - 1]}`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// 'op maandag', maar gewoon 'morgen' en 'vandaag'
const on = (txt) => (/^(vandaag|morgen)/.test(txt) ? txt : `op ${txt}`);

// Reeksen aaneengesloten dagen samenvatten: "vandaag tot en met zondag", "maandag en dinsdag"
function spans(idx, days) {
  const groups = [];
  for (const i of idx) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1] === i - 1) g.push(i); else groups.push([i]);
  }
  return list(groups.flatMap((g) => (g.length >= 3
    ? [`${dayName(days[g[0]].date, g[0])} tot en met ${dayName(days[g[g.length - 1]].date, g[g.length - 1])}`]
    : g.map((i) => dayName(days[i].date, i)))));
}

export function outlook(days, normals) {
  const n = days.length;
  const name = (i) => dayName(days[i].date, i);
  const rain = days.map((d) => d.rain ?? 0);
  const wet = days.map((d) => (d.rain ?? 0) >= 1 || (d.phours ?? 0) >= 4);
  const dry = days.map((d) => (d.rain ?? 0) < 0.3);
  const sunny = days.map((d, i) => dry[i] && d.code != null && d.code <= 2);
  const wetIdx = wet.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  const dryIdx = dry.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  const snowIdx = days.map((d, i) => ((d.snow ?? 0) >= 0.3 || (d.pSnow ?? 0) >= 40 ? i : -1)).filter((i) => i >= 0);
  const iceIdx = days.map((d, i) => (d.tx != null && d.tx < 0 ? i : -1)).filter((i) => i >= 0);
  const frostIdx = days.map((d, i) => (d.tn != null && d.tn < 0 ? i : -1)).filter((i) => i >= 0);
  const stormIdx = days.map((d, i) => ((d.gust ?? 0) >= 75 ? i : -1)).filter((i) => i >= 0);
  const windyIdx = days.map((d, i) => ((d.gust ?? 0) >= 55 ? i : -1)).filter((i) => i >= 0);
  const total = rain.reduce((a, b) => a + b, 0);

  const anoms = days.map((d) => { const m = normals(d.date); return d.tx != null && d.tn != null ? ((d.tx - m.tx) + (d.tn - m.tn)) / 2 : null; }).filter((x) => x != null);
  const anom = anoms.length ? anoms.reduce((a, b) => a + b, 0) / anoms.length : 0;
  const half = Math.ceil(n / 2);
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const t1 = avg(days.slice(0, half).map((d) => (d.tx + d.tn) / 2)), t2 = avg(days.slice(half).map((d) => (d.tx + d.tn) / 2));
  const trend = t1 != null && t2 != null ? t2 - t1 : 0;

  // ---- kop: eerst het weertype, dan één kenmerk erbij ----
  let type;
  const firstWet = wet.slice(0, half).filter(Boolean).length, lastWet = wet.slice(half).filter(Boolean).length;
  if (snowIdx.length) type = `Winters, met sneeuw ${snowIdx[0] <= 1 ? name(snowIdx[0]) : `op ${name(snowIdx[0])}`}`;
  else if (iceIdx.length) type = `Winterse kou met een ijsdag ${iceIdx[0] <= 1 ? name(iceIdx[0]) : `op ${name(iceIdx[0])}`}`;
  else if (wetIdx.length >= n - 1) type = total >= 20 ? 'Nat en somber' : 'Wisselvallig en vaak nat';
  else if (!wetIdx.length) type = sunny.filter(Boolean).length >= Math.ceil(n * 0.6) ? 'Droog en vaak zonnig' : 'Overwegend droog';
  else if (firstWet >= 2 && lastWet === 0) type = 'Eerst nat, daarna droger';
  else if (firstWet === 0 && lastWet >= 1) type = `Eerst droog, ${name(wetIdx[0]) === 'morgen' ? 'morgen' : `vanaf ${name(wetIdx[0])}`} regen`;
  else type = 'Wisselvallig';

  let extra = '';
  if (!snowIdx.length && !iceIdx.length) {
    if (stormIdx.length) extra = `storm ${stormIdx[0] <= 1 ? name(stormIdx[0]) : `op ${name(stormIdx[0])}`}`;
    else if (frostIdx.length >= 2) extra = 'nachtvorst';
    else if (trend <= -3) extra = 'steeds kouder';
    else if (trend >= 3) extra = 'steeds zachter';
    else if (anom >= 2) extra = 'zacht voor de tijd van het jaar';
    else if (anom <= -2) extra = 'koud voor de tijd van het jaar';
    else if (windyIdx.length >= 2) extra = 'soms veel wind';
    else if (frostIdx.length === 1) extra = `nachtvorst ${frostIdx[0] <= 1 ? name(frostIdx[0]) : `op ${name(frostIdx[0])}`}`;
  }
  const sep = !extra ? '' : extra.startsWith('nachtvorst') && !type.includes(' met ') ? ' met ' : /^(storm|soms)/.test(extra) || type.includes(' en ') ? ', ' : ' en ';
  const h = `${type}${sep}${extra}`;

  // ---- detail ----
  const s = [];
  if (!wetIdx.length) s.push(dryIdx.length === n ? `${cap(n === 5 ? 'vijf' : String(n))} droge dagen.` : 'Hooguit hier en daar een spatje regen.');
  else {
    const wetTxt = `${cap(spans(wetIdx, days))} ${snowIdx.length ? 'neerslag' : 'regen'} (samen ${nl(Math.round(total))} mm)`;
    const dryRest = dryIdx.filter((i) => !wet[i]);
    s.push(dryRest.length ? `${wetTxt}, ${spans(dryRest, days)} droog.` : `${wetTxt}.`);
  }
  const txs = days.map((d) => d.tx).filter((x) => x != null), tns = days.map((d) => d.tn).filter((x) => x != null);
  const range = (a) => { const lo = Math.round(Math.min(...a)), hi = Math.round(Math.max(...a)); return lo === hi ? `${lo}°` : `${lo} tot ${hi}°`; };
  const anomTxt = Math.abs(anom) < 0.7 ? 'rond normaal' : `${nl(Math.abs(anom).toFixed(1))}° ${anom < 0 ? 'kouder' : 'warmer'} dan normaal`;
  if (txs.length) s.push(`Overdag ${range(txs)}, 's nachts ${range(tns)}: ${anomTxt}.`);
  if (Math.abs(trend) >= 2.5) {
    const turn = days.findIndex((d, i) => i > 0 && Math.abs(((d.tx + d.tn) / 2) - ((days[0].tx + days[0].tn) / 2)) >= Math.abs(trend) * 0.6);
    s.push(`${turn > 0 ? `Vanaf ${name(turn)}` : 'In de loop van de periode'} ${trend < 0 ? 'kouder' : 'zachter'}.`);
  }
  if (snowIdx.length) {
    const amt = days.reduce((a, d) => a + (d.snow ?? 0), 0);
    s.push(`Sneeuw ${on(spans(snowIdx, days))}${amt >= 0.5 ? ` (samen ${nl(amt.toFixed(1))} cm)` : ''}.`);
  }
  if (iceIdx.length) s.push(`IJsdag${iceIdx.length > 1 ? 'en' : ''}: ${spans(iceIdx, days)}.`);
  if (frostIdx.length) s.push(frostIdx.length === n ? 'Elke nacht vorst.' : `Nachtvorst ${on(spans(frostIdx, days))}.`);
  const maxG = Math.max(0, ...days.map((d) => d.gust ?? 0));
  if (maxG >= 55) { const gi = days.findIndex((d) => d.gust === maxG); s.push(`Windstoten tot ${Math.round(maxG)} km/u ${gi <= 1 ? name(gi) : `op ${name(gi)}`}.`); }
  return { h, sub: s.join(' ') };
}
