// The desk's companion on the phone. The look is symbios's mobile shell (status bar, springboard,
// panes sliding in; css/mobile.css unchanged); the code is its own and small. Seven apps: Reader (articles kept on this
// phone, readable with no network), Shared (links shared to it, waiting for the desk), Memos (voice notes
// recorded here; the ones kept go to the desk's inbox, which writes their text), Monitor
// (how the desk is doing), Remote (the phone as the desk's trackpad), Slides (the phone as the clicker
// of a deck on the desk, with the notes and the next slide) and Settings (where the desk is, sync, install). The desk does the
// work on a link; the phone only carries it there and brings the article back.

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const text = (tag, cls, t) => Object.assign(el(tag, cls), { textContent: t ?? "" });
// a short message over everything, as symbios mobile shows them
const toast = (msg, ok) => {
  const t = text("div", "m-toast", msg);
  t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99999;padding:10px 16px;border-radius:10px;font-size:13px;max-width:84%;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.45);background:" + (ok === false ? "#664400" : "var(--accent,#0f0)") + ";color:var(--bg,#000)";
  document.body.append(t);
  setTimeout(() => t.remove(), 3400);
};

// icons: symbios mobile's 1-bit line glyphs
const I = {
  reader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h7v14H4zM13 5h7v14h-7"/><path d="M6.5 8.5h2M6.5 11h2M15.5 8.5h2M15.5 11h2"/></svg>',
  status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 13h4l2 5 4-12 2 7h6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="17" cy="18" r="2.4"/><path d="M8.2 11l6.6-3.6M8.2 13l6.6 3.6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M18 4h1v13"/></svg>',
  trackpad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M12 8l-2 2M12 8l2 2"/></svg>',
  slides: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4M8 20h8M10 8l4 2-4 2z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 2.7 2.7 15.3 0 18M12 3c-2.7 2.7-2.7 15.3 0 18"/></svg>',
};

// ---- what the phone keeps: articles, waiting links, decks (previews and notes), voice memos, and a few settings (IndexedDB) ----
const db = new Promise((ok, no) => {
  const r = indexedDB.open("desk", 3);
  r.onupgradeneeded = () => {
    const have = r.result.objectStoreNames, make = (name, how) => have.contains(name) || r.result.createObjectStore(name, how);
    make("articles", { keyPath: "file" });
    make("waiting", { keyPath: "url" });
    make("settings");
    make("decks", { keyPath: "name" });
    make("memos", { keyPath: "at" }); // { at: when it began (ms), seconds, blob, keep: for the desk, why: refused by it }
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const store = async (name, mode, work) => {
  const t = (await db).transaction(name, mode), asked = work(t.objectStore(name));
  return new Promise((ok, no) => { t.oncomplete = () => ok(asked?.result); t.onerror = () => no(t.error); });
};
const all = name => store(name, "readonly", s => s.getAll());
const put = (name, value, key) => store(name, "readwrite", s => s.put(value, key));
const drop = (name, key) => store(name, "readwrite", s => s.delete(key));
const setting = key => store("settings", "readonly", s => s.get(key));

// ---- the desk, over the local network (plain http: it has no name the world knows) ----
// body: JSON, or a Blob sent as it is (a file for the inbox)
async function desk(path, body, ms, blob) {
  const at = await setting("desk");
  if (!at) throw Object.assign(new Error("no desk address yet"), { away: true });
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), ms || (body ? 45000 : 8000));
  const post = body instanceof Blob ? { method: "POST", headers: { "Content-Type": body.type || "application/octet-stream" }, body }
    : body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
  try {
    const r = await fetch("http://" + at + path, { signal: stop.signal, ...post });
    if (blob && r.ok) return await r.blob(); // a picture, kept as it is
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "the desk answered " + r.status), { refused: r.status === 422 });
    return data;
  } catch (e) {
    throw e.refused !== undefined ? e : Object.assign(new Error("the desk is out of reach"), { away: true });
  } finally { clearTimeout(timer); }
}

// ---- finding the desk on a new network: a page cannot list what is on the network, so it knocks
// on every address of the likely ones and keeps the first that says it is the desk ----
const NETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.2", "10.0.1", "192.168.178", "192.168.68", "192.168.86",
  "192.168.43", "172.20.10", "10.42.0", "192.168.100", "192.168.10", "192.168.50"];
async function knock(hosts, ms) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), ms);
  try {
    return await Promise.any(hosts.map(async host => {
      const data = await (await fetch("http://" + host + "/api/hello", { signal: stop.signal })).json();
      if (!data.desk) throw new Error("not the desk");
      return host;
    }));
  } catch { return null; } finally { clearTimeout(timer); stop.abort(); }
}
async function hunt(step) {
  const at = await setting("desk"), mine = /^(\d+\.\d+\.\d+)\.\d+$/.exec(at || "")?.[1];
  step("trying the names");
  const named = await knock([...new Set([at, "desk.lan", "perma.local"].filter(Boolean))], 3000);
  if (named) return named;
  const nets = [...new Set([mine, ...NETS].filter(Boolean))];
  for (const [i, net] of nets.entries()) {
    step(`looking on ${net}.x (${i + 1} of ${nets.length})`);
    const found = await knock(Array.from({ length: 254 }, (_, n) => net + "." + (n + 1)), 3000);
    if (found) return found;
  }
  return null;
}

// ---- or ask the desk itself, over Bluetooth: it says where it is, on any WiFi (desk-bluetooth) ----
const BT_SERVICE = "d35c0001-5e5a-4d3e-9b1f-6c0de5c0de01", BT_WHERE = "d35c0002-5e5a-4d3e-9b1f-6c0de5c0de01";
async function askBluetooth(step) {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] });
  step("connecting to " + (device.name || "the desk"));
  try {
    const server = await device.gatt.connect();
    const value = await (await (await server.getPrimaryService(BT_SERVICE)).getCharacteristic(BT_WHERE)).readValue();
    return JSON.parse(new TextDecoder().decode(value)); // {name, address, wifi}
  } finally { device.gatt.disconnect(); }
}

// give the desk a WiFi over Bluetooth: it joins while the phone stays connected, then says how it went.
// EXPERIMENT: the desk takes this from any phone near it for now; who may is to be settled later.
const BT_JOIN = "d35c0003-5e5a-4d3e-9b1f-6c0de5c0de01";
async function joinBluetooth(ssid, password, step) {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] });
  step("connecting to " + (device.name || "the desk"));
  try {
    const join = await (await (await device.gatt.connect()).getPrimaryService(BT_SERVICE)).getCharacteristic(BT_JOIN);
    const read = async () => JSON.parse(new TextDecoder().decode(await join.readValue()));
    await join.writeValueWithResponse(new TextEncoder().encode(JSON.stringify({ ssid, password })));
    step("sent; the desk is trying “" + ssid + "”");
    for (let s = 0; s < 180; s += 2) { // desk-wifi waits up to a minute per try, and may try twice
      await new Promise(r => setTimeout(r, 2000));
      const it = await read();
      if (it.state === "done") return it; // {ssid, ip, joined, error}
      step(`the desk is trying “${ssid}” (${s + 2} s)`);
    }
    throw new Error("the desk did not say how it went");
  } finally { device.gatt.disconnect(); }
}

