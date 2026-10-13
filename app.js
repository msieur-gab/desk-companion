// The desk's companion. Three places: the Library (articles kept on this phone, readable with
// no network), Waiting (links shared to it, until the desk has turned them into articles), and
// Desk (where the desk is, how it is doing, and the sync). The desk does the work on a link;
// the phone only carries it there and brings the article back.

const page = document.getElementById("page"), note = document.getElementById("note");
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const say = text => { note.textContent = text; };

// ---- what the phone keeps: articles, waiting links, and a few settings (IndexedDB) ----
const db = new Promise((ok, no) => {
  const r = indexedDB.open("desk", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("articles", { keyPath: "file" });
    r.result.createObjectStore("waiting", { keyPath: "url" });
    r.result.createObjectStore("settings");
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const store = async (name, mode, work) => {
  const t = (await db).transaction(name, mode), s = t.objectStore(name), asked = work(s);
  return new Promise((ok, no) => { t.oncomplete = () => ok(asked?.result); t.onerror = () => no(t.error); });
};
const all = name => store(name, "readonly", s => s.getAll());
const put = (name, value, key) => store(name, "readwrite", s => s.put(value, key));
const drop = (name, key) => store(name, "readwrite", s => s.delete(key));
const setting = key => store("settings", "readonly", s => s.get(key));

// ---- the desk, over the local network (plain http: it has no name the world knows) ----
async function desk(path, body) {
  const at = await setting("desk");
  if (!at) throw new Error("no desk address yet");
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), body ? 45000 : 8000);
  try {
    const r = await fetch("http://" + at + path, { signal: stop.signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "the desk answered " + r.status), { refused: r.status === 422 });
    return data;
  } catch (e) {
    throw e.refused !== undefined ? e : Object.assign(new Error("the desk is out of reach"), { away: true });
  } finally { clearTimeout(timer); }
}

// hand the waiting links over, then bring back the articles this phone doesn't have yet
let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const links = (await all("waiting")).filter(w => !w.why);
    for (const [i, w] of links.entries()) {
      say("The desk is reading " + (i + 1) + " of " + links.length + "…");
      try {
        await desk("/api/articles", { url: w.url });
        await drop("waiting", w.url);
      } catch (e) {
        if (!e.refused) throw e;
        await put("waiting", { ...w, why: e.message }); // a paywall, a page with no article: it stays, with the reason
      }
    }
    say("Looking at what the desk keeps…");
    const have = new Set((await all("articles")).map(a => a.file));
    const fresh = (await desk("/api/articles")).articles.filter(a => !have.has(a.file));
    for (const [i, card] of fresh.entries()) {
      say("Bringing article " + (i + 1) + " of " + fresh.length + "…");
      const { text } = await desk("/api/fs/read?path=" + encodeURIComponent("Articles/" + card.file));
      await put("articles", { ...card, text });
    }
    await put("settings", Date.now(), "synced");
    say(fresh.length ? fresh.length + " new on the phone." : "Up to date with the desk.");
  } catch (e) {
    say(e.away ? "The desk is out of reach. What is here stays readable; links wait." : "Sync stopped: " + e.message + ".");
  } finally {
    syncing = false;
    show(view);
  }
}

