#!/usr/bin/env python3
"""Haalt de laatste ECMWF (IFS HRES) en GFS run op en bewaart compacte kaartvelden voor de app.

Bronnen (open data, geen sleutel nodig):
  - ECMWF open data (CC BY 4.0): https://data.ecmwf.int  (via het pakket ecmwf-opendata)
  - NOAA GFS 0.25 graden op AWS:  https://noaa-gfs-bdp-pds.s3.amazonaws.com

Per model en run komen er vier velden op een raster van 1 graad over Atlantisch Europa:
  z500  geopotentiaalhoogte 500 hPa      (gpm, heel getal)
  t850  temperatuur 850 hPa              (0,1 graad C)
  msl   luchtdruk op zeeniveau           (0,1 hPa)
  pr6   neerslag over de 6 uur ervoor    (0,1 mm)
De app tekent hier zelf de kaarten van en schrijft de uitleg erbij.

Uitvoer: data/maps/ec.json en data/maps/gfs.json. Sla over als de run al is opgeslagen.
"""
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

import numpy as np
from eccodes import (codes_get, codes_get_message, codes_get_values, codes_release,
                     codes_grib_new_from_file, codes_new_from_message)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'maps')

# Kaartgebied: 1 graad, noord boven. Moet overeenkomen met lib/maps.js.
LON0, LON1, LAT_N, LAT_S = -42, 32, 74, 30
LONS = np.arange(LON0, LON1 + 1, 1.0)
LATS = np.arange(LAT_N, LAT_S - 1, -1.0)
NX, NY = len(LONS), len(LATS)

LEADS = [24, 48, 72, 96, 120, 168, 240]   # uren vooruit; allemaal beschikbaar bij 00z en 12z
UA = 'winterwacht-ommen (github action; eddy dekker)'


def log(*a):
    print(dt.datetime.utcnow().strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- hulpfuncties
def http(url, rng=None, method='GET', tries=4, timeout=90):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, method=method, headers={'User-Agent': UA})
            if rng:
                req.add_header('Range', rng)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read() if method == 'GET' else r.status
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            last = e
        except Exception as e:  # netwerkfout: opnieuw proberen
            last = e
        time.sleep(3 * (i + 1))
    raise last


def exists(url):
    try:
        return http(url, method='HEAD', tries=2, timeout=30) == 200
    except Exception:
        return False


def decode(msg_bytes):
    """GRIB-bericht -> (lats, lons in -180..180, waarden [nj, ni])."""
    h = codes_new_from_message(msg_bytes)
    try:
        ni, nj = codes_get(h, 'Ni'), codes_get(h, 'Nj')
        la1, la2 = codes_get(h, 'latitudeOfFirstGridPointInDegrees'), codes_get(h, 'latitudeOfLastGridPointInDegrees')
        lo1, lo2 = codes_get(h, 'longitudeOfFirstGridPointInDegrees'), codes_get(h, 'longitudeOfLastGridPointInDegrees')
        vals = codes_get_values(h).reshape(nj, ni)
    finally:
        codes_release(h)
    if lo2 < lo1:
        lo2 += 360
    lats = np.linspace(la1, la2, nj)
    lons = ((np.linspace(lo1, lo2, ni) + 180) % 360) - 180
    return lats, lons, vals


def to_grid(lats, lons, vals, box=0):
    """Neem de waarde op elk rasterpunt (box>0: gemiddelde over +/- box gridcellen)."""
    iy = np.array([int(np.abs(lats - la).argmin()) for la in LATS])
    ix = np.array([int(np.abs(((lons - lo + 180) % 360) - 180).argmin()) for lo in LONS])
    if box <= 0:
        return vals[np.ix_(iy, ix)]
    out = np.empty((NY, NX))
    nj, ni = vals.shape
    for j, y in enumerate(iy):
        for i, x in enumerate(ix):
            cols = [(x + k) % ni for k in range(-box, box + 1)]
            out[j, i] = vals[max(0, y - box):min(nj, y + box + 1)][:, cols].mean()
    return out


def pack(arr, scale):
    a = np.nan_to_num(arr, nan=0.0)
    return [int(v) for v in np.rint(a * scale).flatten()]