// hand the waiting links over, then bring back the articles this phone doesn't have yet
let syncing = false;
async function sync(loud) {
  if (syncing) return;
  syncing = true;
  try {
    let sent = 0;
    for (const w of (await all("waiting")).filter(w => !w.why)) {
      try {
        await desk("/api/articles", { url: w.url });
        await drop("waiting", w.url);
        sent++;
      } catch (e) {
        if (!e.refused) throw e;
        await put("waiting", { ...w, why: e.message }); // a paywall, a page with no article: it stays, with the reason
      }
    }
    // the memos kept for the desk go to its inbox with the time they were recorded; once there, they leave the phone
    let heard = 0;
    for (const m of (await all("memos")).filter(m => m.keep)) {
      try {
        await desk("/api/inbox?name=" + encodeURIComponent(memoName(m)) + "&modified=" + m.at, m.blob, 180000);
        await drop("memos", m.at);
        heard++;
      } catch (e) {
        if (e.away) throw e;
        await put("memos", { ...m, keep: false, why: e.message }); // too large, refused: it stays here, with the reason
      }
    }
    const have = new Set((await all("articles")).map(a => a.file));
    const fresh = (await desk("/api/articles")).articles.filter(a => !have.has(a.file));
    for (const card of fresh) {
      const { text: body } = await desk("/api/fs/read?path=" + encodeURIComponent("Articles/" + card.file));
      await put("articles", { ...card, text: body });
    }
    const decks = await syncDecks();
    await put("settings", Date.now(), "synced");
    const bits = [sent && sent + " link" + (sent > 1 ? "s" : "") + " handed over", heard && heard + " memo" + (heard > 1 ? "s" : "") + " sent", fresh.length && fresh.length + " new article" + (fresh.length > 1 ? "s" : ""),
      decks && decks + " deck" + (decks > 1 ? "s" : "")].filter(Boolean);
    if (bits.length || loud) toast(bits.length ? "Synced — " + bits.join(", ") : "Up to date", true);
  } catch (e) {
    if (loud) toast(e.away ? "The desk is out of reach" : "Couldn't sync (" + e.message + ")", false);
  } finally {
    syncing = false;
    badges();
    if (open && APPS[open].fresh) APPS[open].fresh();
  }
}

// the decks in the desk's ~/Slides, kept here for the talk: the notes and the small pictures, so the phone
// shows them with only Bluetooth between it and the desk. The pictures are fetched again only when the
// deck's PDF changed; the notes each time (they are small, and may have been edited). Answers how many
// decks came in or changed pictures.
async function syncDecks() {
  let names;
  try { names = (await desk("/api/slides")).decks; } catch (e) { if (e.away) throw e; return 0; } // a desk without slides yet
  const kept = new Map((await all("decks")).map(d => [d.name, d]));
  let changed = 0;
  for (const name of names) {
    const d = await desk("/api/slides/deck?name=" + encodeURIComponent(name), null, 120000); // the first time, the desk makes them
    const old = kept.get(name);
    let thumbs = old && old.made === d.made && old.thumbs.length === d.count ? old.thumbs : null;
    if (!thumbs) {
      thumbs = [];
      for (let i = 1; i <= d.count; i++) thumbs.push(await desk("/api/fs/raw?path=" + encodeURIComponent(d.path + "t" + String(i).padStart(2, "0") + ".jpg"), null, 0, true));
      changed++;
    }
    await put("decks", { name, count: d.count, made: d.made, notes: d.notes, thumbs });
  }
  for (const name of kept.keys()) if (!names.includes(name)) await drop("decks", name); // gone from the desk
  return changed;
}

// ---- installing: the browser says when it is ready to; Settings then offers a button ----
let offer = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); offer = e; });
addEventListener("appinstalled", () => { offer = null; toast("Installed on this phone", true); });

// ---- the pane: one app at a time, sliding in from the right ----
const pane = document.getElementById("pane"), scrim = document.getElementById("pane-scrim"), body = document.getElementById("pane-body"), title = document.getElementById("pane-title");
let open = null, back = null, teardown = null;
function openApp(id) {
  closeApp();
  open = id;
  title.textContent = APPS[id].name;
  body.replaceChildren();
  body.scrollTop = 0;
  APPS[id].open();
  pane.classList.add("open");
  pane.setAttribute("aria-hidden", "false");
  if (!history.state?.pane) history.pushState({ pane: 1 }, ""); // the phone's back gesture closes the pane, not the app
}
// a screen inside an app (an article, the WiFi, the trackpad) gets its own step in the history, added
// on the tap that opens it: Chrome skips the steps a page adds without one, and back would leave the app
function inside(leave) {
  back = leave;
  if (history.state?.pane === 1) history.pushState({ pane: 2 }, "");
}
function closeApp() {
  if (teardown) { teardown(); teardown = null; }
  open = back = null;
  pane.classList.remove("open");
  scrim.classList.remove("open");
  pane.setAttribute("aria-hidden", "true");
}
// every way back goes through the history, so the arrow and the phone's gesture do the same thing
addEventListener("popstate", () => {
  if (!pane.classList.contains("open")) return;
  if (back && history.state?.pane) back(); // one screen up; the app stays open
  else closeApp();
});
document.getElementById("pane-back").onclick = () => history.state?.pane ? history.back() : back ? back() : closeApp();
scrim.onclick = () => history.state?.pane ? history.go(-history.state.pane) : closeApp();

const row = (icon, name, sub) => {
  const r = el("div", "m-item");
  r.append(el("span", "m-ic", icon), text("span", "m-nm", name));
  if (sub) r.append(text("span", "sub", sub));
  return r;
};
const note = t => text("div", "m-pad m-muted", t);

