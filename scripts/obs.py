#!/usr/bin/env python3
"""Winterwacht — waarnemingen van KNMI-meetstations rond Ommen.

Haalt de 10-minutenbestanden van het KNMI Data Platform op (dataset
10-minute-in-situ-meteorological-observations, CC BY 4.0), bewaart per station een compacte
tijdreeks en schrijft die naar $OBS_OUT/obs.json. De Action zet dat bestand op de tak `obs-data`;
de app leest het daar en interpoleert naar de gekozen plek.

Zonder eigen sleutel gebruikt het script de openbare, gedeelde sleutel van KNMI. Die zit vaak tegen
de limiet aan (HTTP 429): het script wacht dan en probeert opnieuw, en haalt wat ontbreekt bij de
volgende run in. Met een eigen (gratis) sleutel als GitHub-secret KNMI_API_KEY gaat het sneller.

Omgevingsvariabelen (allemaal optioneel):
  OBS_OUT            map met obs.json (standaard ./obs-out)
  KNMI_API_KEY       eigen sleutel
  OBS_KEEP_DAYS      hoe lang de 10-minutenreeks bewaard blijft (standaard 14)
  OBS_BACKFILL_H     hoe ver terug ontbrekende stappen worden aangevuld (standaard 72)
  OBS_MAX_FILES      maximaal aantal bestanden per run (standaard 60)
  OBS_BUDGET_S       maximale looptijd in seconden (standaard 540)
"""
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ANON_KEY = ('eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjUzYTg1ZDBhMmQ5YzRkYzJiYWNlNzQ4NTQ2Zjk4ODExIiwiaCI6Im11cm11cjEyOCJ9')
BASE = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files'
FILE_FMT = 'KMDS__OPER_P___10M_OBS_L2_{:%Y%m%d%H%M}.nc'

# WMO-nummer -> korte naam. Heino en Hoogeveen zijn de naaste stations bij Ommen; Marknesse en Twenthe
# geven de app de mogelijkheid om met vier stations te middelen.
STATIONS = {'06278': 'Heino', '06279': 'Hoogeveen', '06273': 'Marknesse', '06290': 'Twenthe'}

STEP = 600
# (naam in de uitvoer, [bestandsvariabelen in volgorde van voorkeur], afronding)
VARS = [
    ('ta', ['ta'], 1),        # luchttemperatuur 1,5 m (°C)
    ('ff', ['ff', 'ffs'], 1), # windsnelheid 10 m, 10-min gemiddelde (m/s)
    ('dd', ['dd'], 0),        # windrichting (graden)
    ('fx', ['fx', 'gff'], 1), # hoogste windstoot in het interval (m/s)
    ('rg', ['rg', 'pg'], 2),  # neerslagintensiteit regenmeter (mm/u), valt terug op de weersensor
    ('r1h', ['R1H'], 1),      # neerslag laatste uur (mm)
]
VAR_NAMES = [v[0] for v in VARS]

OUT = os.environ.get('OBS_OUT', 'obs-out')
KEY = os.environ.get('KNMI_API_KEY', '').strip() or ANON_KEY
KEEP_DAYS = int(os.environ.get('OBS_KEEP_DAYS', '14'))
BACKFILL_H = int(os.environ.get('OBS_BACKFILL_H', '72'))
MAX_FILES = int(os.environ.get('OBS_MAX_FILES', '60'))
BUDGET_S = int(os.environ.get('OBS_BUDGET_S', '540'))
OWN_KEY = KEY != ANON_KEY
T_START = time.time()


LOG = []


def log(*a):
    line = time.strftime('%H:%M:%S ') + ' '.join(str(x) for x in a)
    LOG.append(line)
    print(line, flush=True)


