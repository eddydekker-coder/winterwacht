// Stratosfeerpaneel: zonale wind op 60 N (poolwervel). Gegevens komen uit data/strat.json (scripts/strat.py).
// Negatief = oostenwind = omgekeerde poolwervel; op 10 hPa in november tot en met maart heet dat een grote SSW.

const DAY = 864e5;
const nl = (x) => String(x).replace('.', ',').replace('-', '−');
const dShort = (ms) => new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const parseRun = (iso) => Date.parse(iso.replace(/Z$/, ':00Z'));

// Eerste omkering en aantal opeenvolgende negatieve dagen in de run
export function reversal(run) {
  const { leads, u } = run;
  const first = u.findIndex((v) => v != null && v < 0);
  if (first < 0) return { first: null, days: 0, min: Math.min(...u.filter((v) => v != null)) };
  let last = first;
  while (last + 1 < u.length && u[last + 1] != null && u[last + 1] < 0) last++;
  const min = Math.min(...u.slice(first, last + 1));
  return { first: leads[first], last: leads[last], days: last - first + 1, min, ongoing: last === u.length - 1 };
}

export function stratText(doc) {
  const g10 = doc?.models?.gfs?.levels?.['10']?.runs?.[0];
  if (!g10) return null;
  const t0 = parseRun(g10.run);
  const rv = reversal(g10);
  const now = g10.u[0];
  const month = new Date(t0).getUTCMonth() + 1;
  const season = month >= 11 || month <= 3;
  const bits = [];
  let head;
  if (rv.first == null) {
    head = now >= 40 ? 'Sterke poolwervel' : now >= 20 ? 'Poolwervel op normale sterkte' : 'Zwakke poolwervel';
    bits.push(`Westenwind op 10 hPa (60°N) nu ${nl(now)} m/s en tot en met ${dShort(t0 + g10.leads[g10.leads.length - 1] * 3600e3)} nergens negatief (laagste waarde ${nl(rv.min)} m/s).`);
  } else {
    const d0 = t0 + rv.first * 3600e3, d1 = t0 + rv.last * 3600e3;
    head = rv.first <= 0 ? 'Poolwervel omgekeerd' : 'Poolwervel keert om';
    bits.push(`De zonale wind op 10 hPa (60°N) wordt volgens GFS negatief vanaf ${dShort(d0)}${rv.days > 1 ? ` en blijft dat ${rv.ongoing ? 'tot het einde van de run' : `tot ${dShort(d1)}`} (laagste waarde ${nl(rv.min)} m/s)` : ` (${nl(rv.min)} m/s)`}.`);
    bits.push(season
      ? 'Een omkering van de wind op 10 hPa in november tot en met maart geldt als een grote stratosferische opwarming (SSW).'
      : 'Buiten november–maart telt dit formeel niet als SSW, maar het is wel een flinke verstoring.');
    if (month === 11 && rv.first <= 240) bits.push('Zo vroeg in november is dit zeldzaam, dus echte vergelijkbare gevallen zijn schaars.');
    bits.push('Het effect in de troposfeer volgt meestal na ongeveer 1 tot 3 weken, en niet altijd: kijk daarna naar de NAO-benadering en de blokkade hieronder. Een SSW is geen garantie voor winterweer in Nederland.');
  }
  const e50 = doc?.models?.ec?.levels?.['50']?.runs?.[0], g50 = doc?.models?.gfs?.levels?.['50']?.runs?.[0];
  if (e50 && g50) {
    const a = reversal(g50), b = reversal(e50);
    const lim = e50.leads[e50.leads.length - 1];
    const aIn = a.first != null && a.first <= lim;
    if (aIn !== (b.first != null)) bits.push(`Op 50 hPa zijn GFS en ECMWF het niet eens: ${b.first != null ? 'ECMWF' : 'GFS'} draait de wind om, het andere model niet.`);
    else if (b.first != null) bits.push(`Op 50 hPa laten GFS en ECMWF allebei omkering zien (ECMWF ${nl(b.min)} m/s, GFS ${nl(a.min)} m/s).`);
  }
  // verandering ten opzichte van de vorige GFS-run
  const prev = doc.models.gfs.levels['10'].runs[1];
  if (prev) {
    const p = reversal(prev);
    if (rv.days !== p.days || (rv.first ?? -1) !== (p.first ?? -1)) {
      const a = rv.days, b = p.days;
      if (a !== b) bits.push(`Ten opzichte van de vorige run duurt de omkering ${a > b ? 'langer' : 'korter'} (${a} tegen ${b} dagen).`);
    }
  }
  return { head, text: bits.join(' '), rv, now, t0 };
}

