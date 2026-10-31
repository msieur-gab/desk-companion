// Notes: the desk's ~/Notes, kept on the phone to read and write with no network (Gab, 2026-10-31: "when I'm far away
// from the desk, I want to be able to read my previous notes, perhaps edit them"). At each sync the phone brings back
// what changed on the desk, and sends what was written here: a new note through the desk's inbox (its rulebook,
// ~/Inbox/rules.md, puts a .md in ~/Notes), with its front matter (date, title, source); an edited one over its file.
// A note changed on both sides since the last sync is not overwritten: the phone's version goes next to it, as
// "<name> (phone).md" (Gab chose it over the last save winning, "certainly not the safest").
// A module of its own (Gab: "the companion code have grown complexe"): app.js hands it the shell (the pane, the
// toasts, sync) and calls syncNotes() at each sync. What the phone keeps (all, put, drop) is db.js's: a note is
// { at, text, edited, path: its name in ~/Notes once there, seen: the desk's time of it then, changed: edited here
// since, keep: to send, why: refused by the desk }.

const glyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 11V7l-4-4H6v18h6"/><path d="M14 3v4h4M9 10h6M9 13h4"/><path d="M14.5 21l.8-2.8 4.7-4.7 2 2-4.7 4.7z"/></svg>';
const p2 = n => String(n).padStart(2, "0");
const day = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const when = ms => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const FRONT = /^---\n[\s\S]*?\n---\n?/;

