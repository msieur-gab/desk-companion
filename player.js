// Player: the desk's sound on the phone (Gab, 2026-11-01: "i cannot access the music folder or player via my phone on the
// companion app"). ON THIS PHONE first: what plays now, with no network. ON THE DESK: Music, Podcasts and Voice memos, as
// the board sees them (desk/files.py): artists and albums as covers, shows as covers, then their tracks and episodes; memos
// newest first with their first words. A sound is fetched whole (files from the desk travel sealed whole: the desk's
// SECURE-LINK.md, known limits), the next one meanwhile. Keep what you choose; the sound goes on when the pane closes,
// with the lock screen's controls. What the files are and how they show is utils/files.js's; the glyphs, utils/icons.js.
// A module (app.js lends it the shell s); what it keeps is db.js's "audio" store: { path (on the desk), file (its sound),
// name, kind, folder, album, artist, date, text, duration, size, type, blob, cover (a Blob, or none), kept (ms) }.
import { ICONS } from "./utils/icons.js";
import * as F from "./utils/files.js";

const LONG = 600; // seconds: a file longer than this remembers where it stopped

// ---- what plays: one <audio> for the whole companion, so the sound goes on when the pane closes ----
const audio = new Audio();
audio.preload = "auto";
const state = { queue: [], idx: -1, url: null, coverUrl: null, blob: null, cover: null, fetching: null, switching: false, token: 0 };
// The silence beside the sound. Between two tracks (and here while the next one comes from the desk) Chrome on Android
// sees its media stop, drops its media foreground service and isn't allowed it back in the background: about a minute
// later Android freezes it, sound and all. A looping silence that plays the whole time the sound does keeps it.
// Learned on Pebbble, Gab's Pixel, 28 Oct (brain: knowledge/pwa/android-background-audio-freeze-between-tracks.md).
// The silence is made here at the phone's own rate (48 kHz stereo): the first player's format sets Chrome's output.
let hush = null;
const awake = {
  on() {
    if (!hush) {
      const n = 48000 * 2 * 10, wav = new Uint8Array(44 + n).fill(128), v = new DataView(wav.buffer); // 10 s, 8 bit, 128 = silence
      const put = (at, text) => [...text].forEach((c, i) => wav[at + i] = c.charCodeAt(0));
      put(0, "RIFF"); v.setUint32(4, 36 + n, true); put(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 2, true); v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true);
      v.setUint16(34, 8, true); put(36, "data"); v.setUint32(40, n, true);
      hush = new Audio(URL.createObjectURL(new Blob([wav], { type: "audio/wav" })));
      hush.loop = true;
    }
    hush.play().catch(() => {});
  },
  off() { hush?.pause(); },
};
const ahead = new Map(); // path → Blob: the next sound, fetched while this one plays (two at most)
const pictures = new Map(); // a cover's path on the desk → its Blob (null: none or failed), asked once a session