// ---- the apps ----
const APPS = {
  reader: {
    name: "Reader", glyph: I.reader,
    async open() {
      back = null;
      title.textContent = "Reader";
      const kept = (await all("articles")).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      if (open !== "reader" || back) return;
      const list = el("div", "m-list");
      for (const a of kept) {
        const r = row(I.book, a.title || a.file, a.siteName || "");
        r.onclick = () => APPS.reader.read(a);
        list.append(r);
      }
      body.replaceChildren(kept.length ? list : note("Nothing here yet. Share a link to “desk” from any app; it comes back as an article when the desk is in reach."));
    },
    fresh() { if (!back) APPS.reader.open(); },
    // one article: the front matter is the desk's (title, author, siteName, cover…), then markdown
    read(a) {
      inside(() => APPS.reader.open());
      title.textContent = a.siteName || "Reader";
      const md = a.text.replace(/^---\n[\s\S]*?\n---\n?/, ""), out = el("div", "reader-body");
      const box = el("div", "", window.marked.parse(md, { gfm: true }));
      box.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach(e => e.remove()); // it came from the web
      for (const e of box.querySelectorAll("*")) {
        for (const at of [...e.attributes]) if (/^on/i.test(at.name) || (/^(href|src)$/.test(at.name) && /^\s*javascript:/i.test(at.value))) e.removeAttribute(at.name);
        if (e.tagName === "A") Object.assign(e, { target: "_blank", rel: "noopener noreferrer" });
        if (e.tagName === "IMG") Object.assign(e, { loading: "lazy", referrerPolicy: "no-referrer" });
      }
      out.append(text("h1", "", a.title || a.file), text("p", "m-muted", [a.author, a.published].filter(Boolean).join(" · ")));
      if (a.cover && !md.includes(a.cover.split("?")[0])) out.append(Object.assign(el("img"), { src: a.cover, alt: "", referrerPolicy: "no-referrer" }));
      out.append(...box.childNodes);
      if (a.url) { const p = el("p"); p.append(Object.assign(text("a", "", "The page this was kept from"), { href: a.url, target: "_blank", rel: "noopener noreferrer" })); out.append(p); }
      for (const p of out.querySelectorAll("p, li, blockquote, h2, h3")) p.style.margin = p.style.margin || "0 0 12px";
      body.replaceChildren(out);
      body.scrollTop = 0;
    },
  },
  share: {
    name: "Shared", glyph: I.share,
    async open() {
      const links = (await all("waiting")).sort((a, b) => b.at - a.at);
      if (open !== "share") return;
      const list = el("div", "m-list");
      for (const w of links) {
        const r = row(I.globe, w.title || w.url, w.why ? "not kept" : "waiting");
        r.onclick = async () => { if (confirmRemove(r, w)) { await drop("waiting", w.url); badges(); APPS.share.open(); } };
        list.append(r);
        if (w.why) list.append(note(w.why + ". Tap the link twice to remove it."));
      }
      const go = Object.assign(text("button", "m-btn primary", "HAND OVER TO THE DESK"), { onclick: () => sync(true) });
      const foot = el("div", "m-pad");
      foot.append(go);
      body.replaceChildren(...(links.length ? [list, ...(links.some(w => !w.why) ? [foot] : [])] : [note("No link is waiting. Share one to “desk” from any app.")]));
    },
    fresh() { APPS.share.open(); },
  },
  // voice memos: recorded here, listened to, then kept for the desk (its inbox writes the text) or deleted
  memos: {
    name: "Memos", glyph: I.mic, dock: false, needs: () => !!navigator.mediaDevices && "MediaRecorder" in window,
    async open() {
      back = null;
      title.textContent = "Memos";
      const memos = (await all("memos")).sort((a, b) => b.at - a.at);
      if (open !== "memos" || back) return;
      teardown = () => { if (rec) stopMemo().then(() => toast("Memo saved on the phone", true)); }; // leaving keeps what was said
      const top = el("div", "m-pad"), big = Object.assign(el("button"), { type: "button" }), dot = el("span");
      big.setAttribute("aria-label", "record");
      big.style.cssText = "display:block;margin:10px auto;width:96px;height:96px;border-radius:50%;border:2px solid var(--accent);background:transparent;padding:0;cursor:pointer";
      const look = on => { dot.style.cssText = "display:block;margin:auto;background:var(--accent);transition:all .15s;" + (on ? "width:30px;height:30px;border-radius:6px" : "width:64px;height:64px;border-radius:50%"); };
      big.append(dot);
      const said = text("div", "m-muted", "Tap to record"), meter = el("div"), level = el("i");
      said.style.textAlign = "center";
      meter.style.cssText = "height:4px;margin:10px 20%;background:var(--hair);border-radius:2px;overflow:hidden";
      level.style.cssText = "display:block;height:100%;background:var(--accent);transform:scaleX(0);transform-origin:left";
      meter.append(level);
      top.append(big, said, meter);
      look(false);
      big.onclick = async () => {
        if (rec) { await stopMemo(); return APPS.memos.open(); }
        try {
          await startMemo((seconds, loud) => { said.textContent = "● " + mmss(seconds) + " — tap to stop"; level.style.transform = "scaleX(" + loud + ")"; });
          look(true);
          list.style.opacity = 0.4;
        } catch (e) {
          said.textContent = e.name === "NotAllowedError" ? "The microphone was refused. Allow it in the site's settings." : "The microphone: " + e.message;
        }
      };
      const list = el("div", "m-list");
      for (const m of memos) {
        const r = row(I.mic, new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          mmss(m.seconds) + " · " + (m.keep ? "for the desk" : m.why ? "not taken" : "on the phone"));
        r.onclick = () => { if (!rec) APPS.memos.listen(m); };
        list.append(r);
      }
      const parts = [top, ...(memos.length ? [list] : [])];
      if (memos.some(m => m.keep)) {
        const foot = el("div", "m-pad");
        foot.append(Object.assign(text("button", "m-btn primary", "SEND THE KEPT ONES NOW"), { onclick: () => sync(true) }));
        parts.push(foot);
      }
      parts.push(note(memos.length ? "Tap a memo to listen, then keep it for the desk or delete it. Kept ones go to the desk's inbox when it is in reach; it writes their text into ~/Memos. Once there, they leave this phone."
        : "Nothing recorded yet. What you keep goes to the desk's inbox, which writes it out as text."));
      body.replaceChildren(...parts);
    },
    fresh() { if (!back && !rec) APPS.memos.open(); }, // never under a recording
    // one memo: listen, then keep it for the desk or delete it (on the second tap)
    listen(m) {
      inside(() => APPS.memos.open());
      title.textContent = "Memo";
      // the player in the shell's look (symbios mobile's now-playing bar). The length is the one measured while
      // recording: a browser's recording often doesn't say its own
      const url = URL.createObjectURL(m.blob), audio = new Audio(url);
      teardown = () => { audio.pause(); URL.revokeObjectURL(url); };
      const player = el("div", "m-nowmeta"), hit = el("div"), seek = el("div", "m-seek"), fill = el("i"), ctrls = el("div", "m-nowctrls");
      player.style.margin = "14px 0";
      hit.style.cssText = "padding:14px 0;cursor:pointer;touch-action:none"; // a 4px bar, with room for a thumb
      seek.append(fill);
      hit.append(seek);
      const pb = (label, act) => { const b = Object.assign(text("button", "m-pbtn", label), { type: "button", onclick: act }); b.style.cssText = "font-size:18px;padding:8px 12px"; return b; };
      const skip = s => { audio.currentTime = Math.max(0, Math.min(m.seconds, audio.currentTime + s)); };
      const play = pb(">", () => audio.paused ? audio.play() : audio.pause()), time = text("span", "m-time m-muted", "");
      ctrls.append(pb("<<", () => skip(-10)), play, pb(">>", () => skip(10)), time);
      player.append(hit, ctrls);
      const draw = () => {
        const t = Math.min(audio.currentTime, m.seconds);
        fill.style.transform = "scaleX(" + (m.seconds ? t / m.seconds : 0) + ")";
        time.textContent = mmss(t) + " / " + mmss(m.seconds);
        play.textContent = audio.paused ? ">" : "||";
      };
      for (const e of ["timeupdate", "play", "pause", "ended", "seeked"]) audio.addEventListener(e, draw);
      const to = e => { const r = seek.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.seconds; draw(); };
      hit.onpointerdown = e => { hit.setPointerCapture(e.pointerId); to(e); hit.onpointermove = to; };
      hit.onpointerup = hit.onpointercancel = () => { hit.onpointermove = null; };
      draw();
      const when = text("div", "m-muted", new Date(m.at).toLocaleString() + " · " + mmss(m.seconds));
      const keep = Object.assign(text("button", "m-btn" + (m.keep ? "" : " primary"), m.keep ? "DON'T SEND IT" : "KEEP — SEND TO THE DESK"), { type: "button" });
      keep.onclick = async () => {
        const kept = !m.keep;
        await put("memos", { ...m, keep: kept, why: undefined });
        badges();
        if (kept) { toast("Kept for the desk", true); if (wasOnline) sync(false); }
        history.back();
      };
      const del = Object.assign(text("button", "m-btn", "DELETE"), { type: "button" });
      let armedDel = null;
      del.onclick = async () => {
        if (!armedDel) { del.textContent = "TAP AGAIN TO DELETE"; armedDel = setTimeout(() => { armedDel = null; del.textContent = "DELETE"; }, 3000); return; }
        clearTimeout(armedDel);
        await drop("memos", m.at);
        badges();
        history.back();
      };
      for (const b of [keep, del]) b.style.cssText = "display:block;width:100%;margin-top:10px";
      const box = el("div", "m-pad");
      box.append(when, player, keep, del);
      if (m.why) box.append(note("The desk didn't take it: " + m.why + "."));
      body.replaceChildren(box);
    },
  },
  status: {
    name: "Monitor", glyph: I.status,
    open() {
      const gauge = (id, label, spark) => `<div class="mon-gauge"><h4>${label}</h4><div class="mon-big" id="g-${id}">—</div><div class="mon-bar"><i id="g-${id}-b"></i></div>${spark ? `<div class="mon-spark" id="g-${id}-s"></div>` : `<small id="g-${id}-sub"></small>`}</div>`;
      body.innerHTML = `<div class="mon"><div class="mon-grid">${gauge("cpu", "CPU LOAD", true)}${gauge("mem", "MEMORY")}${gauge("temp", "SOC TEMP")}${gauge("disk", "DISK")}</div>
        <div class="mon-meta"><div class="m-kv"><span class="m-muted">name</span><b id="g-host">—</b></div><div class="m-kv"><span class="m-muted">uptime</span><b id="g-up">—</b></div></div>
        <div class="mon-off m-muted" hidden>desk not reachable</div></div>`;
      const $ = id => document.getElementById(id), gb = n => (n / 1073741824).toFixed(1), spark = $("g-cpu-s");
      for (let i = 0; i < 30; i++) spark.append(el("i"));
      const bar = (id, pct) => { $(id).style.transform = "scaleX(" + Math.max(0, Math.min(100, pct)) / 100 + ")"; };
      const tick = async () => {
        let s;
        try { s = await desk("/api/status"); } catch { if (open === "status") body.querySelector(".mon-off").hidden = false; return; }
        if (open !== "status") return;
        body.querySelector(".mon-off").hidden = true;
        const load = Math.round(100 * s.load[0] / s.cores), mem = Math.round(100 * s.memory.used / s.memory.total), disk = Math.round(100 * s.disk.used / s.disk.total);
        $("g-cpu").textContent = load + "%"; bar("g-cpu-b", load);
        spark.firstChild.remove();
        spark.append(Object.assign(el("i"), { style: "transform:scaleY(" + Math.max(4, Math.min(100, load)) / 100 + ")" }));
        $("g-mem").textContent = mem + "%"; bar("g-mem-b", mem); $("g-mem-sub").textContent = gb(s.memory.used) + " / " + gb(s.memory.total) + " GB";
        $("g-temp").textContent = s.temp == null ? "—" : s.temp + "°"; $("g-temp").classList.toggle("hot", s.temp >= 75); bar("g-temp-b", s.temp == null ? 0 : (s.temp - 20) / 60 * 100);
        $("g-disk").textContent = disk + "%"; bar("g-disk-b", disk); $("g-disk-sub").textContent = gb(s.disk.used) + " / " + gb(s.disk.total) + " GB";
        const h = Math.floor(s.uptime / 3600);
        $("g-host").textContent = s.host; $("g-up").textContent = (h >= 24 ? Math.floor(h / 24) + "d " : "") + (h % 24) + "h " + Math.floor(s.uptime % 3600 / 60) + "m";
      };
      tick();
      const timer = setInterval(tick, 4000);
      teardown = () => clearInterval(timer);
    },
  },
  // the phone as the desk's trackpad, over Bluetooth: only where the browser has Bluetooth
  remote: {
    name: "Remote", glyph: I.trackpad, needs: () => !!navigator.bluetooth, dock: false, // five would not fit a narrow phone's dock
    open() { steerDesk(); },
  },
  // the phone as the clicker of a deck on the desk: over Bluetooth where the browser has it, else over the WiFi
  slides: {
    name: "Slides", glyph: I.slides, dock: false,
    // straight to the remote of the deck the desk shows (as last heard, or asked over the WiFi); the list otherwise
    async open() {
      back = null;
      slidesTab = "slides";
      let on = shown?.d;
      if (!on) try { on = (await desk("/api/slides", null, 2500)).now.deck; } catch { /* not over the WiFi: the list */ }
      if (open !== "slides") return;
      const d = on && (await all("decks")).find(x => x.name === on);
      if (open !== "slides") return;
      slidesScreen(d ? s => present(d, s) : deckList);
    },
    fresh() { if (!back && slidesTab === "slides" && !teardown) slidesScreen(deckList); }, // the list, after a sync
  },
  settings: {
    name: "Settings", glyph: I.settings,
    async open() {
      back = null; // back from Settings goes home, also after the WiFi or the trackpad set it
      const at = await setting("desk"), synced = await setting("synced");
      if (open !== "settings") return;
      const where = el("div", "m-pad"), line = el("div", "m-row");
      const input = Object.assign(el("input", "m-input"), { placeholder: "desk.lan or 192.168.1.20", value: at || "", autocapitalize: "off", spellcheck: false });
      input.setAttribute("aria-label", "The desk's address");
      const save = Object.assign(text("button", "m-btn", "SAVE"), { onclick: async () => {
        await put("settings", input.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""), "desk");
        toast("Saved", true); ping(); APPS.settings.open();
      } });
      line.append(input, save);
      where.append(text("div", "m-muted", "WHERE THE DESK IS"), el("div", "", "&nbsp;"), line);
      const list = el("div", "m-list");
      const kv = (k, v) => { const r = el("div", "m-kv"); r.append(text("span", "m-muted", k), text("b", "", v)); return r; };
      const seek = row(I.globe, "Find the desk on this network", "tap");
      seek.onclick = async () => {
        if (seek.busy) return;
        seek.busy = true;
        const sub = seek.querySelector(".sub"), found = await hunt(t => { sub.textContent = t; });
        seek.busy = false;
        if (!found) { sub.textContent = "not found"; return toast(navigator.bluetooth ? "No desk answered on this network. Try asking it over Bluetooth" : "No desk answered on this network", false); }
        await put("settings", found, "desk");
        toast("Found the desk at " + found, true); ping(); if (open === "settings") APPS.settings.open();
      };
      list.append(seek);
      if (navigator.bluetooth) {
        const ask = row(I.share, "Ask the desk over Bluetooth", "tap");
        ask.onclick = async () => {
          if (ask.busy) return;
          ask.busy = true;
          const sub = ask.querySelector(".sub");
          try {
            const it = await askBluetooth(t => { sub.textContent = t; });
            if (!it.address) { sub.textContent = "on no WiFi"; return toast("The desk is on no WiFi. Plug it into the phone to give it one", false); }
            await put("settings", it.address, "desk");
            sub.textContent = it.address;
            const reach = await knock([it.address], 4000);
            toast(`The desk is at ${it.address} on “${it.wifi}”` + (reach ? "" : ", but this phone can't reach it there. Is the phone on the same WiFi?"), !!reach);
            ping(); if (open === "settings") APPS.settings.open();
          } catch (e) {
            sub.textContent = "tap";
            if (e.name !== "NotFoundError") toast("Bluetooth: " + e.message, false); // NotFoundError: the list was closed
          } finally { ask.busy = false; }
        };
        list.append(ask);
        const give = row(I.settings, "Give the desk a WiFi over Bluetooth", "test");
        give.onclick = () => { inside(() => APPS.settings.open()); giveWifi(); };
        list.append(give);
      }
      list.append(kv("last synced", synced ? new Date(synced).toLocaleString() : "never"));
      const now = row(I.share, "Sync with the desk now"); now.onclick = () => sync(true); list.append(now);
      if (at) { const go = row(I.globe, "Open the desk itself"); go.onclick = () => window.open("http://" + at + "/", "_blank", "noopener"); list.append(go); }
      const standalone = matchMedia("(display-mode: standalone)").matches;
      list.append(kv("on this phone", standalone ? "installed" : offer ? "ready to install" : "in a browser tab"));
      if (offer && !standalone) { const ins = row(I.settings, "Install on this phone"); ins.onclick = async () => { offer.prompt(); await offer.userChoice; APPS.settings.open(); }; list.append(ins); }
      body.replaceChildren(where, list, note(at ? "The address changes with the network. At home it is the desk's name on the router; elsewhere, the address its WiFi screen shows." : "Type the address the desk has on this network."));
    },
    fresh() { if (!back && !body.contains(document.activeElement)) APPS.settings.open(); }, // not over the WiFi or the trackpad, nor under a half-typed address
  },
};