def write_log():
    # laatste run altijd meepubliceren: handig om te zien waarom er (nog) niets binnenkomt
    try:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, 'last-run.txt'), 'w', encoding='utf-8') as f:
            f.write(dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + '\n' + '\n'.join(LOG[-60:]) + '\n')
        open(os.path.join(OUT, '.updated'), 'w').close()
    except Exception:
        pass


def over_budget():
    return time.time() - T_START > BUDGET_S


class Throttled(Exception):
    pass


def http(url, headers=None, tries=5, binary=False):
    """GET met uitgebreid opnieuw proberen bij 429 en serverfouten."""
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data.decode('utf-8'))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
            if e.code in (401, 403) and not OWN_KEY:
                raise
            # 429: de gedeelde sleutel zit vol; even wachten helpt meestal
            wait = min(8 * (i + 1), 40) if e.code == 429 else 4 * (i + 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            last = e
            wait = 4 * (i + 1)
        if over_budget():
            break
        time.sleep(wait)
    if isinstance(last, urllib.error.HTTPError) and last.code == 429:
        raise Throttled(str(last))
    raise last or RuntimeError('onbekende fout')


def file_url(name):
    meta = http(f'{BASE}/{urllib.parse.quote(name)}/url', {'Authorization': KEY})
    return meta['temporaryDownloadUrl']


def parse_time_units(units):
    m = re.match(r'\s*seconds\s+since\s+(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d):(\d\d))?', units or '')
    if not m:
        return -631152000  # 1950-01-01 00:00:00 UTC, de standaard van deze dataset
    y, mo, d, h, mi, s = [int(x) if x else 0 for x in m.groups()]
    return int(dt.datetime(y, mo, d, h, mi, s, tzinfo=dt.timezone.utc).timestamp())


def read_nc(path):
    """Geeft {epoch: {wmo: [waarden in volgorde VAR_NAMES]}} voor onze stations."""
    import netCDF4
    import numpy as np
    out = {}
    with netCDF4.Dataset(path) as ds:
        ids = [str(s).strip() for s in ds.variables['station'][:]]
        sel = {i: k for k, i in enumerate(ids) if i in STATIONS}
        if not sel:
            # sommige bestanden gebruiken de naam in plaats van het nummer
            names = [str(s).strip() for s in ds.variables['stationname'][:]] if 'stationname' in ds.variables else []
            for k, n in enumerate(names):
                for wmo, short in STATIONS.items():
                    if short.lower() in n.lower():
                        sel[wmo] = k
        tv = ds.variables['time']
        base = parse_time_units(getattr(tv, 'units', ''))
        times = [base + int(round(float(x))) for x in np.ma.filled(tv[:], 0).tolist()]
        cols = {}
        for name, cands, nd in VARS:
            for c in cands:
                if c in ds.variables:
                    cols.setdefault(name, []).append(ds.variables[c])
        for ti, ts in enumerate(times):
            ts = int(round(ts / STEP) * STEP)
            row = {}
            for wmo, si in sel.items():
                vals = []
                for name, cands, nd in VARS:
                    v = None
                    for var in cols.get(name, []):
                        x = var[si, ti] if var.dimensions[0] == 'station' else var[ti, si]
                        if not np.ma.is_masked(x) and np.isfinite(float(x)):
                            v = round(float(x), nd) if nd else int(round(float(x)))
                            break
                    vals.append(v)
                row[wmo] = vals
            out[ts] = row
    return out


def load_archive():
    path = os.path.join(OUT, 'obs.json')
    samples, gone = {}, set()
    if not os.path.exists(path):
        return samples, gone
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        t0, n = d['t0'], d['n']
        for wmo, cols in d['data'].items():
            for k in range(n):
                row = [cols[name][k] if name in cols else None for name in VAR_NAMES]
                if any(x is not None for x in row):
                    samples.setdefault(t0 + k * STEP, {})[wmo] = row
        gone = set(d.get('gone', []))
    except Exception as e:  # kapot archief: opnieuw beginnen
        log('archief onleesbaar, begin opnieuw:', e)
        return {}, set()
    return samples, gone


def save_archive(samples, gone, note):
    if not samples:
        return False
    now = int(time.time())
    keep_from = now - KEEP_DAYS * 86400
    samples = {t: r for t, r in samples.items() if t >= keep_from}
    if not samples:
        return False
    t0, t1 = min(samples), max(samples)
    n = (t1 - t0) // STEP + 1
    data = {}
    for wmo in STATIONS:
        cols = {name: [None] * n for name in VAR_NAMES}
        has = False
        for t, row in samples.items():
            vals = row.get(wmo)
            if not vals:
                continue
            k = (t - t0) // STEP
            for j, name in enumerate(VAR_NAMES):
                cols[name][k] = vals[j]
            has = True
        if has:
            data[wmo] = cols
    out = {
        'v': 1,
        'updated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'KNMI Data Platform, 10-minute-in-situ-meteorological-observations (CC BY 4.0)',
        'step': STEP, 't0': t0, 'n': n, 'last': t1,
        'vars': VAR_NAMES,
        'units': {'ta': '°C', 'ff': 'm/s', 'dd': 'graden', 'fx': 'm/s', 'rg': 'mm/u', 'r1h': 'mm'},
        'stations': {w: {'name': s} for w, s in STATIONS.items()},
        'gone': sorted(g for g in gone if g >= keep_from),
        'note': note,
        'data': data,
    }
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, 'obs.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, os.path.join(OUT, 'obs.json'))
    open(os.path.join(OUT, '.updated'), 'w').close()
    return True


def main():
    os.makedirs(OUT, exist_ok=True)
    samples, gone = load_archive()
    now = int(time.time())
    newest = (now - 150) // STEP * STEP  # bestand verschijnt ~3-4 min na het einde van het interval
    oldest = (now - BACKFILL_H * 3600) // STEP * STEP
    todo = [t for t in range(newest, oldest - 1, -STEP) if t not in samples and t not in gone]
    log(f'{len(samples)} stappen in archief, {len(todo)} ontbreken (nieuwste eerst), sleutel: {"eigen" if OWN_KEY else "openbaar"}')
    got, fails, note = 0, 0, ''
    for t in todo[:MAX_FILES]:
        if over_budget():
            note = 'tijdslimiet bereikt'
            break
        name = FILE_FMT.format(dt.datetime.fromtimestamp(t, dt.timezone.utc))
        try:
            url = file_url(name)
            with tempfile.NamedTemporaryFile(suffix='.nc', delete=False) as tmp:
                tmp.write(http(url, binary=True))
            try:
                rows = read_nc(tmp.name)
            finally:
                os.unlink(tmp.name)
            if not rows:
                raise RuntimeError('geen stations of tijdstappen in bestand')
            for ts, row in rows.items():
                samples.setdefault(ts, {}).update(row)
            got += 1
            fails = 0
        except urllib.error.HTTPError as e:
            if e.code == 404:
                gone.add(t)  # bestaat niet (meer) bij KNMI: niet blijven proberen
                continue
            fails += 1
            log(name, 'HTTP', e.code)
        except Throttled:
            fails += 1
            log(name, 'te druk bij KNMI (429)')
        except Exception as e:
            fails += 1
            log(name, 'fout:', repr(e)[:200])
        if fails >= 3:
            note = 'KNMI weigerde herhaaldelijk; volgende run probeert opnieuw'
            break
        time.sleep(0.4 if OWN_KEY else 1.6)
    changed = False
    if got or gone:
        changed = save_archive(samples, gone, note)
    log(f'klaar: {got} bestanden binnen, {len(todo) - got} nog te gaan, archief {"bijgewerkt" if changed else "ongewijzigd"}')
    return 0


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # nooit de hele workflow laten falen op een tijdelijke KNMI-storing
        log('onverwachte fout:', repr(e))
    write_log()
    sys.exit(0)
