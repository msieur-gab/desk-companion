// Mesh: the radio plugged into the desk, read and written from the phone (Gab, 24 Nov: "an app that let me read and send
// messages from the companion app"). The desk does the radio (desk/mesh/, its routes under /api/mesh/, sealed like every
// route); the phone shows what the desk's own Mesh window shows: a conversation per channel and per direct message,
// today's from the board's archive, then the new ones as they come (/api/mesh/wait), the nodes the radio knows, and
// sending, with what became of a message (sending, heard, delivered, failed).
// While the companion is open and the desk in reach over the WiFi, it listens even with the pane closed: a new message
// brings a short line at the top and a count on the tile. The last day seen stays on the phone (the "settings" store,
// "mesh"), to read again away from the desk; sending needs the desk.
// A module (app.js lends it the shell s), as notes.js and player.js.

const glyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>';
const nodeGlyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
const dmGlyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>';
const BROADCAST = "!ffffffff", MOST = 200; // the radio takes about 200 bytes of text in one packet
const ago = s => { const d = Date.now() / 1000 - s; return d < 90 ? "now" : d < 5400 ? Math.round(d / 60) + " min" : d < 129600 ? Math.round(d / 3600) + " h" : Math.round(d / 86400) + " d"; };
const clock = s => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

// this module's own look, on the companion's (the Assistant's bubbles, index.html), so it stays in its file
const STYLE = `
.mesh-screen{position:absolute;inset:0;display:flex;flex-direction:column}
.mesh-head{flex:none;display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--hair);font-size:12px;color:var(--muted)}
.mesh-head .dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex:none}
.mesh-head .dot.on{background:var(--accent)}
.mesh-head span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mesh-scroll{flex:1;min-height:0;overflow:auto}
.mesh-talk{display:flex;flex-direction:column;gap:8px;padding:14px}
.mesh-msg{max-width:85%;padding:7px 11px;border-radius:8px}
.mesh-msg.mine{align-self:flex-end;background:var(--fg);color:var(--bg)}
.mesh-msg.theirs{align-self:flex-start;background:var(--hair);border:1px solid var(--panel-border)}
.mesh-msg .who{display:flex;gap:8px;font-size:11px;opacity:.7}
.mesh-msg .words{white-space:pre-wrap;overflow-wrap:anywhere}
.mesh-msg .state{font-size:11px;opacity:.7;text-align:right}
.mesh-msg .state.failed{opacity:1;font-weight:600}
.mesh-quiet{align-self:center;padding:24px 0;color:var(--muted);font-size:12px;text-align:center}
.mesh-entry{flex:none;display:flex;gap:8px;align-items:center;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--hair)}
.mesh-entry small{min-width:3ch;color:var(--muted);font-size:11px;text-align:right;font-variant-numeric:tabular-nums}
.mesh-entry small.over{color:var(--fg);font-weight:600}
.mesh-n{margin-left:6px;padding:1px 7px;border-radius:9px;background:var(--accent);color:var(--bg);font-size:11px}
`;

