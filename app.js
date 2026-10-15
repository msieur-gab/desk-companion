// The desk's companion on the phone. The look is symbios's mobile shell (status bar, springboard,
// panes sliding in; css/mobile.css unchanged); the code is its own and small. Four apps: Reader (articles kept on this
// phone, readable with no network), Shared (links shared to it, waiting for the desk), Monitor
// (how the desk is doing) and Settings (where the desk is, sync, install). The desk does the
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
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 2.7 2.7 15.3 0 18M12 3c-2.7 2.7-2.7 15.3 0 18"/></svg>',
};

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
  const t = (await db).transaction(name, mode), asked = work(t.objectStore(name));
  return new Promise((ok, no) => { t.oncomplete = () => ok(asked?.result); t.onerror = () => no(t.error); });
};
const all = name => store(name, "readonly", s => s.getAll());
const put = (name, value, key) => store(name, "readwrite", s => s.put(value, key));
const drop = (name, key) => store(name, "readwrite", s => s.delete(key));
const setting = key => store("settings", "readonly", s => s.get(key));

// ---- the desk, over the local network (plain http: it has no name the world knows) ----
async function desk(path, body) {
  const at = await setting("desk");
  if (!at) throw Object.assign(new Error("no desk address yet"), { away: true });
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
    const have = new Set((await all("articles")).map(a => a.file));
    const fresh = (await desk("/api/articles")).articles.filter(a => !have.has(a.file));
    for (const card of fresh) {
      const { text: body } = await desk("/api/fs/read?path=" + encodeURIComponent("Articles/" + card.file));
      await put("articles", { ...card, text: body });
    }
    await put("settings", Date.now(), "synced");
    const bits = [sent && sent + " link" + (sent > 1 ? "s" : "") + " handed over", fresh.length && fresh.length + " new article" + (fresh.length > 1 ? "s" : "")].filter(Boolean);
    if (bits.length || loud) toast(bits.length ? "Synced — " + bits.join(", ") : "Up to date", true);
  } catch (e) {
    if (loud) toast(e.away ? "The desk is out of reach" : "Couldn't sync (" + e.message + ")", false);
  } finally {
    syncing = false;
    badges();
    if (open && APPS[open].fresh) APPS[open].fresh();
  }
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
}
function closeApp() {
  if (teardown) { teardown(); teardown = null; }
  open = back = null;
  pane.classList.remove("open");
  scrim.classList.remove("open");
  pane.setAttribute("aria-hidden", "true");
}
document.getElementById("pane-back").onclick = () => back ? back() : closeApp();
scrim.onclick = closeApp;

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
      back = () => APPS.reader.open();
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
  settings: {
    name: "Settings", glyph: I.settings,
    async open() {
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
        give.onclick = () => { back = () => APPS.settings.open(); giveWifi(); };
        list.append(give);
        const steer = row(I.status, "Steer the desk's screen over Bluetooth", "test");
        steer.onclick = () => steerDesk();
        list.append(steer);
      }
      list.append(kv("last synced", synced ? new Date(synced).toLocaleString() : "never"));
      const now = row(I.share, "Sync with the desk now"); now.onclick = () => sync(true); list.append(now);
      if (at) { const go = row(I.globe, "Open the desk itself"); go.onclick = () => window.open("http://" + at + "/", "_blank", "noopener"); list.append(go); }
      const standalone = matchMedia("(display-mode: standalone)").matches;
      list.append(kv("on this phone", standalone ? "installed" : offer ? "ready to install" : "in a browser tab"));
      if (offer && !standalone) { const ins = row(I.settings, "Install on this phone"); ins.onclick = async () => { offer.prompt(); await offer.userChoice; APPS.settings.open(); }; list.append(ins); }
      body.replaceChildren(where, list, note(at ? "The address changes with the network. At home it is the desk's name on the router; elsewhere, the address its WiFi screen shows." : "Type the address the desk has on this network."));
    },
    fresh() { APPS.settings.open(); },
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
// drag moves, a quick tap clicks, two fingers scroll, and a tap then a touch held and dragged holds the
// button down (as on a laptop's trackpad): that moves a window by its title bar. A move is sent
// without an answer; while one is on its way the next ones add up, so the phone sends as fast as the
// link takes and no faster. Presses and releases keep their place among the moves.
// EXPERIMENT: the desk takes this from any phone near it for now, as the WiFi.
const BT_STEER = "d35c0004-5e5a-4d3e-9b1f-6c0de5c0de01";
function steerDesk() {
  let device = null, steer = null, busy = false, dx = 0, dy = 0, wheel = 0, lines = [], sent = 0;
  const said = text("div", "m-muted", "Tap Connect and pick the desk. Its screen shows the pointer.");
  const pace = text("div", "m-muted", ""); // how many sends a second the link takes: the lag, felt
  const rate = setInterval(() => { pace.textContent = steer ? sent + " sends a second" : ""; sent = 0; }, 1000);
  const stop = () => { device?.gatt.disconnect(); device = steer = null; };
  back = () => { clearInterval(rate); stop(); APPS.settings.open(); };
  teardown = () => { clearInterval(rate); stop(); };
  const pad = el("div");
  pad.style.cssText = "height:52vh;margin:12px 0;border:1px solid var(--muted,#555);border-radius:12px;touch-action:none";
  const buttons = el("div", "m-row"), left = text("button", "m-btn", "LEFT"), right = text("button", "m-btn", "RIGHT");
  left.style.flex = right.style.flex = "1";
  buttons.append(left, right);
  const go = Object.assign(text("button", "m-btn primary", "CONNECT"), { type: "button" });
  const pump = async () => {
    if (busy || !steer) return;
    busy = true;
    try {
      while (dx || dy || wheel || lines.length) {
        const out = lines.splice(0);
        if (dx || dy) out.push(`m ${dx} ${dy}`);
        if (wheel) out.push(`s ${wheel}`);
        dx = dy = wheel = 0;
        await steer.writeValueWithoutResponse(new TextEncoder().encode(out.join("\n")));
        sent++;
      }
    } catch (e) { said.textContent = "Bluetooth: " + e.message; stop(); go.disabled = false; }
    finally { busy = false; }
  };
  go.onclick = async () => {
    go.disabled = true;
    try {
      device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT_SERVICE] }] });
      said.textContent = "connecting to " + (device.name || "the desk");
      device.addEventListener("gattserverdisconnected", () => { steer = null; go.disabled = false; said.textContent = "Disconnected. Tap Connect again."; });
      steer = await (await (await device.gatt.connect()).getPrimaryService(BT_SERVICE)).getCharacteristic(BT_STEER);
      said.textContent = "Connected to " + (device.name || "the desk") + ". Drag to move, tap to click, two fingers to scroll; tap then hold and drag to move a window.";
    } catch (e) {
      said.textContent = e.name === "NotFoundError" ? "No desk picked." : "Bluetooth: " + e.message;
      stop(); go.disabled = false;
    }
  };
  // screen pixels for one pixel of the pad; quicker strokes go further. 1.7 felt right at 1080p; the
  // kiosk is at 720p now, where a pixel is 1.5 times more of the screen
  const SPEED = 1.15;
  // a button event goes after the moves made before it
  const press = line => { if (dx || dy) { lines.push(`m ${dx} ${dy}`); dx = dy = 0; } lines.push(line); pump(); };
  const hold = on => { holding = on; pad.style.borderColor = on ? "var(--accent,#0f0)" : ""; pad.style.borderWidth = on ? "3px" : ""; };
  let last = null, travel = 0, at = 0, two = false, rest = 0, tapped = 0, tapAt = null, holding = false;
  const point = e => ({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  pad.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length > 1) two = true;
    if (e.touches.length === 1) {
      two = false; travel = 0; at = Date.now();
      // a tap, then at once a touch on the same spot: the button stays down. Quick and close, so a
      // finger put back to steer after a click doesn't grab
      const p = point(e);
      if (at - tapped < 200 && tapAt && Math.hypot(p.x - tapAt.x, p.y - tapAt.y) < 30) { hold(true); press("d l"); }
    }
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
    const tap = !two && travel < 10 && Date.now() - at < 250;
    if (holding) { hold(false); press("u l"); tapped = 0; } // lifted: the button lets go
    else if (tap) { press("c l"); tapped = Date.now(); tapAt = last; }
    last = null;
  }, { passive: false });
  left.onclick = () => press("c l");
  right.onclick = () => press("c r");
  const form = el("div", "m-pad");
  form.append(text("div", "m-muted", "STEER THE DESK'S SCREEN"), el("div", "", "&nbsp;"), go, pad, buttons, said, pace);
  body.replaceChildren(form);
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
  if (id === "share") glyph.append(Object.assign(el("span", "tile-badge"), { hidden: true }));
  b.append(glyph, text("span", "label", APPS[id].name));
  b.onclick = () => openApp(id);
  return b;
}
for (const id of Object.keys(APPS)) { document.getElementById("grid").append(tile(id)); document.getElementById("dock-tiles").append(tile(id)); }
async function badges() {
  const n = (await all("waiting")).length;
  for (const b of document.querySelectorAll(".tile-badge")) { b.hidden = !n; b.textContent = n; }
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
