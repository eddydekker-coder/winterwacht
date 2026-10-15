#!/usr/bin/env python3
"""Haalt de laatste AIFS-, ECMWF- (IFS HRES) en GFS-run op en bewaart compacte kaartvelden voor de app.

Bronnen (open data, geen sleutel nodig):
  - ECMWF open data (CC BY 4.0): IFS HRES en AIFS single, via het pakket ecmwf-opendata
  - NOAA GFS 0.25 graden op AWS (publiek domein)

Per model en run, op een raster van 1 graad over Atlantisch Europa, voor +24 t/m +240 uur:
  z500  geopotentiaalhoogte 500 hPa (gpm)      t850  temperatuur 850 hPa (0,1 C)
  msl   luchtdruk zeeniveau (0,1 hPa)           pr6   neerslag over de 6 uur ervoor (0,1 mm)
  t2m   temperatuur 2 m (0,1 C)                 u10, v10  wind op 10 m (0,1 m/s)
Plus 'prev': dezelfde run 12 uur eerder, op dezelfde geldigheidstijd (z500, t850, msl), zodat de app
run-tot-run verschillen kan tekenen.

Opslag: delta-gecodeerd per rij (eerste waarde absoluut, daarna verschil met de buurman), klein en vloeiend.
Uitvoer: $MAPS_OUT (standaard maps-out/) met aifs.json, ec.json, gfs.json, status.json.
De workflow publiceert die map op de aparte tak maps-data, zodat de hoofdtak niet groeit.
"""
import concurrent.futures as cf
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
OUT = os.environ.get('MAPS_OUT') or os.path.join(ROOT, 'maps-out')
VERSION = 2

# Kaartgebied: 1 graad, noord boven. Moet overeenkomen met lib/maps.js.
LON0, LON1, LAT_N, LAT_S = -42, 32, 74, 30
LONS = np.arange(LON0, LON1 + 1, 1.0)
LATS = np.arange(LAT_N, LAT_S - 1, -1.0)
NX, NY = len(LONS), len(LATS)

LEADS = [24, 48, 72, 96, 120, 168, 240]   # uren vooruit (alle beschikbaar bij 00z en 12z)
PREV_SHIFT = 12                            # vorige run = 12 uur eerder
PREV_LEADS = list(LEADS)
UA = 'winterwacht-ommen (github action; eddy dekker)'
WORKERS = 6


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


def to_grid(msg, box=0):
    """Neem de waarde op elk rasterpunt (box>0: gemiddelde over +/- box gridcellen)."""
    lats, lons, vals = msg
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
    """Gehele getallen, per rij delta-gecodeerd (eerste waarde absoluut)."""
    q = np.rint(np.nan_to_num(arr, nan=0.0) * scale).astype(np.int64)
    d = q.copy()
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    return d.flatten().tolist()


def physical(fields):
    return {'z500': fields['z500'], 't850': fields['t850'], 'msl': fields['msl'], 'pr6': fields['pr6'],
            't2m': fields['t2m'], 'u10': fields['u10'], 'v10': fields['v10']}


SCALES = {'z500': 1, 't850': 10, 'msl': 10, 'pr6': 10, 't2m': 10, 'u10': 10, 'v10': 10}


def pack_fields(fields):
    return {k: pack(v, SCALES[k]) for k, v in fields.items()}


def valid(f):
    ok = 4400 < np.nanmin(f['z500']) and np.nanmax(f['z500']) < 6200 and -70 < np.nanmin(f['t850']) and np.nanmax(f['t850']) < 40
    ok = ok and 900 < np.nanmin(f['msl']) and np.nanmax(f['msl']) < 1100
    if 'pr6' in f:
        ok = ok and -0.5 <= np.nanmin(f['pr6']) and np.nanmax(f['pr6']) < 400
        ok = ok and -50 < np.nanmin(f['t2m']) and np.nanmax(f['t2m']) < 50 and np.nanmax(np.abs(f['u10'])) < 90 and np.nanmax(np.abs(f['v10'])) < 90
    return bool(ok)


def read_existing(name):
    try:
        with open(os.path.join(OUT, name + '.json')) as f:
            j = json.load(f)
        return j.get('run') if j.get('v') == VERSION else None
    except Exception:
        return None


def save(name, payload):
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, name + '.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    os.replace(tmp, os.path.join(OUT, name + '.json'))
    open(os.path.join(OUT, '.updated'), 'w').write(name)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:00Z')


# ---------------------------------------------------------------- GFS
GFS = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{h:02d}/atmos/gfs.t{h:02d}z.pgrb2.0p25.f{f:03d}'