// a link is removed on the second tap, so a slip of the thumb doesn't lose it
let armed = null;
// the WiFi to give the desk: a name, a password, and what the desk says as it goes
function giveWifi() {
  const form = el("div", "m-pad"), field = (placeholder, type) => {
    const i = Object.assign(el("input", "m-input"), { placeholder, type, autocapitalize: "off", spellcheck: false });
    i.style.cssText = "display:block;width:100%;margin-bottom:8px";
    return i;
  };
  const ssid = field("network name", "text"), password = field("password (none for an open network)", "password");
  const send = Object.assign(text("button", "m-btn primary", "SEND OVER BLUETOOTH"), { type: "button" });
  const said = text("div", "m-muted", "The desk joins it while the phone stays on its own network. A wrong password puts back what the desk knew before.");
  said.style.marginTop = "12px";
  send.onclick = async () => {
    if (!ssid.value.trim()) return ssid.focus();
    send.disabled = true;
    try {
      const it = await joinBluetooth(ssid.value.trim(), password.value, t => { said.textContent = t; });
      if (it.error) { said.textContent = it.error; toast("The desk did not join “" + ssid.value.trim() + "”", false); }
      else if (it.joined) {
        await put("settings", it.ip, "desk");
        said.textContent = `The desk is on “${it.ssid}” at ${it.ip}. Saved as its address.`;
        toast("The desk joined “" + it.ssid + "”", true); ping();
      } else said.textContent = `The desk knows “${ssid.value.trim()}” now, but stays on “${it.ssid}”, which is also in range. It moves when that one is gone.`;
    } catch (e) {
      said.textContent = e.name === "NotFoundError" ? "No desk picked." : "Bluetooth: " + e.message;
    } finally { send.disabled = false; }
  };
  form.append(text("div", "m-muted", "GIVE THE DESK A WIFI"), el("div", "", "&nbsp;"), ssid, password, send, said);
  body.replaceChildren(form);
  ssid.focus();
}

