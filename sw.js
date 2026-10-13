// Keeps the companion itself on the phone, so it opens with no network. The network copy wins
// when there is one; the kept copy answers when there is none. The articles are not here: they
// live in the phone's database (see app.js).
const KEPT = "desk-companion-6";
const SHELL = ["./", "app.js", "css/fonts.css", "css/theme.css", "css/mobile.css", "marked.min.js", "fonts/DepartureMono-Regular.woff2", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => e.waitUntil(caches.open(KEPT).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(n => n !== KEPT).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // the desk is not ours to keep
  const key = url.pathname.endsWith("/") ? "./" : url.pathname.replace(new URL("./", location).pathname, ""); // a shared link's "?url=…" opens the same page
  // "no-cache": ask the site each time whether the file changed, so a new version shows at once
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(KEPT).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key)));
});