def gfs_latest():
    now = dt.datetime.utcnow()
    for back in range(0, 72, 12):  # alleen 00z en 12z: dan delen alle modellen dezelfde runtijd
        t = (now - dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        t = t.replace(hour=(t.hour // 12) * 12)
        if exists(GFS.format(d=t.strftime('%Y%m%d'), h=t.hour, f=max(LEADS)) + '.idx'):
            return t
    return None


def gfs_records(run, step):
    base = GFS.format(d=run.strftime('%Y%m%d'), h=run.hour, f=step)
    lines = http(base + '.idx').decode().strip().split('\n')
    recs = []
    for k, ln in enumerate(lines):
        p = ln.split(':')
        end = int(lines[k + 1].split(':')[1]) - 1 if k + 1 < len(lines) else None
        recs.append({'var': p[3], 'level': p[4], 'fc': p[5], 'off': int(p[1]), 'end': end})
    return base, recs


def gfs_get(base, rec):
    rng = f"bytes={rec['off']}-{rec['end']}" if rec['end'] else f"bytes={rec['off']}-"
    return http(base, rng=rng)


def gfs_download(run, step, full):
    """Ruwe GRIB-berichten (bytes); decoderen gebeurt later in de hoofdthread."""
    base, recs = gfs_records(run, step)

    def pick(var, level):
        for r in recs:
            if r['var'] == var and r['level'] == level:
                return r
        raise KeyError(f'GFS f{step:03d}: {var} {level} niet gevonden')

    out = {'z500': gfs_get(base, pick('HGT', '500 mb')), 't850': gfs_get(base, pick('TMP', '850 mb')),
           'msl': gfs_get(base, pick('PRMSL', 'mean sea level'))}
    if not full:
        return out
    out['t2m'] = gfs_get(base, pick('TMP', '2 m above ground'))
    out['u10'] = gfs_get(base, pick('UGRD', '10 m above ground'))
    out['v10'] = gfs_get(base, pick('VGRD', '10 m above ground'))
    win = None
    for r in recs:
        if r['var'] == 'APCP' and r['level'] == 'surface':
            m = re.match(r'(\d+)-(\d+) hour acc fcst', r['fc'])
            if m and int(m.group(2)) == step:
                win = (int(m.group(1)), r)
    if win is None:
        raise KeyError(f'GFS f{step:03d}: APCP niet gevonden')
    start, rec = win
    out['pr_now'] = gfs_get(base, rec)
    if step - start != 6:  # cumulatief sinds start: trek de stand van 6 uur eerder af
        base2, recs2 = gfs_records(run, step - 6)
        prev = None
        for r in recs2:
            m = re.match(r'(\d+)-(\d+) hour acc fcst', r['fc']) if r['var'] == 'APCP' else None
            if m and int(m.group(2)) == step - 6 and int(m.group(1)) == start:
                prev = r
        if prev is None:
            raise KeyError(f'GFS f{step:03d}: kan 6-uurs neerslag niet afleiden')
        out['pr_prev'] = gfs_get(base2, prev)
    return out


def gfs_decode(raw, full):
    f = {'z500': to_grid(decode(raw['z500'])), 't850': to_grid(decode(raw['t850'])) - 273.15, 'msl': to_grid(decode(raw['msl'])) / 100.0}
    if full:
        f['t2m'] = to_grid(decode(raw['t2m'])) - 273.15
        f['u10'] = to_grid(decode(raw['u10']))
        f['v10'] = to_grid(decode(raw['v10']))
        la, lo, v = decode(raw['pr_now'])
        if 'pr_prev' in raw:
            v = v - decode(raw['pr_prev'])[2]
        f['pr6'] = np.clip(to_grid((la, lo, v), box=2), 0, None)
    return f


# ---------------------------------------------------------------- ECMWF (IFS HRES en AIFS single)
def ec_client(model):
    from ecmwf.opendata import Client
    return Client(source=os.environ.get('ECMWF_SOURCE', 'ecmwf'), model=model, resol='0p25', maximum_retries=3, retry_after=10)


def ec_latest(model):
    c = ec_client(model)
    req = dict(type='fc', stream='oper', step=max(LEADS) + PREV_SHIFT, param='msl', levtype='sfc')
    cands = []
    for hour in (0, 12):  # alleen 00z en 12z: HRES gaat alleen dan tot +240 u en alle modellen delen zo de runtijd
        try:
            cands.append(c.latest(time=hour, **req))
        except Exception:
            pass
    return max(cands) if cands else None


def ec_download(model, run, step, full, tmp):
    """Haalt de GRIB-bestanden voor een stap op; geeft paden terug."""
    c = ec_client(model)
    date, hour = int(run.strftime('%Y%m%d')), run.hour
    base = dict(date=date, time=hour, stream='oper', type='fc')
    tag = f'{model}_{run:%Y%m%d%H}_{step}_{"f" if full else "p"}'
    paths = {}
    p = os.path.join(tmp, tag + '.pl')
    c.retrieve(step=step, param=['gh', 't'], levtype='pl', levelist=[500, 850], target=p, **base)
    paths['pl'] = p
    p = os.path.join(tmp, tag + '.sfc')
    params = ['msl', '2t', '10u', '10v'] if full else ['msl']
    c.retrieve(step=step, param=params, levtype='sfc', target=p, **base)
    paths['sfc'] = p
    if full:
        p = os.path.join(tmp, tag + '.tp')
        c.retrieve(step=[step - 6, step], param=['tp'], levtype='sfc', target=p, **base)
        paths['tp'] = p
    return paths


def read_grib(path):
    out = {}
    with open(path, 'rb') as f:
        while True:
            h = codes_grib_new_from_file(f)
            if h is None:
                break
            try:
                pl = codes_get(h, 'typeOfLevel') == 'isobaricInhPa'
                key = (codes_get(h, 'shortName'), int(codes_get(h, 'level')) if pl else 0, int(codes_get(h, 'endStep')))
                out[key] = decode(codes_get_message(h))
            finally:
                codes_release(h)
    return out


def ec_decode(paths, step, full):
    pl = read_grib(paths['pl'])
    sfc = read_grib(paths['sfc'])
    f = {'z500': to_grid(pl[('gh', 500, step)]), 't850': to_grid(pl[('t', 850, step)]) - 273.15, 'msl': to_grid(sfc[('msl', 0, step)]) / 100.0}
    if full:
        f['t2m'] = to_grid(sfc[('2t', 0, step)]) - 273.15
        f['u10'] = to_grid(sfc[('10u', 0, step)])
        f['v10'] = to_grid(sfc[('10v', 0, step)])
        tp = read_grib(paths['tp'])
        now, before = tp[('tp', 0, step)], tp[('tp', 0, step - 6)]
        f['pr6'] = np.clip(to_grid((now[0], now[1], (now[2] - before[2]) * 1000.0), box=2), 0, None)  # m -> mm
    return f


# ---------------------------------------------------------------- per model
def run_model(key, label, latest, download, decoder):
    run = latest()
    if run is None:
        raise RuntimeError('geen volledige run gevonden')
    stamp = iso(run)
    if read_existing(key) == stamp:
        log(f'{key}: run {stamp} staat er al in')
        return False
    prev_run = run - dt.timedelta(hours=PREV_SHIFT)
    log(f'{key}: run {stamp} ophalen (vorige run {iso(prev_run)})')
    jobs = [(run, s, s, True) for s in LEADS] + [(prev_run, s + PREV_SHIFT, s, False) for s in PREV_LEADS]
    raws = {}
    with tempfile.TemporaryDirectory() as tmp:
        def task(job):
            r, step, lead, full = job
            try:
                return job, download(r, step, full, tmp), None
            except Exception as e:  # vorige run mag ontbreken; de nieuwste run niet
                return job, None, e
        with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for job, got, err in ex.map(task, jobs):
                raws[job] = (got, err)
                if err is None:
                    log(f'  {key} {"run" if job[3] else "vorige"} +{job[1]} u binnen')
        sections, prev = {}, {}
        for job, (got, err) in raws.items():
            r, step, lead, full = job
            if err is not None:
                if full:
                    raise err
                log(f'  {key} vorige run +{step} u overgeslagen: {type(err).__name__}: {err}')
                continue
            f = decoder(got, step, full)
            (sections if full else prev)[str(lead)] = f
    first = sections[str(LEADS[0])]
    if not valid(first):
        raise RuntimeError('velden zien er onlogisch uit; niet opgeslagen')
    payload = {
        'v': VERSION, 'model': key, 'label': label, 'run': stamp, 'made': iso(dt.datetime.utcnow()),
        'grid': {'lon0': LON0, 'lat0': LAT_N, 'd': 1, 'nx': NX, 'ny': NY},
        'leads': LEADS, 'enc': 'd1',
        'fields': {l: pack_fields(f) for l, f in sections.items()},
    }
    if prev:
        payload['prev'] = {'run': iso(prev_run), 'fields': {l: pack_fields(f) for l, f in prev.items()}}
    save(key, payload)
    return True


def gfs_dl(run, step, full, tmp):
    return gfs_download(run, step, full)


def run_gfs():
    return run_model('gfs', 'GFS (NOAA)', gfs_latest, gfs_dl, lambda raw, step, full: gfs_decode(raw, full))


def make_ec(model, key, label):
    def dl(run, step, full, tmp):
        return ec_download(model, run, step, full, tmp)
    return lambda: run_model(key, label, lambda: ec_latest(model), dl, lambda paths, step, full: ec_decode(paths, step, full))


def write_status(status):
    """Korte status per model (zonder tijdstempel, zodat het alleen bij een wijziging iets verandert)."""
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
    open(os.path.join(OUT, '.updated'), 'w').write('status')


if __name__ == '__main__':
    failures = 0
    status = {}
    models = (('aifs', make_ec('aifs-single', 'aifs', 'AIFS (ECMWF)')), ('ec', make_ec('ifs', 'ec', 'ECMWF (IFS)')), ('gfs', run_gfs))
    for key, fn in models:
        try:
            fn()
            status[key] = {'ok': True, 'run': read_existing(key)}
        except Exception as e:  # een model mag falen zonder de andere te blokkeren
            failures += 1
            tb = traceback.format_exc().strip().split('\n')
            status[key] = {'ok': False, 'run': read_existing(key), 'error': f'{type(e).__name__}: {e}'[:400], 'where': tb[-3:-1]}
            log(f'{key} mislukt: {type(e).__name__}: {e}')
    write_status(status)
    sys.exit(1 if failures == len(models) else 0)