// the phone as a trackpad for the desk on an HDMI screen, over Bluetooth (desk-bluetooth's "steer"):
// drag moves, a quick tap clicks, two fingers scroll. A move is sent without an answer; while one is
// on its way the next ones add up, so the phone sends as fast as the link takes and no faster. A
// click keeps its place among the moves. (Dragging a window from here: to do, see desk's TODO.md.)
// EXPERIMENT: the desk takes this from any phone near it for now, as the WiFi.
const BT_STEER = "d35c0004-5e5a-4d3e-9b1f-6c0de5c0de01";
// the desk picked for the trackpad stays picked while the companion runs: back on the Remote, the phone
// joins it again by itself, with no Bluetooth list (Android drops the link when the companion is left)
let device = null, steer = null;
function steerDesk(slot) {
  const said = text("div", "m-muted", "Tap Connect and pick the desk. Its screen shows the pointer.");
  const pace = text("div", "m-muted", ""); // how many sends a second the link takes: the lag, felt
  const stop = () => { device?.gatt.disconnect(); steer = null; };
  const pad = trackpad(t => steer.writeValueWithoutResponse(new TextEncoder().encode(t)), () => !!steer,
    e => { said.textContent = "Bluetooth: " + e.message; stop(); go.disabled = false; });
  const rate = setInterval(() => { pace.textContent = steer ? pad.rate() + " sends a second" : ""; }, 1000);
  const join = async () => {
    go.disabled = true;
    said.textContent = "connecting to " + (device.name || "the desk");
    device.ongattserverdisconnected = () => { steer = null; go.disabled = false; said.textContent = "Disconnected. Tap Connect again."; }; // this screen's, not a closed one's
    if (!steer || !device.gatt.connected) steer = await (await (await device.gatt.connect()).getPrimaryService(BT_SERVICE)).getCharacteristic(BT_STEER);
    said.textContent = "Connected to " + (device.name || "the desk") + ". Drag to move, tap to click, two fingers to scroll.";
  };
  const rejoin = () => { if (device && !document.hidden) join().catch(() => { stop(); go.disabled = false; said.textContent = "The desk did not answer. Tap Connect."; }); };
  document.addEventListener("visibilitychange", rejoin);
  teardown = () => { clearInterval(rate); document.removeEventListener("visibilitychange", rejoin); };
  const go = Object.assign(text("button", "m-btn primary", "CONNECT"), { type: "button" });
  go.onclick = async () => {
    go.disabled = true;
    try {
      if (device) try { return await join(); } catch { // the desk picked before, if it still answers; if not, the
        stop(); device = null; go.disabled = false;     // list on the next tap (this one may be too old by now to open it)
        return void (said.textContent = "The desk did not answer. Tap Connect to pick it again.");
      }
      const picked = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] });
      if (picked !== device) { stop(); device = picked; }
      await join();
    } catch (e) {
      said.textContent = e.name === "NotFoundError" ? "No desk picked." : "Bluetooth: " + e.message;
      stop(); go.disabled = false;
    }
  };
  if (slot) slot.replaceChildren(go, pad.box, said, pace);
  else { const form = el("div", "m-pad"); form.append(go, pad.box, said, pace); body.replaceChildren(form); }
  rejoin();
}