// ---- the three places ----
let view = "library";
const places = {
  async library() {
    const kept = (await all("articles")).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    page.replaceChildren(el("h3", "", "ARTICLES ON THIS PHONE"));
    if (!kept.length) page.append(el("p", "muted", "Nothing here yet. Share a link to “desk” from any app, then sync when the desk is in reach."));
    for (const a of kept) {
      const row = el("button", "row");
      row.append(el("span", "", a.title || a.file), el("small", "", [a.siteName, a.author, a.published].filter(Boolean).join(" · ")));
      row.addEventListener("click", () => read(a));
      page.append(row);
    }
  },
  async waiting() {
    const links = (await all("waiting")).sort((a, b) => b.at - a.at);
    page.replaceChildren(el("h3", "", "LINKS WAITING FOR THE DESK"));
    if (!links.length) page.append(el("p", "muted", "No link is waiting."));
    for (const w of links) {
      const row = el("div", "row" + (w.why ? " refused" : ""));
      row.append(el("span", "", w.title || w.url), el("small", "", w.url));
      if (w.why) row.append(el("small", "", "Not kept: " + w.why + "."));
      const away = el("button", "", "Remove");
      away.addEventListener("click", async () => { await drop("waiting", w.url); show("waiting"); });
      row.append(away);
      page.append(row);
    }
    if (links.some(w => !w.why)) page.append(Object.assign(el("button", "", "Hand over to the desk now"), { onclick: sync }));
  },
  async desk() {
    const at = await setting("desk"), synced = await setting("synced");
    const form = el("form", "bar");
    form.innerHTML = `<input name="at" placeholder="desk.lan or 192.168.1.20" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="The desk's address"><button>Save</button>`;
    form.at.value = at || "";
    form.addEventListener("submit", async e => {
      e.preventDefault();
      await put("settings", form.at.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""), "desk");
      show("desk");
    });
    page.replaceChildren(el("h3", "", "WHERE THE DESK IS"), form);
    if (!at) return page.append(el("p", "muted", "Type the address the desk has on this network. At home that is its name on the router; elsewhere, the address its WiFi screen shows."));
    const board = el("div");
    page.append(Object.assign(el("button", "", "Sync with the desk"), { onclick: sync }),
      el("p", "muted", synced ? "Last synced " + new Date(synced).toLocaleString() + "." : "Never synced yet."),
      el("h3", "", "HOW IT IS DOING"), board,
      Object.assign(el("a", "row", "Open the desk itself"), { href: "http://" + at + "/", target: "_blank", rel: "noopener" }));
    board.append(el("p", "muted", "Asking…"));
    try {
      const s = await desk("/api/status"), gb = n => (n / 1073741824).toFixed(1) + " GB", h = Math.floor(s.uptime / 3600);
      const pairs = [["Name", s.host], ["Temperature", s.temp == null ? "no sensor" : s.temp + " °C"],
        ["Memory", gb(s.memory.used) + " of " + gb(s.memory.total)], ["Disk", gb(s.disk.used) + " of " + gb(s.disk.total)],
        ["Load", Math.round(100 * s.load[0] / s.cores) + "%"], ["Running for", (h >= 24 ? Math.floor(h / 24) + " d " : "") + (h % 24) + " h " + Math.floor(s.uptime % 3600 / 60) + " min"]];
      if (view === "desk") board.replaceChildren(...pairs.map(([k, v]) => { const p = el("div", "pair"); p.append(el("span", "", k), el("span", "", v)); return p; }));
    } catch (e) {
      if (view === "desk") board.replaceChildren(el("p", "muted", e.away ? "Out of reach from here." : e.message + "."));
    }
  },
};

async function show(name) {
  view = name;
  const count = (await all("waiting")).length;
  for (const b of document.querySelectorAll("nav button")) {
    b.setAttribute("aria-pressed", b.dataset.view === name);
    if (b.dataset.view === "waiting") b.textContent = "Waiting" + (count ? " " + count : "");
  }
  page.scrollTop = 0;
  await places[name]();
}
document.querySelector("nav").addEventListener("click", e => { if (e.target.dataset.view) show(e.target.dataset.view); });

// ---- one article: the front matter is the desk's (title, author, siteName, cover…), then markdown ----
function read(a) {
  view = "reading";
  const body = a.text.replace(/^---\n[\s\S]*?\n---\n?/, ""), box = el("div");
  box.innerHTML = window.marked.parse(body, { gfm: true });
  box.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach(e => e.remove()); // it came from the web
  for (const e of box.querySelectorAll("*")) {
    for (const at of [...e.attributes]) if (/^on/i.test(at.name) || (/^(href|src)$/.test(at.name) && /^\s*javascript:/i.test(at.value))) e.removeAttribute(at.name);
    if (e.tagName === "A") Object.assign(e, { target: "_blank", rel: "noopener noreferrer" });
    if (e.tagName === "IMG") Object.assign(e, { loading: "lazy", referrerPolicy: "no-referrer" });
  }
  const art = el("article");
  art.append(el("h1", "", a.title || a.file), el("p", "by", [a.author, a.siteName, a.published].filter(Boolean).join(" · ")));
  if (a.cover && !body.includes(a.cover.split("?")[0])) art.append(Object.assign(el("img"), { src: a.cover, alt: "", referrerPolicy: "no-referrer" }));
  art.append(...box.childNodes);
  if (a.url) { const p = el("p", "by"); p.append(Object.assign(el("a", "", "The page this was kept from"), { href: a.url, target: "_blank", rel: "noopener noreferrer" })); art.append(p); }
  page.replaceChildren(art);
  page.scrollTop = 0;
  for (const b of document.querySelectorAll("nav button")) b.setAttribute("aria-pressed", false);
}

// ---- start: a link shared from another app arrives in the address; it joins the waiting ones ----
(async () => {
  navigator.serviceWorker?.register("sw.js").catch(() => {});
  navigator.storage?.persist?.(); // ask the phone not to clean the articles away
  const got = new URLSearchParams(location.search);
  const link = /https?:\/\/\S+/.exec([got.get("url"), got.get("text")].filter(Boolean).join(" "));
  if (link) {
    await put("waiting", { url: link[0], title: (got.get("title") || "").trim(), at: Date.now() });
    history.replaceState(null, "", location.pathname); // a reload doesn't add it twice
    await show("waiting");
    say("Kept for the desk.");
  } else await show("library");
  if (await setting("desk")) sync(); // quietly, whenever it is opened in reach of the desk
})();