export function meshApp(s) {
  // what the desk said last: its radio (state), the day shown and its messages, the days kept, and the unread by conversation
  let state = { connected: false, channels: [], nodes: [], me: null }, today = null, day = null, messages = [], days = [];
  let unread = {}, seen = null, view = null; // seen: when the desk last answered (ms); view: the conversation open ("0", "dm:!id"), "nodes", or null
  let draw = () => {}, sending = false, loaded = false, todayAt = null;

  if (!document.getElementById("mesh-style")) document.head.append(Object.assign(document.createElement("style"), { id: "mesh-style", textContent: STYLE }));

  // ---- kept on the phone: the last day seen, for away ----
  const keep = () => put("settings", { state, today, day, messages, days, unread, seen }, "mesh").catch(() => {});
  const kept = setting("mesh").then(k => { if (k && !loaded) ({ state, today, day, messages, days, unread, seen } = k); }).catch(() => {});

  // ---- the desk ----
  const call = (path, body, ms) => s.desk("/api/mesh/" + path, body, ms);
  async function load(which) {
    const d = await call("messages" + (which ? "?day=" + encodeURIComponent(which) : ""));
    if (!which || !today) { today = d.day; todayAt = new Date().toDateString(); } // today is the board's day, as the board answers it
    day = d.day; messages = d.messages; days = d.days; seen = Date.now(); loaded = true;
    keep();
  }
  async function fresh() {
    state = await call("state");
    await load(day && day !== today ? day : null);
  }

  // which conversation a message belongs to: its channel, or the other end of a direct one
  const key = m => m.to === BROADCAST ? String(m.channel) : "dm:" + (m.mine ? m.to : m.from);
  const nameOf = id => { const n = state.nodes.find(n => n.id === id); return n?.long || n?.short || id; };
  const channelName = k => state.channels.find(c => String(c.index) === k)?.name || "Channel " + k;
  const label = k => k.startsWith("dm:") ? "@ " + nameOf(k.slice(3)) : channelName(k);
  const total = () => Object.values(unread).reduce((a, b) => a + b, 0);
  const onToday = () => day === today;

  // ---- listening: while the companion is open and the desk in reach, one request held open on the desk ----
  let after = null;
  async function listen() {
    for (;;) {
      if (document.hidden || !s.online()) { after = null; await new Promise(r => setTimeout(r, 3000)); continue; }
      try {
        if (after == null) { await fresh(); after = state.seq; redraw(); }
        const d = await call("wait?after=" + after, null, 35000);
        if (d.reset || d.seq < after) { after = null; continue; } // events missed, or the desk restarted (its count began again)
        after = d.seq;
        let changed = false;
        for (const e of d.events) changed = event(e) || changed;
        if (changed) { seen = Date.now(); keep(); redraw(); }
      } catch {
        after = null; // the radio's routes not there (an older desk), the desk out of reach a moment, or restarting
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }
  // one event from the desk; answers whether anything shown changed
  function event(e) {
    if (e.type === "link") {
      if (e.state) state = e.state;
      else { state = { ...state, connected: false, problem: e.problem }; }
      return true;
    }
    if (e.type === "node") {
      const i = state.nodes.findIndex(n => n.id === e.node.id);
      if (i < 0) state.nodes.push(e.node); else state.nodes[i] = e.node;
      return view === "nodes" || !view;
    }
    if (e.type === "message") {
      const m = e.message, had = messages.find(x => x.id === m.id);
      if (had) { Object.assign(had, m, { status: had.status !== "sending" ? had.status : m.status }); return true; } // the one just sent, its answer came first
      if (onToday()) messages.push(m);
      else if (!days.includes(today)) days = [today, ...days];
      if (!m.mine) {
        const k = key(m), looking = s.opened("mesh") && view === k && !document.hidden;
        if (!looking) {
          unread[k] = (unread[k] || 0) + 1;
          s.toast((m.from_name || nameOf(m.from)) + (k.startsWith("dm:") ? " to you" : " · " + (m.channel_name || channelName(k))) + ": " + (m.text || "").slice(0, 80), true);
        }
      }
      if (todayAt !== new Date().toDateString()) after = null; // midnight passed since the day was asked: the new one asked again
      return true;
    }
    if (e.type === "status") {
      const m = messages.find(m => m.id === e.id);
      if (m) { m.status = e.status; return true; }
    }
    return false;
  }
  function redraw() {
    s.badges();
    if (s.opened("mesh")) draw();
  }

  // ---- the screens ----
  const el = s.el, text = s.text;
  function head() {
    const h = el("div", "mesh-head"), dot = el("span", "dot" + (state.connected && s.online() ? " on" : "")), me = state.nodes.find(n => n.me);
    const words = !s.online() ? (seen ? "The desk is out of reach · as it was at " + new Date(seen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "The desk is out of reach")
      : !loaded ? "Asking the desk…"
      : state.connected ? (me?.long || state.me) + " · " + state.nodes.length + " nodes"
      : "No radio on the desk" + (state.problem ? ": " + state.problem : "");
    h.append(dot, text("span", "", words));
    return h;
  }
  function screen(...parts) {
    const box = el("div", "mesh-screen");
    box.append(head(), ...parts);
    s.body.replaceChildren(box);
    return box;
  }

  // the conversations: the radio's channels, then the direct ones of the day, then the nodes and the earlier days
  function home() {
    view = null;
    s.top();
    s.title.textContent = "Mesh" + (onToday() ? "" : " · " + day);
    const keys = state.channels.map(c => String(c.index));
    for (const m of messages) { const k = key(m); if (!keys.includes(k)) keys.push(k); }
    const list = el("div", "m-list");
    for (const k of keys) {
      const last = messages.filter(m => key(m) === k).at(-1);
      const r = s.row(k.startsWith("dm:") ? dmGlyph : glyph, label(k), last ? clock(last.time) : "");
      if (unread[k]) r.querySelector(".m-nm").append(text("span", "mesh-n", unread[k]));
      r.onclick = () => talk(k);
      list.append(r);
    }
    const nodes = s.row(nodeGlyph, "Nodes", state.nodes.length ? String(state.nodes.length) : "");
    nodes.onclick = () => nodesScreen();
    list.append(nodes);
    if (!onToday()) {
      const r = s.row(glyph, "Back to today", "");
      r.onclick = () => pick(null);
      list.append(r);
    }
    for (const d of days.filter(d => d !== day && d !== today)) {
      const r = s.row(glyph, d, "earlier");
      r.onclick = () => pick(d);
      list.append(r);
    }
    const scroll = el("div", "mesh-scroll");
    scroll.append(list);
    if (!keys.length) scroll.append(s.note(s.online() ? (state.connected ? "Nothing heard today yet." : "Plug a Meshtastic radio into the desk: its messages come here.") : "The desk is out of reach. Its messages come here when it is back on the same WiFi."));
    screen(scroll);
  }
  async function pick(d) {
    if (!s.online()) return s.toast("The desk is out of reach", false);
    try { await load(d); } catch (e) { return s.toast("The desk couldn't say: " + e.message, false); }
    home();
  }

  // one conversation: its messages, and the line to write, kept under the thumb
  function talk(k) {
    view = k;
    delete unread[k];
    keep();
    s.badges();
    s.inside(() => app.open());
    s.title.textContent = label(k);
    const pane = el("div", "mesh-scroll"), log = el("div", "mesh-talk"), shown = messages.filter(m => key(m) === k);
    pane.append(log);
    for (const m of shown) {
      const box = el("div", "mesh-msg " + (m.mine ? "mine" : "theirs")), who = el("div", "who");
      who.append(text("span", "", m.mine ? "you" : m.from_name || nameOf(m.from)), text("span", "", clock(m.time)));
      if (!m.mine && m.hops != null) who.append(text("span", "", m.hops ? m.hops + " hop" + (m.hops > 1 ? "s" : "") : "direct"));
      box.append(who, text("div", "words", m.text));
      if (m.mine && m.status) box.append(text("div", "state" + (m.status.startsWith("failed") ? " failed" : ""), m.status));
      log.append(box);
    }
    if (!shown.length) log.append(text("div", "mesh-quiet", onToday() ? "Nothing here today yet." : "Nothing here that day."));
    const parts = [pane];
    if (onToday()) {
      const form = el("form", "mesh-entry"), count = el("small");
      const input = Object.assign(el("input", "m-input"), { placeholder: k.startsWith("dm:") ? "To " + nameOf(k.slice(3)) : "To " + channelName(k), autocomplete: "off", enterKeyHint: "send" });
      input.setAttribute("aria-label", "Message");
      const go = Object.assign(text("button", "m-btn primary", "Send"), { type: "submit", disabled: sending || !state.connected || !s.online() });
      input.value = draft[k] || "";
      const counted = () => {
        draft[k] = input.value;
        const n = new TextEncoder().encode(input.value).length;
        count.textContent = n > MOST - 40 ? MOST - n : "";
        count.classList.toggle("over", n > MOST);
      };
      input.oninput = counted;
      counted();
      form.append(input, count, go);
      // one message per press: the line empties at once and Send waits for the radio, so a second tap sends nothing more
      form.onsubmit = async e => {
        e.preventDefault();
        const words = input.value.trim();
        if (!words || sending) return;
        if (!s.online()) return s.toast("The desk is out of reach", false);
        if (new TextEncoder().encode(words).length > MOST) return s.toast("Too long for the radio: " + MOST + " bytes at most", false);
        sending = go.disabled = true;
        input.value = draft[k] = "";
        counted();
        const dm = k.startsWith("dm:");
        try {
          const m = await call("send", { text: words, channel: dm ? 0 : Number(k), to: dm ? k.slice(3) : null });
          if (m && m.id != null && !messages.some(x => x.id === m.id)) messages.push(m); // the event may have brought it already
          keep();
        } catch (err) {
          if (!input.value) input.value = draft[k] = words; // given back, to try again
          s.toast("Not sent: " + err.message, false);
        } finally {
          sending = false;
        }
        if (s.opened("mesh") && view === k) talk(k);
      };
      parts.push(form);
      setTimeout(() => { if (view === k && document.activeElement !== input && !shown.length) input.focus(); }, 0);
    } else parts.push(s.note("An earlier day: nothing is sent from here."));
    screen(...parts);
    pane.scrollTop = pane.scrollHeight;
  }
  const draft = {}; // what was being written in each conversation, while the companion is open

  // the nodes the radio knows, the one heard last first; a tap starts a direct message
  function nodesScreen() {
    view = "nodes";
    s.inside(() => app.open());
    s.title.textContent = "Nodes";
    const list = el("div", "m-list"), nodes = [...state.nodes].sort((a, b) => (b.me - a.me) || (b.last_heard || 0) - (a.last_heard || 0));
    for (const n of nodes) {
      const meta = [n.last_heard ? ago(n.last_heard) : "never", n.hops != null ? n.hops + " hops" : null,
        n.battery != null ? (n.battery > 100 ? "powered" : n.battery + "%") : null, n.snr != null ? n.snr + " dB" : null].filter(Boolean).join(" · ");
      const r = s.row(nodeGlyph, (n.short ? n.short + " · " : "") + (n.long || n.id) + (n.me ? " (the desk's radio)" : ""), meta);
      if (!n.me) r.onclick = () => talk("dm:" + n.id);
      list.append(r);
    }
    const scroll = el("div", "mesh-scroll");
    scroll.append(nodes.length ? list : s.note("The radio knows no nodes yet."));
    if (nodes.length) scroll.append(s.note("Tap a node to write to it alone."));
    screen(scroll);
  }

  const app = {
    name: "Mesh", glyph, dock: false,
    unread: total, // the count on the tile (app.js's badges)
    async open() {
      await kept;
      if (!s.opened("mesh")) return;
      s.onLeave(() => { view = null; });
      draw = () => {
        if (!s.opened("mesh")) return;
        if (view === "nodes") nodesScreen();
        else if (view) { const input = s.body.querySelector(".mesh-entry input"), focused = document.activeElement === input; talk(view); if (focused) s.body.querySelector(".mesh-entry input")?.focus(); }
        else home();
      };
      home();
      if (s.online() && !loaded) { try { await fresh(); } catch { /* the listener asks again */ } if (s.opened("mesh") && !view) home(); }
    },
    fresh() { if (s.showing("mesh")) home(); },
  };
  setTimeout(listen, 0); // once app.js has finished starting (its wasOnline exists)
  return app;
}