// The pad itself, for the Remote and for the Slides remote: write sends lines of text over the link,
// ready says whether there is one, fail is told when a send fails. Answers { box, rate }.
function trackpad(write, ready, fail, height = "52vh") {
  let busy = false, dx = 0, dy = 0, wheel = 0, lines = [], sent = 0;
  const pad = el("div");
  pad.style.cssText = `height:${height};margin:12px 0;border:1px solid var(--muted,#555);border-radius:12px;touch-action:none`;
  const buttons = el("div", "m-row"), left = text("button", "m-btn", "LEFT"), right = text("button", "m-btn", "RIGHT");
  left.style.flex = right.style.flex = "1";
  buttons.append(left, right);
  const pump = async () => {
    if (busy || !ready()) return;
    busy = true;
    try {
      while (dx || dy || wheel || lines.length) {
        const out = lines.splice(0);
        if (dx || dy) out.push(`m ${dx} ${dy}`);
        if (wheel) out.push(`s ${wheel}`);
        dx = dy = wheel = 0;
        await write(out.join("\n"));
        sent++;
      }
    } catch (e) { fail(e); }
    finally { busy = false; }
  };
  // screen pixels for one pixel of the pad; quicker strokes go further. 1.7 felt right at 1080p; the
  // kiosk is at 720p now, where a pixel is 1.5 times more of the screen
  const SPEED = 1.15;
  // a click goes after the moves made before it
  const press = line => { if (dx || dy) { lines.push(`m ${dx} ${dy}`); dx = dy = 0; } lines.push(line); pump(); };
  let last = null, travel = 0, at = 0, two = false, rest = 0;
  const point = e => ({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  pad.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length > 1) two = true;
    if (e.touches.length === 1) { two = false; travel = 0; at = Date.now(); }
    last = point(e);
  }, { passive: false });
  pad.addEventListener("touchmove", e => {
    e.preventDefault();
    if (!last) return;
    const p = point(e), mx = p.x - last.x, my = p.y - last.y;
    last = p;
    travel += Math.abs(mx) + Math.abs(my);
    if (e.touches.length > 1) {
      rest += my;
      const notches = Math.trunc(rest / 12); // a wheel notch every 12 pixels; the content follows the fingers
      if (notches) { wheel += notches; rest -= notches * 12; }
    } else {
      const k = SPEED * (1 + Math.min(1.5, Math.hypot(mx, my) / 20));
      dx += Math.round(mx * k); dy += Math.round(my * k);
    }
    pump();
  }, { passive: false });
  pad.addEventListener("touchend", e => {
    e.preventDefault();
    if (e.touches.length) { last = point(e); return; }
    if (!two && travel < 10 && Date.now() - at < 250) press("c l");
    last = null;
  }, { passive: false });
  left.onclick = () => press("c l");
  right.onclick = () => press("c r");
  const box = el("div");
  box.append(pad, buttons);
  return { box, rate: () => { const n = sent; sent = 0; return n; } };
}

