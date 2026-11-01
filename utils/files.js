// files: what the phone knows about the desk's files (Gab, 2026-11-01: "symbios is mostly a file system"; "items are files").
// The board recognises each item's kind (desk/files.py, GET /api/files): an album is a folder of tracks with its cover, an
// artist a folder of albums, a memo a folder with its sound and transcript, a show a folder of episodes. This file says how
// each kind shows on the phone: its shape (grid, for what opens on more; list, for the rest), its glyph, the line under
// its name. For every module that shows files (the Player first); the desk's windows can share it later (ARCHITECTURE.md, kit/).
import { ICONS } from "./icons.js";

const TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  flac: "audio/flac", wav: "audio/wav", webm: "audio/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ext = p => (/\.(\w+)$/.exec(p) || [])[1]?.toLowerCase() || "";

// how a thing is said: 11 MB, 43:11, 29 Oct, 3 tracks
export const size = b => b ? (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB" : "";
export const clock = s => { s = Math.floor(isFinite(s) && s > 0 ? s : 0); return (s >= 3600 ? Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") : Math.floor(s / 60)) + ":" + String(s % 60).padStart(2, "0"); };
export const day = d => { const t = d && new Date(String(d).slice(0, 10)); return t && !isNaN(t) ? t.toLocaleDateString([], { day: "numeric", month: "short" }) : ""; };
const count = (n, word) => n ? n + " " + word + (n > 1 ? "s" : "") : "";

// the table of kinds, the phone's half: shape, glyph, the line under the name
export const KINDS = {
  artist: { shape: "grid", sub: i => count(i.count, "album") },
  album: { shape: "grid", sub: i => [i.artist, count(i.count, "track")] },
  show: { shape: "grid", sub: i => count(i.count, "episode") },
  folder: { shape: "list", sub: i => count(i.count, "item") },
  track: { shape: "list", sub: i => [i.duration && clock(i.duration), size(i.size)] },
  episode: { shape: "list", sub: i => [day(i.date), i.duration && clock(i.duration)] },
  memo: { shape: "list", sub: i => [day(i.date), i.duration && clock(i.duration)] },
  note: { shape: "list", sub: i => day(i.modified) },
  article: { shape: "list", sub: i => day(i.modified) },
  picture: { shape: "list", sub: i => size(i.size) },
  video: { shape: "list", sub: i => size(i.size) },
  document: { shape: "list", sub: i => size(i.size) },
  file: { shape: "list", sub: i => size(i.size) },
};
export const kind = i => KINDS[i.kind] ? i.kind : "file";
export const glyph = i => ICONS[kind(i)];
export const describe = i => [].concat(KINDS[kind(i)].sub(i)).filter(Boolean).join(" · ");
export const playable = i => ["track", "episode", "memo"].includes(i.kind);
export const opens = i => ["artist", "album", "show", "folder"].includes(i.kind);

// where the sound is: the board's three places for it, in the order the Player shows them
export const PLACES = [{ path: "Music", name: "Music", kind: "folder" }, { path: "Podcasts", name: "Podcasts", kind: "folder" },
  { path: "Memos", name: "Voice memos", kind: "folder" }];

// a folder's own picture, among its items (cover.jpg, folder.jpg…, else the first one)
export const coverIn = items => {
  const pics = items.filter(i => i.kind === "picture");
  return (["cover", "folder", "front", "albumart", "album"].map(n => pics.find(p => p.name.toLowerCase() === n)).find(Boolean) || pics[0])?.path || null;
};

// a cover in the theme's colours (Gab, 2026-11-01: "album covers should inherit from a filter that turn the image green like
// the theme … by using the theme variable"): the picture in grey, its darks taken to --bg and its lights to --accent by
// css/mobile.css (.duo), so another theme (slate) recolours every cover with no code. picture: a Blob or a URL.
export function paintCover(el, picture) {
  if (!picture) return;
  const img = Object.assign(document.createElement("img"), { className: "duo", alt: "", src: typeof picture === "string" ? picture : URL.createObjectURL(picture) });
  el.prepend(img);
  el.classList.add("has");
}

// the desk: a folder's items, a file's bytes (sealed whole once the phone owns the desk: SECURE-LINK.md, known limits)
export const items = async (desk, path) => (await desk("/api/files?path=" + encodeURIComponent(path))).items;
export async function fetchFile(desk, path, bytes) {
  const b = await desk("/api/fs/raw?path=" + encodeURIComponent(path), null, 30000 + Math.ceil((bytes || 0) / 1e6) * 4000, true);
  return new Blob([b], { type: TYPES[ext(path)] || "application/octet-stream" });
}