export function playerApp(s) {
  // view: which tab; path: the desk's folder shown (null: its places); group: the kept folder shown (null: all kept)
  let view = "phone", path = null, group = null, draw = () => {}, armed = null, shown = null;

  // ---- what is kept here ----
  const kept = async () => all("audio");
  const keptOne = p => store("audio", "readonly", st => st.get(p));
  const keptPaths = async () => new Set(await store("audio", "readonly", st => st.getAllKeys()));
  const kindOf = k => k.kind || (k.memo ? "memo" : "track"); // kept before the kinds: memo or track

  // ---- the desk ----
  async function picture(p) {
    if (!p) return null;
    if (!pictures.has(p)) pictures.set(p, F.fetchFile(s.desk, p).catch(() => null));
    return pictures.get(p);
  }
  // a sound: kept here, fetched ahead, the one playing, or fetched now from the desk
  async function sound(t) {
    const k = await keptOne(t.path);
    if (k) return k.blob;
    if (ahead.has(t.path)) return ahead.get(t.path);
    if (state.blob && state.queue[state.idx]?.path === t.path && state.fetching !== t.path) return state.blob;
    return F.fetchFile(s.desk, t.file, t.size);
  }
  async function fetchAhead() {
    const t = state.queue[state.idx + 1];
    if (!t || ahead.has(t.path) || !s.online()) return;
    try {
      if (await keptOne(t.path)) return;
      ahead.set(t.path, await sound(t));
      while (ahead.size > 2) ahead.delete(ahead.keys().next().value);
    } catch { /* the next one is fetched when it comes */ }
  }

  // ---- playing ----
  async function playAt(i) {
    const t = state.queue[i];
    if (!t) return;
    const token = ++state.token;
    state.idx = i;
    state.fetching = t.path;
    state.switching = true; // the old sound stops, the new one hasn't started: the silence carries on meanwhile
    awake.on();
    paint();
    let blob;
    try { blob = await sound(t); }
    catch (e) {
      if (token !== state.token) return;
      state.fetching = null;
      state.switching = false;
      awake.off();
      paint();
      return s.toast(e.away ? "The desk is out of reach: what is on this phone still plays." : e.message, false);
    }
    if (token !== state.token) return; // another one was asked meanwhile
    state.fetching = null;
    if (state.url) URL.revokeObjectURL(state.url);
    state.blob = blob;
    state.url = URL.createObjectURL(blob);
    audio.src = state.url;
    const at = await setting("pos:" + t.path);
    if (at) audio.addEventListener("loadedmetadata", () => { if (audio.duration > LONG && at < audio.duration - 5) audio.currentTime = at; }, { once: true });
    audio.play().catch(() => { awake.off(); }).finally(() => { if (token === state.token) state.switching = false; });
    state.cover = t.coverBlob || await picture(t.cover);
    if (token !== state.token) return;
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = state.cover ? URL.createObjectURL(state.cover) : null;
    session(t);
    paint();
    fetchAhead();
  }
  const toggle = () => { if (!audio.src) { if (state.queue.length) playAt(Math.max(0, state.idx)); return; } audio.paused ? audio.play().catch(() => {}) : audio.pause(); };
  const next = () => { if (state.idx < state.queue.length - 1) playAt(state.idx + 1); };
  const prev = () => { if (audio.currentTime > 3) audio.currentTime = 0; else if (state.idx > 0) playAt(state.idx - 1); };
  const skip = d => { if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration - 1, audio.currentTime + d)); };

  // where a long file stopped: on pause, and every 15 s while it plays
  let lastSaved = 0;
  const remember = () => {
    const t = state.queue[state.idx];
    if (!t || !(audio.duration > LONG)) return;
    lastSaved = Date.now();
    put("settings", audio.currentTime > audio.duration - 30 ? 0 : Math.floor(audio.currentTime), "pos:" + t.path);
  };
  audio.addEventListener("pause", () => { remember(); if (!audio.ended && !state.switching) awake.off(); }); // a real pause: the silence too
  audio.addEventListener("play", () => awake.on());
  audio.addEventListener("timeupdate", () => { if (Date.now() - lastSaved > 15000) remember(); tick(); });
  audio.addEventListener("ended", () => { remember(); if (state.idx < state.queue.length - 1) next(); else { awake.off(); paint(); } });
  for (const e of ["play", "pause", "loadedmetadata"]) audio.addEventListener(e, () => paint());

  // the lock screen, a headset's buttons
  function session(t) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: t.artist || "", album: t.album || "",
      artwork: state.coverUrl ? [{ src: state.coverUrl, sizes: "512x512", type: state.cover.type || "image/jpeg" }] : [] });
  }
  if ("mediaSession" in navigator) {
    for (const [a, run] of [["play", toggle], ["pause", toggle], ["nexttrack", next], ["previoustrack", prev],
      ["seekbackward", () => skip(-15)], ["seekforward", () => skip(30)], ["seekto", d => { if (audio.duration) audio.currentTime = d.seekTime; }]]) {
      try { navigator.mediaSession.setActionHandler(a, run); } catch { /* not offered here */ }
    }
  }

  // a sound as the queue holds it: from the desk's items of a folder (where: its album, show or the memos), or kept here
  const fromDesk = (i, where) => ({ path: i.path, file: i.audio || i.path, name: i.name, kind: i.kind, size: i.size, date: i.date,
    text: i.text, duration: i.duration, folder: where.path, album: where.name, artist: i.artist || where.artist, cover: where.cover });
  const fromPhone = k => ({ path: k.path, file: k.file || k.path, name: k.name, kind: kindOf(k), date: k.date, text: k.text,
    duration: k.duration, folder: k.folder, album: k.album, artist: k.artist, coverBlob: k.cover || null, size: k.size });

  // ---- keeping ----
  async function keep(t) {
    if (await keptOne(t.path)) return false;
    const blob = await sound(t), cover = t.coverBlob || await picture(t.cover);
    await put("audio", { path: t.path, file: t.file, name: t.name, kind: t.kind, folder: t.folder, album: t.album || "", artist: t.artist || "",
      date: t.date || null, text: t.text || "", duration: t.duration || null, size: blob.size, type: blob.type, blob, cover: cover || null, kept: Date.now() });
    navigator.storage?.persist?.(); // asked once it matters: the phone keeps what is here when space runs short
    return true;
  }
  async function keepAll(chosen, button) {
    let n = 0;
    for (const [i, t] of chosen.entries()) {
      button.textContent = `KEEPING ${i + 1} OF ${chosen.length}…`;
      try { if (await keep(t)) n++; }
      catch (e) { s.toast(e.away ? "The desk went out of reach: " + n + " kept." : e.message, false); break; }
    }
    s.toast(n ? `On this phone now: ${n}` : "Already on this phone", true);
    if (s.opened("player")) draw();
  }

  // ---- drawing: the two shapes of utils/files.js ----
  const mark = on => { const m = s.el("span", "f-mark", on ? ICONS.phone : ""); m.title = on ? "on this phone" : ""; return m; };
  // grid: what opens on more (artists, albums, shows), as covers; picture: the cover's path on the desk, or a kept Blob
  function grid(tiles) {
    const g = s.el("div", "f-grid");
    for (const t of tiles) {
      const tile = s.el("button", "f-tile"), cover = s.el("div", "f-cover", t.glyph);
      tile.type = "button";
      if (t.here) cover.append(mark(true));
      tile.append(cover, s.text("div", "f-name", t.name), s.text("div", "f-sub m-muted", t.sub || ""));
      tile.onclick = t.open;
      const show = b => F.paintCover(cover, b);
      if (t.blob) show(t.blob); else if (t.picture) picture(t.picture).then(show);
      g.append(tile);
    }
    return g;
  }
  // list: one line each, the kind's glyph, what it is under its name, a phone where it is kept
  function line(i, { here, choosing, picked, onTap, remove }) {
    const r = s.el("div", "m-item f-line"), words = s.el("span", "m-nm");
    words.append(s.text("span", "f-title", i.name));
    const sub = F.describe(i);
    if (sub || i.text) words.append(s.text("span", "f-text m-muted", [sub, i.text].filter(Boolean).join(" — ")));
    const icon = !choosing ? F.glyph(i) : here ? "✓" : picked ? "■" : "□";
    r.append(s.el("span", "m-ic", icon), words);
    if (here && !choosing) r.append(mark(true));
    if (remove) r.append(remove);
    if (choosing && here) r.style.opacity = ".5";
    r.dataset.path = i.path;
    r.onclick = onTap;
    return r;
  }
  const heading = t => s.text("div", "f-head m-muted", t);
  // an album's or a show's own page opens on it: its cover, its name, who made it, how many
  function header({ name, sub, picture: pic, blob, glyph }) {
    const h = s.el("div", "f-header"), cover = s.el("div", "f-cover", glyph || ICONS.album), words = s.el("div");
    words.append(s.text("div", "f-hname", name), s.text("div", "f-sub m-muted", sub || ""));
    h.append(cover, words);
    const show = b => F.paintCover(cover, b);
    if (blob) show(blob); else if (pic) picture(pic).then(show);
    return h;
  }

  function frame(content, foot) {
    const box = s.el("div", "m-music"), tabs = s.el("div", "m-row f-tabs");
    for (const [id, icon, label] of [["phone", ICONS.phone, "ON THIS PHONE"], ["desk", ICONS.desk, "ON THE DESK"]]) {
      const b = s.el("button", "m-btn" + (view === id ? " primary" : ""), icon + "<span>" + label + "</span>");
      b.type = "button";
      b.onclick = () => { if (view === id) return; view = id; path = group = null; s.top(); app.open(); };
      tabs.append(b);
    }
    const scroll = s.el("div", "m-list f-scroll");
    scroll.append(...content);
    const bar = s.el("div", "m-nowbar"), cover = s.el("div", "m-cover"), meta = s.el("div", "m-nowmeta"), now = s.text("div", "m-nowtitle", "");
    const ctrls = s.el("div", "m-nowctrls"), seek = s.el("div"), seekLine = s.el("div", "m-seek"), fill = s.el("i"), time = s.text("span", "m-time", "");
    seekLine.append(fill);
    seek.append(seekLine);
    seek.style.cssText = "padding:8px 0;margin:-8px 0;cursor:pointer";
    seek.onclick = e => { const r = seek.getBoundingClientRect(); if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; };
    const btn = (t, run, label) => Object.assign(s.text("button", "m-pbtn", t), { type: "button", onclick: run, ariaLabel: label });
    const play = btn(">", toggle, "Play or pause");
    ctrls.append(btn("|<", prev, "Previous"), btn("-15", () => skip(-15), "Back 15 seconds"), play, btn("+30", () => skip(30), "Forward 30 seconds"), btn(">|", next, "Next"), time);
    meta.append(now, seek, ctrls);
    bar.append(cover, meta);
    box.append(tabs, scroll, ...(foot ? [foot] : []), bar);
    ui = { now, fill, time, play, cover, bar, scroll };
    s.body.replaceChildren(box);
    paint();
    return scroll;
  }
  let ui = null;
  function tick() {
    if (!ui) return;
    ui.fill.style.transform = `scaleX(${audio.duration ? audio.currentTime / audio.duration : 0})`;
    ui.time.textContent = F.clock(audio.currentTime) + " / " + F.clock(audio.duration);
  }
  function paint() {
    if (!ui || !s.opened("player")) return;
    const t = state.queue[state.idx];
    ui.bar.style.display = t ? "" : "none";
    ui.now.textContent = !t ? "" : state.fetching === t.path ? "Fetching " + t.name + "…" : t.name;
    ui.play.textContent = audio.src && !audio.paused ? "||" : ">";
    if (ui.cover.dataset.url !== (state.coverUrl || "")) { // the playing one's cover, in the theme's colours
      ui.cover.dataset.url = state.coverUrl || "";
      ui.cover.replaceChildren();
      ui.cover.classList.remove("has");
      if (state.coverUrl) F.paintCover(ui.cover, state.coverUrl); else if (t) ui.cover.innerHTML = ICONS[t.kind] || ICONS.track;
    }
    for (const r of s.body.querySelectorAll(".f-line[data-path]")) r.classList.toggle("playing", !!t && r.dataset.path === t.path);
    tick();
  }

  // ---- moving: one step back at a time, by the phone's gesture or the arrow ----
  function go(p) {
    path = p;
    if (p) s.inside(() => go(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null)); else s.top();
    app.open();
  }
  function openGroup(g) {
    group = g;
    if (g) s.inside(() => openGroup(null)); else s.top();
    app.open();
  }

  // ---- ON THIS PHONE: what plays now. Music and Podcasts as covers (album, show), memos as lines ----
  async function phoneView() {
    const all = (await kept()).sort((a, b) => a.path.localeCompare(b.path));
    if (!s.opened("player") || view !== "phone") return;
    shown = all.map(k => k.path).sort().join("\n");
    const total = all.reduce((n, k) => n + k.size, 0);
    if (!all.length) {
      const toDesk = Object.assign(s.text("button", "m-btn primary", "SEE WHAT IS ON THE DESK"), { type: "button", onclick: () => { view = "desk"; app.open(); } });
      const pad = s.el("div", "m-pad");
      pad.append(toDesk);
      return frame([s.note("Nothing on this phone yet. Choose albums, episodes or memos on the desk: they play here with no network."), pad]);
    }
    if (group) return phoneGroup(all.filter(k => k.folder === group));
    const groups = new Map();
    for (const k of all) if (kindOf(k) !== "memo") groups.set(k.folder, [...(groups.get(k.folder) || []), k]);
    const tilesOf = which => [...groups].filter(([, ks]) => (kindOf(ks[0]) === "episode") === (which === "episode"))
      .map(([folder, ks]) => ({ name: ks[0].album || folder.split("/").at(-1), sub: which === "episode" ? `${ks.length} episode${ks.length > 1 ? "s" : ""}` : [!["Music", "Podcasts"].includes(ks[0].artist) && ks[0].artist, `${ks.length} track${ks.length > 1 ? "s" : ""}`].filter(Boolean).join(" · "),
        blob: ks[0].cover, glyph: which === "episode" ? ICONS.show : ICONS.album, open: () => openGroup(folder) }));
    const parts = [];
    const music = tilesOf("track"), shows = tilesOf("episode"), memos = all.filter(k => kindOf(k) === "memo").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (music.length) parts.push(heading("Music"), grid(music));
    if (shows.length) parts.push(heading("Podcasts"), grid(shows));
    if (memos.length) {
      parts.push(heading("Voice memos"));
      const queue = memos.map(fromPhone);
      memos.forEach((k, n) => parts.push(line(fromPhone(k), { here: false, onTap: () => { state.queue = queue; playAt(n); } })));
    }
    parts.push(s.note(`${all.length} on this phone, ${F.size(total)}.`));
    frame(parts);
  }
  // one kept album or show: its sounds, × twice to let one go
  function phoneGroup(ks) {
    if (!ks.length) { group = null; s.top(); return app.open(); }
    ks.sort((a, b) => kindOf(a) === "episode" ? String(b.date || "").localeCompare(String(a.date || "")) : a.path.localeCompare(b.path));
    const episodes = kindOf(ks[0]) === "episode", who = !["Music", "Podcasts"].includes(ks[0].artist) && ks[0].artist;
    const queue = ks.map(fromPhone), rows = [header({ name: ks[0].album || group.split("/").at(-1), blob: ks[0].cover, glyph: episodes ? ICONS.show : ICONS.album,
      sub: [who, `${ks.length} ${episodes ? "episode" : "track"}${ks.length > 1 ? "s" : ""} on this phone`].filter(Boolean).join(" · ") })];
    ks.forEach((k, n) => {
      const x = Object.assign(s.text("button", "m-pbtn f-x", "×"), { type: "button", ariaLabel: "Remove from this phone" });
      const r = line(fromPhone(k), { here: false, remove: x, onTap: () => { state.queue = queue; playAt(n); } });
      x.onclick = async ev => {
        ev.stopPropagation();
        if (armed !== k.path) {
          armed = k.path;
          r.querySelector(".f-text")?.replaceChildren("tap × again to remove it from this phone");
          setTimeout(() => { if (armed === k.path) { armed = null; draw(); } }, 3000);
          return;
        }
        armed = null;
        await drop("audio", k.path);
        draw();
      };
      rows.push(r);
    });
    rows.push(s.note(`${ks.length} on this phone, ${F.size(ks.reduce((n, k) => n + k.size, 0))}.`));
    frame(rows);
  }

  // ---- ON THE DESK: the three places, then a folder as the board sees it ----
  async function deskView() {
    const p = path;
    if (!p) {
      const rows = F.PLACES.map(pl => line(pl, { onTap: () => go(pl.path) }));
      return frame([...rows, s.note(s.online() ? "The desk's sound. What you choose comes to this phone, to play with no network." : "The desk is out of reach: what is on this phone is under ON THIS PHONE.")]);
    }
    const scroll = frame([s.text("div", "f-path m-muted", "~/" + p), s.note("Asking the desk…")]);
    let found;
    try { found = await F.items(s.desk, p); }
    catch (e) {
      if (path !== p || !s.opened("player")) return;
      return scroll.replaceChildren(s.note(e.away ? "The desk is out of reach: what is on this phone is under ON THIS PHONE." : /not found/.test(e.message) ? "There is no ~/" + p + " on the desk yet." : e.message));
    }
    if (path !== p || !s.opened("player") || view !== "desk") return;
    const here = await keptPaths(), keptFolders = new Set([...here].map(k => k.slice(0, k.lastIndexOf("/"))));
    const name = p.split("/").at(-1), parts = p.split("/");
    const where = { path: p, name: p === "Memos" ? "Voice memos" : name, artist: parts[0] === "Music" && parts.length > 2 ? parts.at(-2) : undefined, cover: F.coverIn(found) };
    const covers = found.filter(i => F.opens(i) && F.KINDS[i.kind].shape === "grid");
    const folders = found.filter(i => F.opens(i) && F.KINDS[i.kind].shape === "list");
    const sounds = found.filter(F.playable).map(i => fromDesk(i, where));
    // choosing (Gab, 2026-11-01: "what if I just want to keep 2 of them? … keep the selected rather than keeping
    // everything at once"): a tap ticks one, and only the ticked ones come to this phone
    let choosing = false;
    const picked = new Set(), foot = s.el("div", "m-row f-foot");
    const button = (label, run, primary) => Object.assign(s.text("button", "m-btn" + (primary ? " primary" : ""), label), { type: "button", onclick: run });
    const show = () => {
      const album = sounds.length && p !== "Memos" && p.includes("/"); // a folder of sounds: an album or a show
      const out = album ? [header({ name, picture: where.cover, glyph: parts[0] === "Podcasts" ? ICONS.show : ICONS.album,
        sub: [where.artist, `${sounds.length} ${parts[0] === "Podcasts" ? "episode" : "track"}${sounds.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ") })]
        : [s.text("div", "f-path m-muted", p === "Memos" ? "Voice memos" : "~/" + p)];
      if (covers.length) out.push(grid(covers.map(i => ({ name: i.name, sub: F.describe(i), picture: i.cover, glyph: ICONS[i.kind],
        here: keptFolders.has(i.path) || [...keptFolders].some(f => f.startsWith(i.path + "/")), open: () => go(i.path) }))));
      for (const i of folders) out.push(line(i, { onTap: () => go(i.path) }));
      sounds.forEach((t, n) => out.push(line(t, { here: here.has(t.path), choosing, picked: picked.has(t.path), onTap: () => {
        if (!choosing) { state.queue = sounds; return playAt(n); }
        if (here.has(t.path)) return;
        picked.has(t.path) ? picked.delete(t.path) : picked.add(t.path);
        show();
      } })));
      if (!out[1]) out.push(s.note("Nothing to play here."));
      ui.scroll.replaceChildren(...out);
      const left = sounds.filter(t => !here.has(t.path));
      if (!sounds.length) foot.remove();
      else if (!choosing) foot.replaceChildren(left.length ? button("CHOOSE WHAT COMES TO THIS PHONE", () => { choosing = true; show(); }, true)
        : Object.assign(button("ALL ON THIS PHONE", null, true), { disabled: true }));
      else {
        const keepNow = button(picked.size ? `KEEP ${picked.size} ON THIS PHONE` : "TICK TO KEEP", () => { keepNow.disabled = true; keepAll(sounds.filter(t => picked.has(t.path)), keepNow); }, true);
        keepNow.disabled = !picked.size;
        foot.replaceChildren(button("CANCEL", () => { choosing = false; picked.clear(); show(); }),
          button(picked.size === left.length ? "NONE" : "ALL", () => { if (picked.size === left.length) picked.clear(); else for (const t of left) picked.add(t.path); show(); }), keepNow);
      }
      if (sounds.length && !foot.isConnected) ui.bar.before(foot);
      paint();
    };
    show();
  }

  const app = {
    name: "Player", glyph: ICONS.track, dock: false,
    open() {
      s.onLeave(() => { ui = null; path = group = null; }); // the sound goes on; only the screen goes
      s.title.textContent = "Player";
      draw = view === "desk" ? deskView : phoneView;
      draw();
    },
    // after each sync: what is kept again only if it changed, and never under a "tap × again"
    async fresh() {
      if (!s.opened("player") || view !== "phone" || armed) return;
      if ([...await keptPaths()].sort().join("\n") !== shown) draw();
    },
  };
  return app;
}