// One deck, presented: which slide shows is the desk's (it keeps it for every screen); the phone sends
// words ("next", "prev", "black", "full", "end", "open <deck>") and shows what the desk says back: the slide's notes
// and the next one's picture. Over Bluetooth the words ride on the trackpad's value ("p next") and the
// desk tells each change on its own value (slide); without Bluetooth, the same over the WiFi.
const BT_SLIDE = "d35c0005-5e5a-4d3e-9b1f-6c0de5c0de01";
let shown = null; // the slide on show as this phone last heard it ({d, i, n, b, f}): Slides opens on its deck
let talk = null;  // { deck, at }: when the talk on show began, for the clock, kept across visits to this screen
function present(deck, slot) {
  let now = null, ble = null, queue = Promise.resolve(), gone = false, seq = -1;
  const top = el("div", "m-row"), where = text("div", "m-muted", ""), clock = text("div", "m-muted", "");
  where.style.flex = "1";
  top.append(where, clock);
  const notes = text("div", "", "");
  notes.style.cssText = "font-size:22px;line-height:1.35;margin:14px 0;min-height:22vh;white-space:pre-wrap";
  // the slide on show and the next one, side by side: facing the room, the phone says what the room sees and what comes
  const shot = () => {
    const box = el("div"), label = text("div", "m-muted", ""), img = el("img");
    box.style.cssText = "flex:1;min-width:0";
    img.alt = "";
    img.style.cssText = "display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000;border:1px solid var(--muted,#555);margin-top:4px";
    box.append(label, img);
    return { box, label, img };
  };
  const cur = shot(), nxt = shot(), shots = el("div", "m-row");
  shots.style.cssText = "gap:8px;align-items:flex-start;margin:6px 0 14px";
  shots.append(cur.box, nxt.box);
  const picture = (s, i) => { s.img.hidden = !urls[i]; if (urls[i]) s.img.src = urls[i]; };
  const big = (label, words) => { const b = Object.assign(text("button", "m-btn primary", label), { type: "button", onclick: () => say(words) }); b.style.cssText = "flex:1;padding:22px 0;font-size:18px"; return b; };
  const pads = el("div", "m-row"), prev = big("PREV", "prev"), next = big("NEXT", "next");
  prev.classList.remove("primary");
  pads.append(prev, next);
  const black = Object.assign(text("button", "m-btn", "BLACK"), { type: "button", onclick: () => say("black") });
  const full = Object.assign(text("button", "m-btn", "WINDOW"), { type: "button", onclick: () => say("full") });
  // END on the second tap, so a slip of the thumb doesn't stop the talk
  const twice = (b, label, armedLabel, act) => {
    let armed = null;
    b.onclick = () => {
      if (armed) { clearTimeout(armed); armed = null; b.textContent = label(); return act(); }
      b.textContent = armedLabel();
      armed = setTimeout(() => { armed = null; b.textContent = label(); }, 3000);
    };
  };
  const end = Object.assign(text("button", "m-btn", "END"), { type: "button" });
  twice(end, () => "END", () => "TAP AGAIN TO END", () => say("end"));
  const tools = el("div", "m-row");
  for (const b of [black, full, end]) { b.style.flex = "1"; tools.append(b); }
  tools.style.marginTop = "10px";
  // shows the deck at once when the desk shows none; over another talk, on the second tap
  const start = Object.assign(text("button", "m-btn primary", "SHOW THIS DECK ON THE DESK"), { type: "button" });
  let replacing = null;
  start.onclick = () => {
    if (!now?.d || replacing) { clearTimeout(replacing); replacing = null; start.textContent = "SHOW THIS DECK ON THE DESK"; return say("open " + deck.name); }
    start.textContent = `REPLACES ${now.d}, SLIDE ${now.i} / ${now.n} — TAP AGAIN`;
    replacing = setTimeout(() => { replacing = null; start.textContent = "SHOW THIS DECK ON THE DESK"; }, 3000);
  };
  const link = Object.assign(text("button", "m-btn", "CONNECT OVER BLUETOOTH"), { type: "button" });
  const others = Object.assign(text("button", "m-btn", "OTHER DECKS"), { type: "button", onclick: () => {
    if (!back) inside(() => APPS.slides.open());
    slidesScreen(deckList);
  } });
  const said = text("div", "m-muted", "");
  for (const b of [start, link, others]) b.style.cssText = "display:block;width:100%;margin-top:10px";
  const urls = deck.thumbs.map(b => URL.createObjectURL(b));
  const draw = () => {
    const ours = now && now.d === deck.name;
    start.hidden = ours;
    for (const e of [pads, tools]) e.hidden = !ours;
    link.hidden = !navigator.bluetooth || !!ble;
    // a deck not on the desk yet shows what it opens on: its first slide and that slide's notes
    if (!ours) {
      where.textContent = !now ? "not connected" : now.d ? "the desk shows " + now.d : "the desk shows no deck";
      notes.textContent = deck.notes[0] || "(no notes for this slide)";
      cur.label.textContent = "FIRST · not on the desk yet";
      picture(cur, 0);
      cur.img.style.opacity = 1;
      nxt.label.textContent = deck.count > 1 ? "NEXT · 2" : "";
      picture(nxt, 1);
      return;
    }
    where.textContent = `${now.i} / ${now.n}` + (now.b ? " · BLACK" : "") + (ble ? " · bluetooth" : " · wifi");
    notes.textContent = deck.notes[now.i - 1] || "(no notes for this slide)";
    cur.label.textContent = "NOW · " + now.i + (now.b ? " · BLACK" : "");
    picture(cur, now.i - 1);
    cur.img.style.opacity = now.b ? 0.3 : 1; // blacked: dimmed here, black on the screen
    nxt.label.textContent = now.i < now.n ? "NEXT · " + (now.i + 1) : "END OF THE DECK";
    picture(nxt, now.i < now.n ? now.i : -1);
    black.textContent = now.b ? "UNBLACK" : "BLACK";
    full.textContent = now.f ? "WINDOW" : "FULL";
  };
  const got = s => {
    now = shown = s;
    if (s.d && talk?.deck !== s.d) talk = { deck: s.d, at: Date.now() };
    if (!s.d) talk = null;
    draw();
  };
  const say = words => {
    (queue = queue.catch(() => {}).then(async () => {
      if (ble) await ble.steer.writeValueWithoutResponse(new TextEncoder().encode("p " + words));
      else { const s = await desk("/api/slides", { do: words }); got({ d: s.deck, i: s.i, n: s.n, b: s.black, f: s.full }); }
    })).catch(e => { said.textContent = e.away ? "The desk is out of reach. Connect over Bluetooth." : (e.message || String(e)); });
  };
  const read = v => JSON.parse(new TextDecoder().decode(v));
  // Bluetooth: the desk picked for the Remote, or picked here; the slide read once, then each change told
  const join = async pick => {
    if (pick || !device) { const d = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] }); if (d !== device) { device?.gatt.disconnect(); device = d; } }
    said.textContent = "connecting to " + (device.name || "the desk");
    const service = await (await device.gatt.connect()).getPrimaryService(BT_SERVICE);
    const [s, slide] = await Promise.all([service.getCharacteristic(BT_STEER), service.getCharacteristic(BT_SLIDE)]);
    steer = s;
    slide.oncharacteristicvaluechanged = e => got(read(e.target.value));
    await slide.startNotifications();
    ble = { steer: s, slide };
    device.ongattserverdisconnected = () => { ble = null; steer = null; said.textContent = "Bluetooth dropped. Tap Connect, or stay on the WiFi."; draw(); };
    got(read(await slide.readValue()));
    said.textContent = "";
  };
  link.onclick = () => join(true).catch(e => { said.textContent = e.name === "NotFoundError" ? "No desk picked." : "Bluetooth: " + e.message; });
  const rejoin = () => { if (device && !ble && !document.hidden) join(false).catch(() => {}); };
  document.addEventListener("visibilitychange", rejoin);
  // the WiFi, while Bluetooth isn't there: wait for the next change, as the desk's own screens do
  (async () => {
    while (!gone) {
      if (ble) { await new Promise(r => setTimeout(r, 1000)); continue; }
      try {
        const s = await desk("/api/slides/now?after=" + seq, null, 30000);
        seq = s.seq;
        if (!ble && !gone) got({ d: s.deck, i: s.i, n: s.n, b: s.black, f: s.full });
      } catch { if (!gone) await new Promise(r => setTimeout(r, 3000)); }
    }
  })();
  const tick = () => { if (!talk || talk.deck !== deck.name) return void (clock.textContent = ""); const t = Math.floor((Date.now() - talk.at) / 1000); clock.textContent = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  const timer = setInterval(tick, 1000);
  teardown = () => { gone = true; clearInterval(timer); document.removeEventListener("visibilitychange", rejoin); urls.forEach(u => URL.revokeObjectURL(u)); };
  title.textContent = deck.name;
  slot.replaceChildren(top, notes, shots, pads, tools, start, link, others, said);
  if (shown) now = shown; // what this phone last heard, until the desk says again
  draw();
  tick();
  rejoin();
}