def valid(fields):
    """Eenvoudige plausibiliteitscontrole, zodat een kapot veld nooit gepubliceerd wordt."""
    z, t, p, r = fields['z500'], fields['t850'], fields['msl'], fields['pr6']
    ok = 4400 < np.nanmin(z) and np.nanmax(z) < 6200 and -70 < np.nanmin(t) and np.nanmax(t) < 40
    ok = ok and 900 < np.nanmin(p) < 1100 and 900 < np.nanmax(p) < 1100 and -0.5 <= np.nanmin(r) and np.nanmax(r) < 400
    return bool(ok)


def read_existing(name):
    try:
        with open(os.path.join(OUT, name + '.json')) as f:
            return json.load(f).get('run')
    except Exception:
        return None


def save(name, payload):
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, name + '.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    os.replace(tmp, os.path.join(OUT, name + '.json'))


def payload(model, label, run, sections):
    return {
        'model': model, 'label': label,
        'run': run.strftime('%Y-%m-%dT%H:%M:00Z'),
        'made': dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:00Z'),
        'grid': {'lon0': LON0, 'lat0': LAT_N, 'd': 1, 'nx': NX, 'ny': NY},
        'leads': LEADS,
        'fields': sections,
    }


# ---------------------------------------------------------------- GFS
GFS = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{h:02d}/atmos/gfs.t{h:02d}z.pgrb2.0p25.f{f:03d}'


