// Player: the board's audio on the phone (Gab, 2026-11-01: "i cannot access the music folder or player via my phone on
// the companion app"). Music, Voice memos and Podcasts on the desk, browsed at home; a track is fetched whole, then plays
// (files from the desk travel sealed whole: the desk's SECURE-LINK.md, known limits), the next one fetched meanwhile.
// "Keep on phone" stores a track or a folder here, to play with no network. A voice memo is a folder on the desk
// (audio.webm, transcript.md): one item here. The sound goes on when the pane closes, with the lock screen's controls.
// A module (Gab: "each companion app should be built as modules or additional self contained code"): app.js lends it
// the shell (s: drawing, moving, the desk, the state); what it keeps is db.js's "audio" store:
// { path (its place on the desk), name, folder, size, type, blob, cover (a Blob, or none), kept (ms) }.

const glyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  flac: "audio/flac", wav: "audio/wav", webm: "audio/webm" };
const ROOTS = [["Music", "Music"], ["Memos", "Voice memos"], ["Podcasts", "Podcasts"]];
const LONG = 600; // seconds: a file longer than this remembers where it stopped
const ext = n => (/\.(\w+)$/.exec(n) || [])[1]?.toLowerCase() || "";
const stem = n => n.replace(/\.[^.]+$/, "");
const mb = b => (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB";
const clock = s => { s = Math.floor(isFinite(s) && s > 0 ? s : 0); return (s >= 3600 ? Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") : Math.floor(s / 60)) + ":" + String(s % 60).padStart(2, "0"); };
const q = p => encodeURIComponent(p);
const isMemo = path => /^Memos\/[^/]+$/.test(path); // a folder right inside Memos is one memo

// ---- what plays: one <audio> for the whole companion, so the sound goes on when the pane closes ----
const audio = new Audio();
audio.preload = "auto";
const state = { queue: [], idx: -1, url: null, coverUrl: null, blob: null, cover: null, fetching: null, token: 0 };
const ahead = new Map(); // path → Blob: the next track, fetched while this one plays (two at most)
const covers = new Map(); // folder → Blob or null, asked once a session

export function playerApp(s) {
  let view = "desk", path = null, draw = () => {}, armed = null, shown = null; // shown: the kept list as last drawn

  // ---- the desk ----
  const list = async p => (await s.desk("/api/fs/list?path=" + q(p))).entries;
  const kept = async () => all("audio");
  const keptOne = p => store("audio", "readonly", st => st.get(p));
  const keptPaths = async () => new Set(await store("audio", "readonly", st => st.getAllKeys()));
  async function fetchFile(p, size) {
    const b = await s.desk("/api/fs/raw?path=" + q(p), null, 30000 + Math.ceil((size || 0) / 1e6) * 4000, true);
    return new Blob([b], { type: TYPES[ext(p)] || "application/octet-stream" });
  }
  // a memo's audio: the file called audio.* in its folder
  async function memoAudio(dir) {
    const f = (await list(dir)).find(e => !e.dir && AUDIO.test(e.name));
    if (!f) throw new Error("this memo has no sound");
    return { path: dir + "/" + f.name, size: f.size };
  }
  // the folder's picture (cover.jpg, folder.jpg…), fetched once, small
  async function coverOf(folder, entries) {
    if (covers.has(folder)) return covers.get(folder);
    covers.set(folder, null);
    try {
      const imgs = (entries || await list(folder)).filter(e => !e.dir && IMAGE.test(e.name) && e.size < 3e6);
      const pick = ["cover", "folder", "front", "albumart", "album"].map(n => imgs.find(e => stem(e.name).toLowerCase() === n)).find(Boolean) || imgs[0];
      if (pick) covers.set(folder, await fetchFile(folder + "/" + pick.name, pick.size));
    } catch { /* no picture: the square stays plain */ }
    return covers.get(folder);
  }

  // a track's sound: kept here, fetched ahead, or fetched now from the desk
  async function sound(t) {
    const k = await keptOne(t.path);
    if (k) return k.blob;
    if (ahead.has(t.path)) return ahead.get(t.path);
    if (state.blob && state.queue[state.idx]?.path === t.path && state.fetching !== t.path) return state.blob; // the one playing
    let where = t;
    if (t.memo) where = await memoAudio(t.path);
    t.file = where.path;
    return fetchFile(where.path, where.size);
  }
  async function fetchAhead() {
    const t = state.queue[state.idx + 1];
    if (!t || ahead.has(t.path) || !s.online()) return;
    try {
      if (await keptOne(t.path)) return;
      const b = await sound(t);
      ahead.set(t.path, b);
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
    paint();
    let blob;
    try { blob = await sound(t); }
    catch (e) {
      if (token !== state.token) return;
      state.fetching = null;
      paint();
      return s.toast(e.away ? "The desk is out of reach: what is kept on this phone still plays." : e.message, false);
    }
    if (token !== state.token) return; // another track was asked meanwhile
    state.fetching = null;
    if (state.url) URL.revokeObjectURL(state.url);
    state.blob = blob;
    state.url = URL.createObjectURL(blob);
    audio.src = state.url;
    const at = await setting("pos:" + t.path);
    if (at) audio.addEventListener("loadedmetadata", () => { if (audio.duration > LONG && at < audio.duration - 5) audio.currentTime = at; }, { once: true });
    audio.play().catch(() => {});
    state.cover = t.cover !== undefined ? t.cover : await coverOf(t.folder);
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
    const done = audio.currentTime > audio.duration - 30;
    put("settings", done ? 0 : Math.floor(audio.currentTime), "pos:" + t.path);
  };
  audio.addEventListener("pause", remember);
  audio.addEventListener("timeupdate", () => { if (Date.now() - lastSaved > 15000) remember(); tick(); });
  audio.addEventListener("ended", () => { remember(); if (state.idx < state.queue.length - 1) next(); else paint(); });
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

  // a track as the queue holds it, from the desk's listing of its folder
  const track = (folder, e) => {
    const parts = folder.split("/");
    return isMemo(folder + "/" + e.name) && e.dir
      ? { path: folder + "/" + e.name, name: e.name.replace(/^\d{4}-\d\d-\d\d \d\d-\d\d /, ""), sub: e.name.slice(0, 16), folder: folder + "/" + e.name, memo: true, album: "Voice memos", cover: null }
      : { path: folder + "/" + e.name, name: stem(e.name), size: e.size, folder, artist: parts.length > 2 ? parts.at(-2) : parts[0], album: parts.at(-1) };
  };

  // ---- keeping ----
  async function keep(t, blob) {
    if (await keptOne(t.path)) return false;
    blob = blob || await sound(t);
    const cover = t.cover !== undefined ? t.cover : await coverOf(t.folder);
    await put("audio", { path: t.path, name: t.name, folder: t.folder, album: t.album || "", artist: t.artist || "", memo: !!t.memo,
      size: blob.size, type: blob.type, blob, cover: cover || null, kept: Date.now() });
    navigator.storage?.persist?.(); // asked once it matters: the phone keeps what is here when space runs short
    return true;
  }
  async function keepAll(tracks, button) {
    let n = 0;
    for (const [i, t] of tracks.entries()) {
      button.textContent = `KEEPING ${i + 1} OF ${tracks.length}…`;
      try { if (await keep(t)) n++; }
      catch (e) { s.toast(e.away ? "The desk went out of reach: " + n + " kept." : e.message, false); break; }
    }
    s.toast(n ? `Kept on this phone: ${n} track${n > 1 ? "s" : ""}` : "Already on this phone", true);
    if (s.opened("player")) draw();
  }

  // a folder on the desk (null: the roots); the phone's back goes one folder up
  function go(p) {
    view = "desk";
    path = p;
    if (p) s.inside(() => go(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null)); else s.top();
    app.open();
  }

  // ---- the screen ----
  let ui = null; // the parts that change while it plays
  function frame(content) {
    const box = s.el("div", "m-music"), tabs = s.el("div", "m-row");
    tabs.style.cssText = "padding:12px 12px 6px;flex:none";
    for (const [id, label] of [["desk", "ON THE DESK"], ["phone", "ON THIS PHONE"]]) {
      const b = Object.assign(s.text("button", "m-btn" + (view === id ? " primary" : ""), label), { type: "button" });
      b.style.flex = "1";
      b.onclick = () => { view = id; app.open(); };
      tabs.append(b);
    }
    const bar = s.el("div", "m-nowbar"), cover = s.el("div", "m-cover"), meta = s.el("div", "m-nowmeta"), now = s.text("div", "m-nowtitle", "");
    cover.style.cssText = "background-size:cover;background-position:center";
    const ctrls = s.el("div", "m-nowctrls"), seek = s.el("div"), line = s.el("div", "m-seek"), fill = s.el("i"), time = s.text("span", "m-time", "");
    line.append(fill);
    seek.append(line);
    seek.style.cssText = "padding:8px 0;margin:-8px 0;cursor:pointer";
    seek.onclick = e => { const r = seek.getBoundingClientRect(); if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; };
    const btn = (t, run, label) => Object.assign(s.text("button", "m-pbtn", t), { type: "button", onclick: run, ariaLabel: label });
    const play = btn(">", toggle, "Play or pause");
    ctrls.append(btn("|<", prev, "Previous"), btn("-15", () => skip(-15), "Back 15 seconds"), play, btn("+30", () => skip(30), "Forward 30 seconds"), btn(">|", next, "Next"), time);
    meta.append(now, seek, ctrls);
    bar.append(cover, meta);
    box.append(tabs, ...content, bar);
    ui = { now, fill, time, play, cover, bar };
    s.body.replaceChildren(box);
    paint();
  }
  function tick() {
    if (!ui) return;
    ui.fill.style.transform = `scaleX(${audio.duration ? audio.currentTime / audio.duration : 0})`;
    ui.time.textContent = clock(audio.currentTime) + " / " + clock(audio.duration);
  }
  function paint() {
    if (!ui || !s.opened("player")) return;
    const t = state.queue[state.idx];
    ui.bar.style.display = t ? "" : "none";
    ui.now.textContent = !t ? "" : state.fetching === t.path ? "Fetching " + t.name + "…" : t.name;
    ui.play.textContent = audio.src && !audio.paused ? "||" : ">";
    ui.cover.style.backgroundImage = state.coverUrl ? `url("${state.coverUrl}")` : "";
    for (const r of s.body.querySelectorAll("[data-path]")) r.style.color = t && r.dataset.path === t.path ? "var(--accent)" : "";
    tick();
  }

  // the desk: its roots, then a folder
  async function deskView() {
    const p = path;
    const scroll = s.el("div", "m-list");
    if (!p) {
      frame([scroll]);
      for (const [dir, label] of ROOTS) {
        const r = s.row("▸", label, "");
        r.onclick = () => go(dir);
        scroll.append(r);
      }
      scroll.append(s.note(s.online() ? "The desk's sound, played on this phone. A track comes whole before it plays (a second or two at home); keep what you want away from home."
        : "The desk is out of reach: what is kept is under ON THIS PHONE."));
      return;
    }
    const head = s.text("div", "m-pad m-muted", "~/" + p);
    head.style.cssText = "padding:4px 16px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    frame([head, scroll]);
    scroll.append(s.note("Asking the desk…"));
    let entries;
    try { entries = await list(p); }
    catch (e) {
      if (path !== p || !s.opened("player")) return;
      return scroll.replaceChildren(s.note(e.away ? "The desk is out of reach: what is kept is under ON THIS PHONE." : /not found/.test(e.message) ? "There is no ~/" + p + " on the desk yet." : e.message));
    }
    if (path !== p || !s.opened("player") || view !== "desk") return;
    const have = await keptPaths();
    const memos = p === "Memos";
    const dirs = entries.filter(e => e.dir && !memos), tracks = entries.filter(e => memos ? e.dir : !e.dir && AUDIO.test(e.name)).map(e => track(p, e));
    if (memos) tracks.reverse(); // the newest memo first
    if (!memos && tracks.length) coverOf(p, entries).then(() => { if (state.queue[state.idx]?.folder === p) paint(); });
    const rows = [];
    for (const e of dirs) {
      const r = s.row("▸", e.name, "");
      r.onclick = () => go(p + "/" + e.name);
      rows.push(r);
    }
    // the tracks: a tap plays; choosing (Gab, 2026-11-01: "what if I just want to keep 2 of them? … keep the selected
    // rather than keeping everything at once"), a tap ticks one, and only the ticked ones are kept
    let choosing = false;
    const picked = new Set();
    const foot = s.el("div", "m-row");
    foot.style.cssText = "flex:none;padding:8px 12px;gap:8px";
    const button = (label, run, primary) => {
      const b = Object.assign(s.text("button", "m-btn" + (primary ? " primary" : ""), label), { type: "button", onclick: run });
      b.style.flex = primary ? "2" : "1";
      return b;
    };
    const showTracks = () => {
      const trackRows = tracks.map((t, i) => {
        const on = have.has(t.path), icon = !choosing ? "♪" : on ? "✓" : picked.has(t.path) ? "■" : "□";
        const r = s.row(icon, t.name, [t.sub, t.size ? mb(t.size) : "", on ? "on this phone" : ""].filter(Boolean).join(" · "));
        r.dataset.path = t.path;
        if (choosing && on) r.style.opacity = ".5";
        r.onclick = () => {
          if (!choosing) { state.queue = tracks; return playAt(i); }
          if (on) return;
          picked.has(t.path) ? picked.delete(t.path) : picked.add(t.path);
          showTracks();
        };
        return r;
      });
      scroll.replaceChildren(...(rows.length || trackRows.length ? [...rows, ...trackRows] : [s.note("No sound here.")]));
      const left = tracks.filter(t => !have.has(t.path));
      if (!tracks.length) return foot.remove();
      if (!choosing) {
        foot.replaceChildren(left.length ? button("CHOOSE WHAT TO KEEP", () => { choosing = true; showTracks(); }, true)
          : Object.assign(button("ALL ON THIS PHONE", null, true), { disabled: true }));
      } else {
        const keepNow = button(picked.size ? `KEEP ${picked.size}` : "TICK TO KEEP", () => {
          const chosen = tracks.filter(t => picked.has(t.path));
          keepNow.disabled = true;
          keepAll(chosen, keepNow);
        }, true);
        keepNow.disabled = !picked.size;
        foot.replaceChildren(
          button("CANCEL", () => { choosing = false; picked.clear(); showTracks(); }),
          button(picked.size === left.length ? "NONE" : "ALL", () => { if (picked.size === left.length) picked.clear(); else for (const t of left) picked.add(t.path); showTracks(); }),
          keepNow);
      }
      if (!foot.isConnected) s.body.querySelector(".m-music")?.insertBefore(foot, ui.bar);
      paint();
    };
    showTracks();
    paint();
  }

  // this phone: what is kept, by folder, with the space it takes
  async function phoneView() {
    const items = (await kept()).sort((a, b) => a.folder.localeCompare(b.folder) || a.path.localeCompare(b.path));
    if (!s.opened("player") || view !== "phone") return;
    shown = items.map(k => k.path).sort().join("\n");
    const scroll = s.el("div", "m-list"), total = items.reduce((n, k) => n + k.size, 0);
    frame([scroll]);
    if (!items.length) return scroll.append(s.note("Nothing kept yet. Under ON THE DESK, open a folder and keep it on this phone: it plays here with no network."));
    const groups = new Map();
    for (const k of items) groups.set(k.folder, [...(groups.get(k.folder) || []), k]);
    for (const [folder, ks] of groups) {
      const h = s.text("div", "m-pad m-muted", folder.replace(/^Memos\/.*/, "Voice memos"));
      h.style.cssText = "padding:10px 16px 2px";
      scroll.append(h);
      const queue = ks.map(k => ({ path: k.path, name: k.name, folder: k.folder, artist: k.artist, album: k.album, memo: k.memo, cover: k.cover || null, size: k.size }));
      for (const [i, k] of ks.entries()) {
        const r = s.row("♪", k.name, mb(k.size));
        r.dataset.path = k.path;
        const x = Object.assign(s.text("button", "m-pbtn", "×"), { type: "button", ariaLabel: "Remove from this phone" });
        x.style.cssText = "margin:-10px -6px -10px 4px;padding:10px 14px;font-size:20px"; // a finger's size, not a glyph's
        x.onclick = async ev => {
          ev.stopPropagation();
          if (armed !== k.path) { armed = k.path; r.querySelector(".sub").textContent = "tap × again to remove"; setTimeout(() => { if (armed === k.path) { armed = null; draw(); } }, 3000); return; }
          armed = null;
          await drop("audio", k.path);
          draw();
        };
        r.append(x);
        r.onclick = () => { state.queue = queue; playAt(i); };
        scroll.append(r);
      }
    }
    scroll.append(s.note(`${items.length} kept, ${mb(total)} on this phone.`));
  }

  const app = {
    name: "Player", glyph, dock: false,
    open() {
      s.onLeave(() => { ui = null; path = null; }); // the sound goes on; only the screen goes
      s.title.textContent = "Player";
      draw = view === "desk" ? deskView : phoneView;
      draw();
    },
    // after each sync: the kept list again only if what is kept changed, and never under a "tap × again"
    async fresh() {
      if (!s.opened("player") || view !== "phone" || armed) return;
      const now = [...await keptPaths()].sort().join("\n");
      if (now !== shown) draw();
    },
  };
  return app;
}
