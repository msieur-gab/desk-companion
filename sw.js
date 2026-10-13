// Keeps the page itself on the phone, so it opens with no network. The network copy wins when
// there is one; the kept copy answers when there is none.
const KEPT = "desk-companion-1";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => e.waitUntil(caches.open(KEPT).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(n => n !== KEPT).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // the desk is not ours to keep
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(KEPT).then(c => c.put(url.pathname.endsWith("/") ? "./" : e.request, copy));
    return r;
  }).catch(() => caches.match(url.pathname.endsWith("/") ? "./" : e.request)));
});