// Lijngrafiek: nieuwste run per model, vorige GFS-run gestippeld, en de gemeten stand van eerdere runs (lead 0).
export function stratSVG(doc, level) {
  const gfs = doc?.models?.gfs?.levels?.[String(level)]?.runs || [];
  const ec = level === 50 ? doc?.models?.ec?.levels?.['50']?.runs || [] : [];
  if (!gfs.length) return '<p class="note">Nog geen stratosfeerdata.</p>';
  const W = 420, H = 230, L = 42, R = 16, T = 28, B = 26;
  const t0 = parseRun(gfs[0].run);
  const series = [];
  const pts = (r) => r.leads.map((l, i) => [(parseRun(r.run) + l * 3600e3 - t0) / DAY, r.u[i]]).filter((p) => p[1] != null);
  // gemeten verloop: lead 0 van eerdere GFS-runs
  const obs = gfs.map((r) => [(parseRun(r.run) - t0) / DAY, r.u[0]]).filter((p) => p[1] != null).sort((a, b) => a[0] - b[0]);
  if (gfs[1]) series.push({ p: pts(gfs[1]), cls: 'prev', color: 'var(--ink-soft)', dash: '3 4', w: 1.6 });
  series.push({ p: pts(gfs[0]), color: '#ffffff', w: 2.6 });
  if (ec[0]) series.push({ p: pts(ec[0]), color: '#ffd36b', dash: '6 4', w: 2.4 });
  const all = series.flatMap((s) => s.p).concat(obs);
  let xmin = Math.min(...all.map((p) => p[0]), 0), xmax = Math.max(...all.map((p) => p[0]));
  let ymin = Math.min(...all.map((p) => p[1]), 0), ymax = Math.max(...all.map((p) => p[1]));
  const step = level === 10 ? 20 : 10;
  ymin = Math.floor((ymin - 2) / step) * step; ymax = Math.ceil((ymax + 2) / step) * step;
  const x = (d) => L + ((d - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
  const path = (p) => p.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('');
  let g = '';
  for (let v = ymin; v <= ymax; v += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--frost)' : 'var(--line)'}" stroke-width="${v === 0 ? 1.6 : 1}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${String(v).replace('-', '−')}</text>`;
  }
  // negatief gebied licht inkleuren
  if (ymin < 0) g = `<rect x="${L}" y="${y(0)}" width="${W - L - R}" height="${y(ymin) - y(0)}" fill="var(--frost)" opacity="0.08"/>` + g;
  for (let d = Math.ceil(xmin); d <= xmax; d += d >= 0 ? 4 : 2) {
    if (d === 0) continue;
    g += `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${x(d)}" y="${H - B + 15}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${dShort(t0 + d * DAY)}</text>`;
  }
  g += `<line x1="${x(0)}" x2="${x(0)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-opacity=".5"/><text x="${x(0) + 3}" y="${T + 10}" font-size="10" fill="var(--ink-soft)">run</text>`;
  const lines = series.map((s) => `<path d="${path(s.p)}" fill="none" stroke="${s.color}" stroke-width="${s.w}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`).join('');
  const past = obs.filter((o) => o[0] < 0);
  const pastPath = past.length ? `<path d="${path(past.concat([obs.find((o) => o[0] === 0) || past[past.length - 1]]))}" fill="none" stroke="var(--frost)" stroke-width="2.6"/>` : '';
  let lx = L;
  const items = [['GFS', '#ffffff', null], ...(gfs[1] ? [['vorige run', 'var(--ink-soft)', '3 4']] : []), ...(ec[0] ? [['ECMWF', '#ffd36b', '6 4']] : []), ...(past.length ? [['gemeten', 'var(--frost)', null]] : [])];
  const legend = items.map(([lab, col, dash]) => { const o = `<line x1="${lx}" x2="${lx + 16}" y1="12" y2="12" stroke="${col}" stroke-width="2.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${lx + 20}" y="16" font-size="10.5" fill="var(--ink-soft)">${esc(lab)}</text>`; lx += 30 + lab.length * 5.6; return o; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Zonale wind op ${level} hPa en 60 graden noord, in m/s">${g}${pastPath}${lines}${legend}</svg>`;
}

export function initStrat(el, getDoc) {
  let level = 10;
  const draw = () => {
    const doc = getDoc();
    if (!doc?.models?.gfs) {
      el.box.hidden = false;
      el.head.textContent = 'Stratosfeer: nog geen gegevens';
      el.chart.innerHTML = '';
      el.text.textContent = 'De stratosfeerwind verschijnt na de eerstvolgende uurlijkse update.';
      return;
    }
    el.box.hidden = false;
    const info = stratText(doc);
    el.head.textContent = info.head;
    el.text.textContent = info.text;
    el.chart.innerHTML = stratSVG(doc, level);
    el.pick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.l) === level)));
    el.src.textContent = `GFS ${doc.models.gfs.levels['10'].runs[0].run.replace('T', ' ').replace('Z', ' UTC')}${doc.models.ec ? ` · ECMWF ${doc.models.ec.levels['50'].runs[0].run.replace('T', ' ').replace('Z', ' UTC')}` : ''}`;
  };
  el.pick.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; level = Number(b.dataset.l); draw(); });
  return { render: draw };
}
