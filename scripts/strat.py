#!/usr/bin/env python3
"""Zonale wind in de stratosfeer op 60 graden noord: de maat voor de sterkte van de poolwervel.

Bronnen (open data, geen sleutel nodig):
  - NOAA GFS 0.25 graden op AWS: UGRD op 10 en 50 hPa, +0 t/m +384 uur per 24 uur
  - ECMWF open data (IFS HRES): u op 50 hPa, +0 t/m +240 uur per 24 uur. ECMWF publiceert geen 10 hPa in open data.

Per run: gemiddelde van u over alle lengtegraden op de rij het dichtst bij 60 N (m/s).
Negatief = oostenwind = de poolwervel is omgekeerd. Op 10 hPa in november tot en met maart heet dat een grote SSW.
Uitvoer: data/strat.json (klein; de laatste 16 runs per model en niveau, zodat de app run-tot-run kan tonen).
Een nieuwe run wordt alleen opgeslagen als hij er nog niet in staat.
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import tempfile
import traceback

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import maps  # hergebruikt http(), decode(), GFS-adressen en de ECMWF-client; de hoofdroutine daar draait niet bij importeren

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PATH = os.path.join(ROOT, 'data', 'strat.json')
LAT = 60.0
GFS_LEADS = list(range(0, 385, 24))
EC_LEADS = list(range(0, 241, 24))
KEEP = 16
log = maps.log


def zonal(msg):
    lats, lons, vals = maps.decode(msg) if isinstance(msg, (bytes, bytearray)) else msg
    j = int(np.abs(lats - LAT).argmin())
    return round(float(np.nanmean(vals[j])), 1)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:00Z')


def load():
    try:
        with open(PATH) as f:
            return json.load(f)
    except Exception:
        return {'lat': LAT, 'models': {}}


def add_run(doc, model, label, level, run, leads, values):
    m = doc['models'].setdefault(model, {'label': label, 'levels': {}})
    runs = m['levels'].setdefault(str(level), {'runs': []})['runs']
    if any(r['run'] == iso(run) for r in runs):
        return False
    runs.insert(0, {'run': iso(run), 'leads': leads, 'u': values})
    runs.sort(key=lambda r: r['run'], reverse=True)
    del runs[KEEP:]
    return True


# ---------------------------------------------------------------- GFS
def gfs_latest():
    now = dt.datetime.utcnow()
    t = now.replace(minute=0, second=0, microsecond=0)
    t = t.replace(hour=(t.hour // 6) * 6)
    for k in range(8):
        cand = t - dt.timedelta(hours=6 * k)
        url = maps.GFS.format(d=cand.strftime('%Y%m%d'), h=cand.hour, f=GFS_LEADS[-1]) + '.idx'
        if maps.exists(url):
            return cand
    return None


def gfs_step(run, step):
    base, recs = maps.gfs_records(run, step)
    out = {}
    for level in (10, 50):
        rec = next((r for r in recs if r['var'] == 'UGRD' and r['level'] == f'{level} mb'), None)
        if rec is None:
            raise KeyError(f'GFS f{step:03d}: UGRD {level} mb niet gevonden')
        out[level] = zonal(maps.gfs_get(base, rec))
    return step, out


def run_gfs(doc):
    run = gfs_latest()
    if run is None:
        raise RuntimeError('geen GFS-run gevonden')
    known = doc['models'].get('gfs', {}).get('levels', {}).get('10', {}).get('runs', [])
    if any(r['run'] == iso(run) for r in known):
        log('GFS: geen nieuwe run', iso(run))
        return False
    res = {}
    with cf.ThreadPoolExecutor(maps.WORKERS) as ex:
        for step, vals in ex.map(lambda s: gfs_step(run, s), GFS_LEADS):
            res[step] = vals
    changed = False
    for level in (10, 50):
        changed |= add_run(doc, 'gfs', 'NOAA GFS', level, run, GFS_LEADS, [res[s][level] for s in GFS_LEADS])
    log('GFS: nieuwe run', iso(run), 'u10 +0/+192/+384:', res[0][10], res[192][10], res[384][10])
    return changed


# ---------------------------------------------------------------- ECMWF
def run_ec(doc):
    run = maps.ec_latest('ifs')
    if run is None:
        raise RuntimeError('geen ECMWF-run gevonden')
    known = doc['models'].get('ec', {}).get('levels', {}).get('50', {}).get('runs', [])
    if any(r['run'] == iso(run) for r in known):
        log('ECMWF: geen nieuwe run', iso(run))
        return False
    c = maps.ec_client('ifs')
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'u50.grib')
        c.retrieve(date=int(run.strftime('%Y%m%d')), time=run.hour, stream='oper', type='fc', step=EC_LEADS,
                   param='u', levtype='pl', levelist=[50], target=path)
        fields = maps.read_grib(path)
    vals = [zonal(fields[('u', 50, s)]) for s in EC_LEADS]
    changed = add_run(doc, 'ec', 'ECMWF IFS', 50, run, EC_LEADS, vals)
    log('ECMWF: nieuwe run', iso(run), 'u50 +0/+120/+240:', vals[0], vals[5], vals[10])
    return changed


if __name__ == '__main__':
    doc = load()
    doc['lat'] = LAT
    changed, failures = False, 0
    for name, fn in (('gfs', run_gfs), ('ec', run_ec)):
        try:
            changed |= bool(fn(doc))
        except Exception as e:  # een model mag falen zonder het andere te blokkeren
            failures += 1
            log(f'{name} mislukt: {type(e).__name__}: {e}')
            traceback.print_exc()
    if changed:
        doc['updated'] = dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ')
        os.makedirs(os.path.dirname(PATH), exist_ok=True)
        with open(PATH, 'w') as f:
            json.dump(doc, f, separators=(',', ':'))
        log('data/strat.json bijgewerkt')
    sys.exit(1 if failures == 2 else 0)