// the decks kept on this phone; the one the desk shows is marked, a tap opens a deck's remote
async function deckList(slot) {
  title.textContent = "Slides";
  const decks = (await all("decks")).sort((a, b) => a.name.localeCompare(b.name));
  if (open !== "slides" || !slot.isConnected) return;
  const list = el("div", "m-list");
  for (const d of decks) {
    const r = row(I.slides, d.name, shown?.d === d.name ? `on the desk · ${shown.i} / ${shown.n}` : d.count + " slides");
    r.onclick = () => slidesScreen(s => present(d, s)); // back, from there: to the talk on show (or out, with none)
    list.append(r);
  }
  slot.replaceChildren(decks.length ? list : note("No deck on this phone yet. Put a folder with its PDF in the desk's ~/Slides, then sync while the desk is in reach."));
}

// SLIDES | TRACKPAD on top of every screen of the Slides app: the trackpad is the only way to act on the
// desk's screen, so it is one tap away whatever the slides are doing (the same pad as the Remote app,
// which joins the desk this phone knows by itself). draw puts the slides' side (a deck, the list) in slot.
let slidesTab = "slides";
function slidesScreen(draw) {
  const tabs = el("div", "m-row"), toPad = text("button", "m-btn", "TRACKPAD"), toSlides = text("button", "m-btn", "SLIDES");
  for (const b of [toSlides, toPad]) { b.type = "button"; b.style.flex = "1"; tabs.append(b); }
  tabs.style.cssText = "padding:12px 12px 0";
  const slot = el("div", "m-pad");
  const show = () => {
    teardown?.(); teardown = null; // the screen before: its link loop, its timers
    toPad.classList.toggle("primary", slidesTab === "pad");
    toSlides.classList.toggle("primary", slidesTab === "slides");
    if (slidesTab === "pad") steerDesk(slot); else draw(slot);
  };
  toPad.onclick = () => { slidesTab = "pad"; show(); };
  toSlides.onclick = () => { slidesTab = "slides"; show(); };
  body.replaceChildren(tabs, slot);
  show();
}

// The memo being recorded, one at a time. The screen is kept on while it records: a phone that
// sleeps may stop the microphone. show is told the seconds so far and how loud it is now (0 to 1).
let rec = null;
const mmss = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
async function startMemo(show) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
  // 24 kbps, about 180 KB a minute: Opus at 16–32 kbps transcribes as well as the browser's ~129 kbps (Gab's
  // test on the board, 2026-10-17), for a quarter of the upload and of the writes to the SD card
  const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 }), chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const ctx = new AudioContext(), meter = ctx.createAnalyser(), samples = new Float32Array(1024);
  meter.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(meter);
  ctx.resume().catch(() => {}); // some browsers make it suspended, and the meter would stay still
  const lock = await navigator.wakeLock?.request("screen").catch(() => null);
  rec = { recorder, stream, chunks, ctx, lock, at: Date.now(), done: new Promise(ok => { recorder.onstop = ok; }) };
  recorder.start(1000); // a piece each second
  const it = rec, frame = () => {
    if (rec !== it) return;
    meter.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    show((Date.now() - it.at) / 1000, Math.min(1, Math.sqrt(sum / samples.length) * 5));
    requestAnimationFrame(frame);
  };
  frame();
}
// stops the recording and keeps it on the phone (not yet for the desk)
async function stopMemo() {
  const r = rec;
  if (!r) return;
  rec = null;
  const seconds = (Date.now() - r.at) / 1000;
  r.recorder.stop();
  await r.done;
  r.stream.getTracks().forEach(t => t.stop());
  r.ctx.close();
  r.lock?.release().catch(() => {});
  if (r.chunks.length) await put("memos", { at: r.at, seconds, blob: new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" }), keep: false });
}
// the file's name in the desk's inbox; the desk names the memo by its time and its first sentence
function memoName(m) {
  const d = new Date(m.at), p = n => String(n).padStart(2, "0");
  return `memo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    + (/mp4|aac/.test(m.blob.type) ? ".m4a" : /ogg/.test(m.blob.type) ? ".ogg" : ".webm");
}

function confirmRemove(r, w) {
  if (armed === w.url) { armed = null; return true; }
  armed = w.url;
  r.querySelector(".sub").textContent = "tap again to remove";
  setTimeout(() => { if (armed === w.url) armed = null; }, 3000);
  return false;
}

// ---- springboard + dock ----
function tile(id) {
  const b = el("button", "app-tile"), glyph = el("span", "glyph", APPS[id].glyph);
  if (id === "share" || id === "memos") { const n = Object.assign(el("span", "tile-badge"), { hidden: true }); n.dataset.app = id; glyph.append(n); }
  b.append(glyph, text("span", "label", APPS[id].name));
  b.onclick = () => openApp(id);
  return b;
}
for (const id of Object.keys(APPS).filter(id => !APPS[id].needs || APPS[id].needs())) {
  document.getElementById("grid").append(tile(id));
  if (APPS[id].dock !== false) document.getElementById("dock-tiles").append(tile(id));
}
async function badges() {
  const n = { share: (await all("waiting")).length, memos: (await all("memos")).filter(m => m.keep).length }; // links waiting, memos kept for the desk
  for (const b of document.querySelectorAll(".tile-badge")) { b.hidden = !n[b.dataset.app]; b.textContent = n[b.dataset.app]; }
}

// ---- status bar: the clock, and whether the desk is in reach (a tap asks again and syncs) ----
const clock = document.getElementById("clock"), conn = document.getElementById("conn"), connLabel = document.getElementById("conn-label");
const tick = () => { const d = new Date(); clock.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
tick(); setInterval(tick, 15000);
let wasOnline = null;
async function ping() {
  let online = false;
  try { await desk("/api/status"); online = true; } catch { /* away */ }
  conn.className = "conn " + (online ? "online" : "offline");
  connLabel.textContent = online ? "desk" : "offline";
  if (online && wasOnline !== true) sync(false); // the desk came in reach: hand over, bring back
  wasOnline = online;
}
conn.onclick = async () => { await ping(); if (wasOnline) sync(true); else toast("The desk is out of reach", false); };
setInterval(() => { if (!document.hidden) ping(); }, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });

// ---- start: a link shared from another app arrives in the address; it joins the waiting ones ----
(async () => {
  if (history.state?.pane) history.replaceState(null, ""); // a reload opens on the home screen
  navigator.serviceWorker?.register("sw.js").catch(() => {});
  navigator.storage?.persist?.(); // ask the phone not to clean the articles away
  const got = new URLSearchParams(location.search);
  const link = /https?:\/\/\S+/.exec([got.get("url"), got.get("text")].filter(Boolean).join(" "));
  if (link) {
    await put("waiting", { url: link[0], title: (got.get("title") || "").trim(), at: Date.now() });
    history.replaceState(null, "", location.pathname); // a reload doesn't add it twice
    toast("Kept for the desk", true);
    openApp("share");
  }
  badges();
  ping();
})();
