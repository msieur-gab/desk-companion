// Keeps the companion itself on the phone, so it opens with no network. The network copy wins
// when there is one; the kept copy answers when there is none. The articles are not here: they
// live in the phone's database (see app.js).
importScripts("db.js"); // what the phone keeps: the files shared from other apps go there
const KEPT = "desk-companion-38";
const SHELL = ["./", "app.js", "css/fonts.css", "css/theme.css", "css/mobile.css", "marked.min.js", "db.js", "trust.js", "fonts/DepartureMono-Regular.woff2", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => e.waitUntil(caches.open(KEPT).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(n => n !== KEPT).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname.endsWith("/share")) return e.respondWith(shared(e.request));
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // the desk is not ours to keep
  const key = url.pathname.endsWith("/") ? "./" : url.pathname.replace(new URL("./", location).pathname, ""); // a shared link's "?url=…" opens the same page
  // "no-cache": ask the site each time whether the file changed, so a new version shows at once
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(KEPT).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key)));
});

// Something shared from another app (the manifest's share target): files wait here for the desk's inbox,
// a link joins the waiting links as before. The page opens after, says what was kept, and the next sync
// hands it all over. GitHub Pages has no server: if this doesn't answer, the share is lost.
async function shared(request) {
  let files = 0, links = 0;
  try {
    const form = await request.formData(), now = Date.now();
    for (const [i, f] of form.getAll("files").entries()) {
      if (!(f instanceof File) || !f.size) continue;
      await put("files", { id: now + "-" + i, name: f.name || "shared file", type: f.type, size: f.size, modified: f.lastModified || now, blob: f, at: now });
      files++;
    }
    const link = /https?:\/\/\S+/.exec([form.get("url"), form.get("text")].filter(Boolean).join(" "));
    if (link && !files) { // a file shared with its page's address is the file; the address alone is a link
      await put("waiting", { url: link[0], title: String(form.get("title") || "").trim(), at: now });
      links++;
    }
  } catch { /* nothing kept: the page says so */ }
  return Response.redirect("./?shared=" + files + "&links=" + links, 303);
}
