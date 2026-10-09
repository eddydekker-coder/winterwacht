// Buienradar: animatie van het afgelopen uur (RainViewer, elke 10 minuten), live in de browser.
// Geen verwachting vooruit — bewust: de trekrichting, groei en uitdoving van buien beoordeel je zelf.
// Leaflet wordt pas geladen als de radar in beeld komt, zodat de app snel opent.

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
// CARTO-sleutel van Eddy (gratis, niet-commercieel). Beperk hem in het CARTO-dashboard tot eddydekker-coder.github.io.
const CARTO_KEY = 'cb1_4f79_1_1280734b097604eca3945146';
const WINDOW_MIN = 60;          // het afgelopen uur
const FRAME_MS = 500;           // tempo van de animatie
const HOLD_MS = 1800;           // even stilstaan op het nieuwste beeld
const RINGS_KM = [10, 25, 50];  // afstandsringen om je locatie

const R = { map: null, layers: new Map(), frames: [], idx: 0, playing: true, timer: null, loc: null, marker: null, rings: [], host: '', els: null, lastFetch: 0 };

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = LEAFLET_JS; s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Kaartbibliotheek niet geladen'));
    document.head.appendChild(s);
  });
}

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

// Elk beeld heeft een sleutel, een tijd (Unix-seconden) en een eigen kaartlaag.
function layerFor(frame) {
  if (R.layers.has(frame.key)) return R.layers.get(frame.key);
  const L = window.L;
  const layer = L.tileLayer(`${R.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      tileSize: 256, maxNativeZoom: 7, maxZoom: 11, opacity: 0, zIndex: 10,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    });
  layer.addTo(R.map);
  R.layers.set(frame.key, layer);
  return layer;
}

function show(i) {
  if (!R.frames.length) return;
  R.idx = (i + R.frames.length) % R.frames.length;
  R.frames.forEach((f, k) => { const l = R.layers.get(f.key); if (l) l.setOpacity(k === R.idx ? 0.8 : 0); });
  const f = R.frames[R.idx], newest = R.frames[R.frames.length - 1];
  const ago = Math.round((newest.time - f.time) / 60);
  R.els.time.textContent = hhmm(f.time);
  R.els.ago.textContent = ago === 0 ? 'nieuwste beeld' : `${ago} min eerder`;
  R.els.slider.value = String(R.idx);
  R.els.slider.setAttribute('aria-valuetext', `${hhmm(f.time)}, ${R.els.ago.textContent}`);
}

function tick() {
  clearTimeout(R.timer);
  if (!R.playing || !R.frames.length) return;
  const last = R.idx === R.frames.length - 1;
  R.timer = setTimeout(() => { show(R.idx + 1); tick(); }, last ? HOLD_MS : FRAME_MS);
}

function setPlaying(on) {
  R.playing = on;
  R.els.play.setAttribute('aria-pressed', String(on));
  R.els.play.setAttribute('aria-label', on ? 'Pauzeer animatie' : 'Speel animatie af');
  R.els.play.innerHTML = on
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7Z" fill="currentColor"/></svg>';
  tick();
}

async function rainviewerFrames() {
  const res = await fetch(`${FRAMES_URL}?t=${Math.floor(Date.now() / 60e3)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  R.host = data.host;
  const past = data.radar?.past || [];
  if (!past.length) throw new Error('geen beelden');
  const newest = past[past.length - 1].time;
  return past.filter((f) => f.time >= newest - WINDOW_MIN * 60).map((f) => ({ src: 'rv', key: f.path, path: f.path, time: f.time }));
}

async function fetchFrames(force = false) {
  if (!force && Date.now() - R.lastFetch < 2 * 60e3 && R.frames.length) return;
  R.els.status.textContent = '';
  let frames = null;
  try { frames = await rainviewerFrames(); } catch { frames = null; }
  if (!frames?.length) {
    R.els.status.textContent = 'De radarbeelden zijn nu niet op te halen. Probeer het later opnieuw.';
    return;
  }
  const keep = new Set(frames.map((f) => f.key));
  for (const [k, l] of R.layers) if (!keep.has(k)) { R.map.removeLayer(l); R.layers.delete(k); }
  R.frames = frames;
  frames.forEach(layerFor);
  R.els.slider.max = String(frames.length - 1);
  R.lastFetch = Date.now();
  show(frames.length - 1);
  tick();
  const age = Math.round((Date.now() / 1000 - frames[frames.length - 1].time) / 60);
  if (age > 25) R.els.status.textContent = `Let op: het nieuwste radarbeeld is ${age} minuten oud.`;
}

function placeLocation(loc) {
  const L = window.L;
  R.loc = loc;
  R.rings.forEach((r) => R.map.removeLayer(r));
  R.rings = RINGS_KM.map((km) => L.circle([loc.lat, loc.lon], {
    radius: km * 1000, color: '#a9dcff', weight: 1, opacity: 0.55, fill: false, dashArray: '3 5', interactive: false,
  }).addTo(R.map));
  if (R.marker) R.map.removeLayer(R.marker);
  R.marker = L.circleMarker([loc.lat, loc.lon], { radius: 5, color: '#0b2138', weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(R.map);
  R.map.setView([loc.lat, loc.lon], 8, { animate: false });
}

async function build(container, loc) {
  const L = await loadLeaflet();
  R.map = L.map(container, {
    zoomControl: true, attributionControl: true, scrollWheelZoom: false,
    minZoom: 5, maxZoom: 11, zoomSnap: 0.5,
  });
  R.map.attributionControl.setPrefix(false);
  // CARTO donker (met sleutel), plaatsnamen in een eigen laag bovenop de radar.
  // Valt CARTO uit, dan schakelen we automatisch over op een donker gemaakte OpenStreetMap.
  const carto = (style) => `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;
  const base = L.tileLayer(carto('dark_nolabels'), {
    subdomains: 'abcd', maxZoom: 11,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  }).addTo(R.map);
  const labelPane = R.map.createPane('labels');
  labelPane.style.zIndex = 450; labelPane.style.pointerEvents = 'none';
  const labels = L.tileLayer(carto('dark_only_labels'), { subdomains: 'abcd', maxZoom: 11, pane: 'labels' }).addTo(R.map);
  let ok = 0, bad = 0;
  base.on('tileload', () => { ok++; });
  base.on('tileerror', () => {
    if (++bad < 3 || ok > 0) return;
    R.map.removeLayer(base); R.map.removeLayer(labels);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 11, className: 'osm-dark',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(R.map);
  });
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(R.map);
  placeLocation(loc);
  await fetchFrames(true);
}

// Publieke functies -------------------------------------------------------
export function initRadar(els, getLoc) {
  R.els = els;
  els.play.addEventListener('click', () => setPlaying(!R.playing));
  els.slider.addEventListener('input', () => { setPlaying(false); show(Number(els.slider.value)); });
  els.prev.addEventListener('click', () => { setPlaying(false); show(R.idx - 1); });
  els.next.addEventListener('click', () => { setPlaying(false); show(R.idx + 1); });
  els.center.addEventListener('click', () => R.loc && R.map?.setView([R.loc.lat, R.loc.lon], 8));
  setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Pas bouwen als de radar bijna in beeld is
  let started = false;
  const start = () => {
    if (started) return; started = true;
    build(els.map, getLoc()).catch(() => { els.status.textContent = 'De kaart kon niet worden geladen. Controleer je verbinding.'; });
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ent) => { if (ent.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
    io.observe(els.map);
  } else start();

  // Ververs elke 2,5 minuut zolang de app open is (zo mis je geen nieuw beeld); pauzeer als de app op de achtergrond staat
  setInterval(() => { if (!document.hidden && R.map) fetchFrames(true); }, 2.5 * 60e3);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(R.timer);
    else if (R.map) { fetchFrames(); tick(); }
  });
}

export function radarLocation(loc) {
  if (R.map && window.L) { placeLocation(loc); fetchFrames(true); }
}
export function radarRefresh() { if (R.map) fetchFrames(true); }
