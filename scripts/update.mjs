// Draait in GitHub Actions (Node 20+). Haalt na elke nieuwe modelrun de ensembles op
// voor de locaties in config.json, en bewaart een compacte samenvatting per run.
// Zo kan de app per datum laten zien of een run kouder (blauw) of warmer (rood) is dan de vorige.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  ENSEMBLES, summarizeEnsemble, fingerprint, estimateRun, windowMean,
  SIGNAL_POINTS, computeSignals, findOpenings,
} from '../lib/stats.js';

const ROOT = new URL('../', import.meta.url);
const KEEP_RUNS = 28; // ~7 dagen bij 4 runs per dag
const ENS_API = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const TZ = 'Europe/Amsterdam';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'winterwacht-ommen (github action)' } });
      clearTimeout(to);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        const err = new Error(body.reason || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return body;
    } catch (e) {
      last = e;
      // verkeerde parameter of niet-bestaand endpoint: niet opnieuw proberen
      if (e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  throw last;
}

// Probeert modelnamen en variabelen af tot er een combinatie werkt.
async function fetchEnsemble(model, lat, lon) {
  const varSets = [
    'temperature_2m,temperature_850hPa,snowfall,precipitation',
    'temperature_2m,temperature_850hPa,precipitation',
    'temperature_2m,snowfall,precipitation',
    'temperature_2m,precipitation',
  ];
  let lastErr;
  for (const id of model.ids) {
    for (const vars of varSets) {
      const url = `${ENS_API}?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=${id}&forecast_days=15&timezone=${encodeURIComponent(TZ)}`;
      try {
        const data = await getJSON(url);
        return { data, id };
      } catch (e) {
        lastErr = e;
        if (e.status !== 400) throw e;
      }
    }
  }
  throw lastErr;
}

// Officiële run-tijd via metadata (als dat endpoint bestaat), anders een schatting.
async function runTime(id) {
  const candidates = [
    `https://ensemble-api.open-meteo.com/data/${id}_ensemble/static/meta.json`,
    `https://ensemble-api.open-meteo.com/data/${id}/static/meta.json`,
    `https://api.open-meteo.com/data/${id}_ensemble/static/meta.json`,
  ];
  for (const u of candidates) {
    try {
      const m = await getJSON(u, 1);
      if (m.last_run_initialisation_time) {
        return { run: new Date(m.last_run_initialisation_time * 1000).toISOString().replace(':00.000Z', 'Z'), estimated: false };
      }
    } catch { /* volgende proberen */ }
  }
  return { run: estimateRun(Date.now()), estimated: true };
}

async function loadJSON(path, fallback) {
  try { return JSON.parse(await readFile(new URL(path, ROOT), 'utf8')); } catch { return fallback; }
}

async function main() {
  const config = await loadJSON('config.json', { locations: [] });
  await mkdir(new URL('data/history/', ROOT), { recursive: true });
  const status = await loadJSON('data/status.json', {});
  status.checked = new Date().toISOString();
  status.models = status.models || {};
  let changed = false;

  for (const loc of config.locations) {
    const path = `data/history/${loc.id}.json`;
    const hist = await loadJSON(path, { location: loc, models: {} });
    const before = changed;
    changed = false;
    hist.location = loc;

    for (const model of ENSEMBLES) {
      try {
        const { data, id } = await fetchEnsemble(model, loc.lat, loc.lon);
        const fp = fingerprint(data);
        const m = hist.models[model.key] || (hist.models[model.key] = { runs: [] });
        m.id = id;
        if (m.runs.length && m.runs[0].fp === fp) { log(loc.id, model.key, 'geen nieuwe run'); continue; }
        const { run, estimated } = await runTime(id);
        const dates = summarizeEnsemble(data);
        const keys = Object.keys(dates).sort();
        const entry = {
          run, estimated, fp,
          fetched: new Date().toISOString(),
          // trendgetallen: gemiddelde dagtemperatuur dag 1-7 en dag 8-14
          w17: windowMean(dates, 0, 6, keys[0]),
          w814: windowMean(dates, 7, 13, keys[0]),
          dates,
        };
        // Zelfde run-tijd al opgeslagen (bijv. nagekomen data)? Dan vervangen.
        if (m.runs.length && m.runs[0].run === run && !estimated) m.runs[0] = entry;
        else m.runs.unshift(entry);
        m.runs = m.runs.slice(0, KEEP_RUNS);
        status.models[model.key] = { id, run, estimated, fetched: entry.fetched };
        changed = true;
        log(loc.id, model.key, 'nieuwe run', run, estimated ? '(geschat)' : '');
      } catch (e) {
        log(loc.id, model.key, 'mislukt:', e.message);
      }
    }

    // Grootschalige signalen (alleen voor de eerste/thuislocatie; patronen zijn grootschalig)
    if (loc === config.locations[0]) {
      try {
        const pts = SIGNAL_POINTS.map((p) => (p.id === 'home' ? { ...p, lat: loc.lat, lon: loc.lon } : p));
        let sigModel = null, resp = null;
        for (const id of ['ecmwf_aifs025', 'ecmwf_aifs025_ensemble', 'ecmwf_ifs025']) {
          try {
            const lat = pts.map((p) => p.lat).join(','), lon = pts.map((p) => p.lon).join(',');
            resp = await getJSON(`${ENS_API}?latitude=${lat}&longitude=${lon}&hourly=pressure_msl,wind_speed_850hPa,wind_direction_850hPa&models=${id}&forecast_days=15&timezone=${encodeURIComponent(TZ)}`);
            sigModel = id; break;
          } catch (e) { if (e.status !== 400) throw e; }
        }
        if (resp) {
          const arr = Array.isArray(resp) ? resp : [resp];
          const byPoint = Object.fromEntries(pts.map((p, i) => [p.id, arr[i]]));
          const signals = computeSignals(byPoint);
          const latestAifs = hist.models.aifs?.runs?.[0]?.dates || hist.models.ifs?.runs?.[0]?.dates;
          const sigFp = fingerprint(arr[0]);
          if (hist.signals?.fp !== sigFp) {
            const prevNotes = hist.signals?.openings;
            hist.signals = { model: sigModel, fp: sigFp, fetched: new Date().toISOString(), days: signals, openings: findOpenings(signals, latestAifs), prevOpenings: prevNotes };
            changed = true;
            log('signalen bijgewerkt via', sigModel);
          }
        }
      } catch (e) {
        log('signalen mislukt:', e.message);
      }
    }

    if (changed) {
      hist.updated = new Date().toISOString();
      await writeFile(new URL(path, ROOT), JSON.stringify(hist));
    }
    changed = changed || before;
  }

  // Alleen schrijven bij nieuwe data, zodat er niet elk uur een lege commit ontstaat.
  if (changed) await writeFile(new URL('data/status.json', ROOT), JSON.stringify(status, null, 1));
  log(changed ? 'Klaar: nieuwe data opgeslagen.' : 'Klaar: niets nieuws.');
}

main().catch((e) => { console.error(e); process.exit(1); });
