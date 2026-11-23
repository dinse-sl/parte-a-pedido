/* Parte a Pedido · guarda la web en el móvil para que abra sin cobertura.
   - La app (index.html, scripts): se pide a la red y, si no hay, se usa la copia guardada.
   - El mapa y las librerías externas: se usan de la copia guardada y solo se piden si faltan.
   - El servidor de Google (datos, fotos, Gemini) no pasa por aquí: lo gestiona claude-fuera.js. */
const VERSION = 'pap-v1';
const BASICOS = ['./', 'index.html', 'claude-fuera.js', 'config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('pap-v') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function guardar(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)).catch(() => {}); }
  return res;
}
/* red primero, con un límite de tiempo para cuando hay cobertura muy mala */
function redPrimero(req) {
  const red = fetch(req).then(res => guardar(req, res));
  const espera = new Promise((_, ko) => setTimeout(() => ko(new Error('lento')), 6000));
  return Promise.race([red, espera]).catch(() =>
    caches.match(req, {ignoreSearch: true}).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : null)).then(m => m || red));
}
function cachePrimero(req) {
  return caches.match(req).then(m => m || fetch(req).then(res => guardar(req, res)));
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (/(^|\.)google(usercontent)?\.com$/.test(u.hostname) || u.pathname.startsWith('/__catalogo/')) return;
  if (u.origin === self.location.origin) {
    e.respondWith(u.pathname.includes('/mapa/') ? cachePrimero(r) : redPrimero(r));
  } else if (/(^|\.)(cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)) {
    e.respondWith(cachePrimero(r));
  }
});