// a note's title: its front matter's, else its first heading or first line; nothing a file name can't hold, as the memos' titles
export const noteTitle = t => ((/^title:\s*(.+)$/m.exec(FRONT.exec(t)?.[0] || "") || [])[1] ||
  t.replace(FRONT, "").split("\n").map(l => l.replace(/^#+\s*/, "").trim()).find(Boolean) || "Untitled")
  .replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 80) || "Untitled";

// the file the desk receives for a new note: its front matter, then the text. Front matter written by hand is kept as it is
function noteFile(n) {
  if (FRONT.test(n.text)) return n.text;
  const d = new Date(n.at);
  return `---\ndate: ${day(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}\ntitle: ${noteTitle(n.text)}\nsource: phone\n---\n\n${n.text.trim()}\n`;
}

// "<name> (phone).md", or (phone 2)… when that is taken too
function beside(name, there) {
  const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) { const n = `${stem} (phone${i > 1 ? " " + i : ""})${ext}`; if (!there.has(n)) return n; }
}

// the notes on the desk: name → its time (ms); null when it can't say (no ~/Notes yet, an older desk)
async function onDesk(desk) {
  try {
    const files = (await desk("/api/fs/list?path=Notes")).entries.filter(e => !e.dir && /\.(md|txt)$/i.test(e.name));
    if (files.some(e => !e.modified)) return null; // a desk from before 2026-10-31 doesn't say when a file changed: nothing is decided
    return new Map(files.map(e => [e.name, e.modified]));
  } catch (e) { if (e.away) throw e; return null; }
}

// at each sync: what was written here goes to the desk, then what changed there comes here. Answers { sent, copies }
export async function syncNotes(desk) {
  let sent = 0, copies = 0, there = await onDesk(desk);
  for (const n of (await all("notes")).filter(n => n.keep)) {
    try {
      if (!n.path) { // a new note: through the inbox, like everything the phone hands over; it comes back below, from ~/Notes
        await desk("/api/inbox?name=" + encodeURIComponent(day(new Date(n.at)) + " " + noteTitle(n.text) + ".md") + "&modified=" + n.edited,
          new Blob([noteFile(n)], { type: "text/markdown" }), 60000);
        await drop("notes", n.at);
      } else {
        if (!there) throw new Error("the desk can't list its notes");
        let path = n.path;
        if (there.has(path) && there.get(path) !== n.seen) { path = beside(path, there); copies++; } // changed there too: both kept
        const r = await desk("/api/fs/write", { path: "Notes/" + path, text: n.text });
        await put("notes", { ...n, path, seen: r.modified, edited: r.modified, changed: false, keep: false, why: undefined });
        there.set(path, r.modified);
      }
      sent++;
    } catch (e) {
      if (e.away) throw e;
      await put("notes", { ...n, keep: false, why: e.message }); // refused: it stays here, with the reason
    }
  }
  there = await onDesk(desk);
  if (!there) return { sent, copies };
  const kept = await all("notes"), mine = new Map(kept.filter(n => n.path).map(n => [n.path, n]));
  let i = 0;
  for (const [path, modified] of there) {
    const n = mine.get(path);
    if (n && (n.changed || n.seen === modified)) continue; // as the phone has it, or edited here: kept
    const { text } = await desk("/api/fs/read?path=" + encodeURIComponent("Notes/" + path));
    await put("notes", { at: n?.at ?? Date.now() * 1000 + i++, path, text, edited: modified, seen: modified });
  }
  for (const n of kept) if (n.path && !there.has(n.path) && !n.changed) await drop("notes", n.at); // gone from the desk
  return { sent, copies };
}

// the app, on the shell app.js hands over: { el, text, toast, row, note, body, title, inside, top, showing, onLeave, sync, badges, online }
export function notesApp(s) {
  const app = {
    name: "Notes", glyph, dock: false,
    async open() {
      s.top();
      s.onLeave(null);
      s.title.textContent = "Notes";
      const notes = (await all("notes")).sort((a, b) => b.edited - a.edited);
      if (!s.showing("notes")) return;
      const top = s.el("div", "m-pad"), list = s.el("div", "m-list");
      top.append(Object.assign(s.text("button", "m-btn primary", "NEW NOTE"), { type: "button", onclick: () => app.write({ at: Date.now(), edited: Date.now(), text: "" }) }));
      for (const n of notes) {
        const copy = / (\(phone[^)]*\))\.\w+$/.exec(n.path || "")?.[1]; // the phone's version kept beside the desk's
        const r = s.row(glyph, noteTitle(n.text) + (copy ? " " + copy : ""), when(n.edited) + " · " + (n.why ? "not taken" : n.keep ? "for the desk" : !n.path ? "on the phone" : n.changed ? "changed here" : "on the desk"));
        r.onclick = () => app.write(n);
        list.append(r);
      }
      const parts = [top, ...(notes.length ? [list] : [])];
      if (notes.some(n => n.keep)) {
        const foot = s.el("div", "m-pad");
        foot.append(Object.assign(s.text("button", "m-btn primary", "SEND THE KEPT ONES NOW"), { onclick: () => s.sync(true) }));
        parts.push(foot);
      }
      parts.push(s.note(notes.length ? "Your notes in the desk's ~/Notes, kept here to read and write away from it. What you send goes there when the desk is in reach. A note changed on both sides is kept twice on the desk: yours as “(phone)”."
        : "Nothing written yet. Write in Markdown; what you send goes to the desk's ~/Notes, and the notes there come here at each sync."));
      s.body.replaceChildren(...parts);
    },
    fresh() { if (s.showing("notes")) app.open(); },
    // one note: written as it is typed, kept on the phone; a note marked for the desk is read-only until taken back
    write(n) {
      let saved = n.text, timer = null, gone = false;
      const area = Object.assign(s.el("textarea", "m-input"), { value: n.text, placeholder: "# A title\n\nWrite in Markdown…", readOnly: !!n.keep });
      area.style.cssText = "display:block;width:100%;box-sizing:border-box;min-height:50vh;resize:vertical;line-height:1.5";
      const save = async () => {
        clearTimeout(timer);
        if (gone || area.value === saved) return;
        saved = area.value;
        n = { ...n, text: saved, edited: Date.now(), changed: true };
        await put("notes", n);
      };
      // leaving keeps what was written; a new note left empty is not kept
      const leave = async () => { clearTimeout(timer); if (gone) return; if (area.value.trim() || n.path) await save(); else await drop("notes", n.at); };
      s.inside(async () => { await leave(); app.open(); });
      s.onLeave(leave);
      s.title.textContent = "Note";
      area.oninput = () => { clearTimeout(timer); timer = setTimeout(save, 600); };
      const send = Object.assign(s.text("button", "m-btn" + (n.keep ? "" : " primary"), n.keep ? "DON'T SEND IT" : "SEND TO THE DESK"), { type: "button" });
      send.onclick = async () => {
        if (!n.keep && !area.value.trim()) return s.toast("Nothing written yet", false);
        await save();
        n = { ...n, keep: !n.keep, why: undefined };
        await put("notes", n);
        s.badges();
        if (!n.keep) { area.readOnly = false; send.textContent = "SEND TO THE DESK"; send.classList.add("primary"); return; } // back to writing
        gone = true; // from here the sync may take it away
        s.toast("Kept for the desk", true);
        if (s.online()) s.sync(false);
        history.back();
      };
      const box = s.el("div", "m-pad");
      box.append(area, send);
      send.style.cssText = "display:block;width:100%;margin-top:10px";
      if (!n.path) { // only a note not yet on the desk is deleted here; one on the desk is deleted there
        const del = Object.assign(s.text("button", "m-btn", "DELETE"), { type: "button" });
        let armed = null;
        del.onclick = async () => {
          if (!armed) { del.textContent = "TAP AGAIN TO DELETE"; armed = setTimeout(() => { armed = null; del.textContent = "DELETE"; }, 3000); return; }
          clearTimeout(armed);
          gone = true;
          clearTimeout(timer);
          await drop("notes", n.at);
          s.badges();
          history.back();
        };
        del.style.cssText = "display:block;width:100%;margin-top:10px";
        box.append(del);
      }
      if (n.why) box.append(s.note("The desk didn't take it: " + n.why + "."));
      if (n.path) box.append(s.note("On the desk: ~/Notes/" + n.path));
      s.body.replaceChildren(box);
      if (!n.keep && !n.path) area.focus();
    },
  };
  return app;
}