def gfs_latest():
    now = dt.datetime.utcnow()
    for back in range(0, 40, 6):
        t = (now - dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        t = t.replace(hour=(t.hour // 6) * 6)
        url = GFS.format(d=t.strftime('%Y%m%d'), h=t.hour, f=max(LEADS)) + '.idx'
        if exists(url):
            return t
    return None


def gfs_records(run, step):
    base = GFS.format(d=run.strftime('%Y%m%d'), h=run.hour, f=step)
    lines = http(base + '.idx').decode().strip().split('\n')
    recs = []
    for k, ln in enumerate(lines):
        p = ln.split(':')
        off = int(p[1])
        end = int(lines[k + 1].split(':')[1]) - 1 if k + 1 < len(lines) else None
        recs.append({'var': p[3], 'level': p[4], 'fc': p[5], 'off': off, 'end': end})
    return base, recs


def gfs_get(base, rec):
    rng = f"bytes={rec['off']}-{rec['end']}" if rec['end'] else f"bytes={rec['off']}-"
    return http(base, rng=rng)


def gfs_field(run, step):
    base, recs = gfs_records(run, step)

    def pick(var, level):
        for r in recs:
            if r['var'] == var and r['level'] == level:
                return r
        raise KeyError(f'GFS f{step:03d}: {var} {level} niet gevonden')

    z = decode(gfs_get(base, pick('HGT', '500 mb')))
    t = decode(gfs_get(base, pick('TMP', '850 mb')))
    p = decode(gfs_get(base, pick('PRMSL', 'mean sea level')))
    # neerslag: 6-uursvenster dat op deze stap eindigt (bv. "18-24 hour acc fcst")
    win = None
    for r in recs:
        if r['var'] == 'APCP' and r['level'] == 'surface':
            m = re.match(r'(\d+)-(\d+) hour acc fcst', r['fc'])
            if m and int(m.group(2)) == step:
                win = (int(m.group(1)), r)
    if win is None:
        raise KeyError(f'GFS f{step:03d}: APCP niet gevonden')
    start, rec = win
    la, lo, v = decode(gfs_get(base, rec))
    if step - start != 6:  # cumulatief sinds start: trek de stand van 6 uur eerder af
        base2, recs2 = gfs_records(run, step - 6)
        prev = None
        for r in recs2:
            m = re.match(r'(\d+)-(\d+) hour acc fcst', r['fc']) if r['var'] == 'APCP' else None
            if m and int(m.group(2)) == step - 6 and int(m.group(1)) == start:
                prev = r
        if prev is None:
            raise KeyError(f'GFS f{step:03d}: kan 6-uurs neerslag niet afleiden')
        v = v - decode(gfs_get(base2, prev))[2]
    return {
        'z500': pack(to_grid(*z), 1),
        't850': pack(to_grid(*t) - 273.15, 10),
        'msl': pack(to_grid(*p) / 100.0, 10),
        'pr6': pack(np.clip(to_grid(la, lo, v, box=2), 0, None), 10),
    }


def run_gfs():
    run = gfs_latest()
    if run is None:
        raise RuntimeError('geen volledige GFS-run gevonden')
    stamp = run.strftime('%Y-%m-%dT%H:%M:00Z')
    if read_existing('gfs') == stamp:
        log('GFS: run', stamp, 'staat er al in')
        return False
    log('GFS: run', stamp, 'ophalen')
    sections = {}
    for s in LEADS:
        sections[str(s)] = gfs_field(run, s)
        log(f'  GFS +{s} u klaar')
    check = {k: np.array(sections[str(LEADS[0])][k], float) / sc for k, sc in (('z500', 1), ('t850', 10), ('msl', 10), ('pr6', 10))}
    if not valid(check):
        raise RuntimeError('GFS-velden zien er onlogisch uit; niet opgeslagen')
    save('gfs', payload('gfs', 'GFS (NOAA)', run, sections))
    return True


# ---------------------------------------------------------------- ECMWF
def run_ec():
    from ecmwf_opendata import Client
    client = Client(source='ecmwf', model='ifs', resol='0p25')
    run = client.latest(type='fc', stream='oper', step=max(LEADS), param='msl', levtype='sfc')
    stamp = run.strftime('%Y-%m-%dT%H:%M:00Z')
    if read_existing('ec') == stamp:
        log('EC: run', stamp, 'staat er al in')
        return False
    log('EC: run', stamp, 'ophalen')
    date, hour = int(run.strftime('%Y%m%d')), run.hour
    sections = {}
    with tempfile.TemporaryDirectory() as tmp:
        for s in LEADS:
            target = os.path.join(tmp, f'ec{s}.grib2')
            steps = [s - 6, s]
            client.retrieve(date=date, time=hour, stream='oper', type='fc', step=steps,
                            param=['msl', 'tp'], levtype='sfc', target=target + '.sfc')
            client.retrieve(date=date, time=hour, stream='oper', type='fc', step=s,
                            param=['gh'], levtype='pl', levelist=[500], target=target + '.gh')
            client.retrieve(date=date, time=hour, stream='oper', type='fc', step=s,
                            param=['t'], levtype='pl', levelist=[850], target=target + '.t')
            got = {}
            for suffix in ('.sfc', '.gh', '.t'):
                with open(target + suffix, 'rb') as f:
                    while True:
                        h = codes_grib_new_from_file(f)
                        if h is None:
                            break
                        name, lvl, step = codes_get(h, 'shortName'), codes_get(h, 'level'), codes_get(h, 'endStep')
                        try:
                            buf = codes_get_message(h)
                        finally:
                            codes_release(h)
                        got[(name, lvl if name in ('gh', 't') else 0, int(step))] = decode(buf)
            tp_now, tp_prev = got[('tp', 0, s)], got[('tp', 0, s - 6)]
            pr = (tp_now[2] - tp_prev[2]) * 1000.0  # m -> mm
            sections[str(s)] = {
                'z500': pack(to_grid(*got[('gh', 500, s)]), 1),
                't850': pack(to_grid(*got[('t', 850, s)]) - 273.15, 10),
                'msl': pack(to_grid(*got[('msl', 0, s)]) / 100.0, 10),
                'pr6': pack(np.clip(to_grid(tp_now[0], tp_now[1], pr, box=2), 0, None), 10),
            }
            log(f'  EC +{s} u klaar')
    check = {k: np.array(sections[str(LEADS[0])][k], float) / sc for k, sc in (('z500', 1), ('t850', 10), ('msl', 10), ('pr6', 10))}
    if not valid(check):
        raise RuntimeError('EC-velden zien er onlogisch uit; niet opgeslagen')
    save('ec', payload('ec', 'ECMWF (IFS)', run, sections))
    return True


def write_status(status):
    """Korte status per model (zonder tijdstempel, zodat het alleen bij een wijziging een commit geeft)."""
    path = os.path.join(OUT, 'status.json')
    try:
        with open(path) as f:
            if json.load(f) == status:
                return
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(status, f, indent=1, ensure_ascii=False)


if __name__ == '__main__':
    failures = 0
    status = {}
    for key, fn in (('ec', run_ec), ('gfs', run_gfs)):
        try:
            fn()
            status[key] = {'ok': True, 'run': read_existing(key)}
        except Exception as e:  # een model mag falen zonder het andere te blokkeren
            failures += 1
            tb = traceback.format_exc().strip().split('\n')
            status[key] = {'ok': False, 'run': read_existing(key), 'error': f'{type(e).__name__}: {e}'[:400], 'where': tb[-3:-1]}
            log(f'{key} mislukt: {type(e).__name__}: {e}')
    write_status(status)
    sys.exit(1 if failures == 2 else 0)
