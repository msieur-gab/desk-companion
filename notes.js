// Notes: written here in Markdown, kept on the phone while they are written, then sent to the desk's inbox when it
// is in reach; the desk's rulebook (~/Inbox/rules.md) puts a .md in ~/Notes. Once there, a note leaves the phone, as
// a memo does. The phone writes the front matter (date, title, source), so a note is ready to be read and indexed.
// A module of its own (Gab, 2026-10-31: "the companion code have grown complexe"): app.js hands it the shell
// (the pane, the toasts, sync) and calls sendNotes() at each sync. What the phone keeps (all, put, drop) is db.js's.

const glyph = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 11V7l-4-4H6v18h6"/><path d="M14 3v4h4M9 10h6M9 13h4"/><path d="M14.5 21l.8-2.8 4.7-4.7 2 2-4.7 4.7z"/></svg>';
const p2 = n => String(n).padStart(2, "0");
const day = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const when = ms => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const FRONT = /^---\n[\s\S]*?\n---\n?/;

// a note's title: its first heading, or its first line; nothing a file name can't hold, as the memos' titles
export const noteTitle = t => (t.replace(FRONT, "").split("\n").map(l => l.replace(/^#+\s*/, "").trim()).find(Boolean) || "Untitled")
  .replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 80) || "Untitled";

// the file the desk receives: its front matter, then the text. Front matter written by hand is kept as it is
function noteFile(n) {
  if (FRONT.test(n.text)) return n.text;
  const d = new Date(n.at);
  return `---\ndate: ${day(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}\ntitle: ${noteTitle(n.text)}\nsource: phone\n---\n\n${n.text.trim()}\n`;
}

// at each sync: the notes kept for the desk go to its inbox; once there, they leave the phone. Answers how many went
export async function sendNotes(desk) {
  let sent = 0;
  for (const n of (await all("notes")).filter(n => n.keep)) {
    try {
      await desk("/api/inbox?name=" + encodeURIComponent(day(new Date(n.at)) + " " + noteTitle(n.text) + ".md") + "&modified=" + n.edited,
        new Blob([noteFile(n)], { type: "text/markdown" }), 60000);
      await drop("notes", n.at);
      sent++;
    } catch (e) {
      if (e.away) throw e;
      await put("notes", { ...n, keep: false, why: e.message }); // refused: it stays here, with the reason
    }
  }
  return sent;
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
        const r = s.row(glyph, noteTitle(n.text), when(n.edited) + " · " + (n.keep ? "for the desk" : n.why ? "not taken" : "on the phone"));
        r.onclick = () => app.write(n);
        list.append(r);
      }
      const parts = [top, ...(notes.length ? [list] : [])];
      if (notes.some(n => n.keep)) {
        const foot = s.el("div", "m-pad");
        foot.append(Object.assign(s.text("button", "m-btn primary", "SEND THE KEPT ONES NOW"), { onclick: () => s.sync(true) }));
        parts.push(foot);
      }
      parts.push(s.note(notes.length ? "Tap a note to write on, then send it to the desk or delete it. Sent ones go to the desk's inbox when it is in reach, which puts them in ~/Notes. Once there, they leave this phone."
        : "Nothing written yet. Write in Markdown; what you send goes to the desk's ~/Notes."));
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
        n = { ...n, text: saved, edited: Date.now() };
        await put("notes", n);
      };
      // leaving keeps what was written; a note left empty is not kept
      const leave = async () => { clearTimeout(timer); if (gone) return; if (area.value.trim()) await save(); else await drop("notes", n.at); };
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
      for (const b of [send, del]) b.style.cssText = "display:block;width:100%;margin-top:10px";
      const box = s.el("div", "m-pad");
      box.append(area, send, del);
      if (n.why) box.append(s.note("The desk didn't take it: " + n.why + "."));
      s.body.replaceChildren(box);
      if (!n.keep) area.focus();
    },
  };
  return app;
}
